import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { WINNERS_LOG_SYSTEM_PROMPT } from "@/lib/ai/winners-log-spec";

export const dynamic = "force-dynamic";
// Opus 4.7 with ~50K tokens of pooled-ad input + deconstructor data +
// 10-20K tokens out can run 90-180s on bigger pools. 300s headroom.
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 32_000;
const MAX_INPUT_CHARS = 800_000;
const HOOK_RATE_DATE_PRESET = "last_14d";

interface DeconstructionAnalysis {
  transcript?: string;
  hook?: string;
  hook_anatomy?: Record<string, unknown>;
  cta?: string;
  uvp?: string;
  classification?: Record<string, unknown>;
  viral_mechanism?: Record<string, unknown>;
  angle_variations?: Record<string, unknown>;
  duration_seconds?: number;
  language?: string;
  visual_style?: Record<string, unknown>;
}

interface FbAdRow {
  ad_id: string;
  ad: string;
  campaign: string;
  account: string;
  spend: number;
  purchases: number;
  cpa: number;
  roas: number;
  impressions: number;
  ctr: number;
  status: string;
}

interface ClaudeResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: Record<string, number>;
}

// Per-ad hook rate: FB doesn't expose this in the cached payload, so we
// pull it on demand for each Log generation. Tiny cost (one parallel
// fan-out per Log run). Hook rate = 3-sec views / impressions × 100.
async function fetchHookRates(
  adIds: string[],
  token: string
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  await Promise.all(
    adIds.map(async (adId) => {
      try {
        const params = new URLSearchParams({
          access_token: token,
          date_preset: HOOK_RATE_DATE_PRESET,
          fields: "video_3_sec_watched_actions,impressions",
        });
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${adId}/insights?${params}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          out[adId] = null;
          return;
        }
        const json = await res.json();
        const data = json.data?.[0];
        if (!data) {
          out[adId] = null;
          return;
        }
        const threeSec = parseFloat(
          (
            data.video_3_sec_watched_actions as
              | Array<{ action_type: string; value: string }>
              | undefined
          )?.find((a) => a.action_type === "video_view")?.value ?? "0"
        );
        const impressions = parseFloat(data.impressions ?? "0");
        out[adId] =
          impressions > 0 && !isNaN(threeSec)
            ? (threeSec / impressions) * 100
            : null;
      } catch {
        out[adId] = null;
      }
    })
  );
  return out;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const storeFilter = url.searchParams.get("store");

  const supabase = await createClient();

  // 1. Credentials
  const [{ data: keyRow }, { data: fbTokenRow }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single(),
  ]);
  if (!keyRow?.value) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings." },
      { status: 400 }
    );
  }
  const apiKey = keyRow.value as string;
  const fbToken = (fbTokenRow?.value as string | undefined) ?? null;

  // 2. Winner pool ads
  let poolQ = supabase
    .from("winner_pool_ads")
    .select("ad_id, store_name, tagged_at, is_winner")
    .order("tagged_at", { ascending: false });
  if (storeFilter) poolQ = poolQ.eq("store_name", storeFilter);
  const { data: poolRows, error: poolErr } = await poolQ;
  if (poolErr) return Response.json({ error: poolErr.message }, { status: 500 });
  if (!poolRows || poolRows.length === 0) {
    return Response.json(
      { error: "Log Pool is empty. Tag at least one ad first." },
      { status: 400 }
    );
  }
  const adIds = poolRows.map((r) => r.ad_id as string);

  // 3. Deconstruction analyses (transcript + ILP classification)
  const { data: analyses } = await supabase
    .from("ad_creative_analyses")
    .select("ad_id, analysis, created_at")
    .in("ad_id", adIds);
  const analysisByAd = new Map<string, DeconstructionAnalysis>();
  for (const row of (analyses ?? []) as Array<{
    ad_id: string;
    analysis: DeconstructionAnalysis;
  }>) {
    analysisByAd.set(row.ad_id, row.analysis);
  }

  // 4. FB metrics — pull from the cached all-ads payload
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? `${url.protocol}//${url.host}`;
  let fbMetrics: Record<string, FbAdRow> = {};
  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const fbRes = await fetch(
      `${baseUrl}/api/facebook/all-ads?date_preset=last_14d&account=ALL&include_zero_spend=1`,
      { cache: "no-store", headers: { cookie: cookieHeader } }
    );
    if (fbRes.ok) {
      const fbJson = (await fbRes.json()) as { data?: FbAdRow[] };
      for (const a of fbJson.data ?? []) {
        fbMetrics[a.ad_id] = a;
      }
    }
  } catch {
    fbMetrics = {};
  }

  // 5. Hook rate per ad — computed from FB Insights (3-sec views / impressions)
  const hookRates = fbToken
    ? await fetchHookRates(adIds, fbToken)
    : ({} as Record<string, number | null>);

  // 6. Build user message — one block per ad with all the v2.0 fields
  const adBlocks: string[] = [];
  for (const p of (poolRows as Array<{
    ad_id: string;
    store_name: string | null;
    tagged_at: string;
    is_winner: boolean | null;
  }>)) {
    const adId = p.ad_id;
    const ana = analysisByAd.get(adId);
    const fb = fbMetrics[adId];
    const hr = hookRates[adId];
    const hookRateField =
      hr != null ? `${hr.toFixed(2)}% (3-sec views / impressions)` : "";
    const manualResult = p.is_winner ? "WINNER" : "LOSER";

    const block = [
      `=== AD #${adBlocks.length + 1} ===`,
      `ad_id: ${adId}`,
      `ad_name: ${fb?.ad ?? "(unknown — not in last_14d FB cache)"}`,
      `campaign: ${fb?.campaign ?? "(unknown)"}`,
      `account: ${fb?.account ?? "(unknown)"}`,
      `store: ${p.store_name ?? "(unknown)"}`,
      `tagged_at: ${p.tagged_at}`,
      `manual_result: ${manualResult}   <- USER GROUND TRUTH — USE THIS FOR BLOCK 1 Result`,
      ``,
      `-- METRICS (last_14d window) --`,
      `spend_php: ${fb && fb.spend ? fb.spend.toFixed(2) : ""}`,
      `purchases: ${fb?.purchases ?? ""}`,
      `cpa_php: ${fb?.cpa ? fb.cpa.toFixed(2) : ""}`,
      `roas: ${fb?.roas ? fb.roas.toFixed(2) + "x" : ""}`,
      `impressions: ${fb?.impressions ?? ""}`,
      `ctr_pct: ${fb?.ctr ? fb.ctr.toFixed(2) : ""}`,
      `hook_rate_pct: ${hookRateField}`,
      `current_status: ${fb?.status ?? ""}`,
      ``,
      `-- DECONSTRUCTOR ANALYSIS (use this verbatim for BLOCK 3 classification) --`,
      ana
        ? JSON.stringify(
            {
              hook: ana.hook,
              hook_anatomy: ana.hook_anatomy,
              cta: ana.cta,
              uvp: ana.uvp,
              classification: ana.classification,
              viral_mechanism: ana.viral_mechanism,
              angle_variations: ana.angle_variations,
              duration_seconds: ana.duration_seconds,
              language: ana.language,
              visual_style: ana.visual_style,
            },
            null,
            2
          )
        : "(no deconstruction available — derive classification from the script + metrics, and flag every tag as Classification Confidence: ambiguous)",
      ``,
      `-- TRANSCRIPT --`,
      ana?.transcript ?? "(no transcript available)",
      ``,
    ].join("\n");
    adBlocks.push(block);
  }

  const userMessage = [
    `BATCH SIZE: ${poolRows.length} ads`,
    `BRAND: ${storeFilter ?? "(all brands)"}`,
    `GENERATED AT: ${new Date().toISOString()}`,
    ``,
    `Below is one structured block per ad in the Log Pool. Produce one`,
    `7-block Log entry per ad following the v2.0 schema in your system prompt.`,
    ``,
    `IMPORTANT — Result is user-driven:`,
    `Use the manual_result field as the BLOCK 1 Result verbatim. The user`,
    `has manually classified each ad as WINNER or LOSER based on whether it`,
    `worked for THEIR metrics. Do not override the user's call with a`,
    `metrics-only re-classification — even if metrics look strong on a`,
    `manual_result: LOSER, log it as LOSER and use BLOCK 7 to explain why`,
    `the metrics misled (compliance flag, wrong avatar, off-brand, fluke,`,
    `etc.). Conversely, do not downgrade a manual_result: WINNER to`,
    `INCONCLUSIVE just because hook rate underperformed Script C.`,
    ``,
    `Still use the Script C 40.38% hook rate benchmark and batch comparison`,
    `as analytical color inside BLOCKS 2 and 7 — just do not let them change`,
    `the Result label.`,
    ``,
    `Then append PATTERNS OBSERVED (split by Result) and the ANTI-COLLAPSE`,
    `RULE with Untested Territory list per the spec.`,
    ``,
    ...adBlocks,
  ].join("\n");

  if (userMessage.length > MAX_INPUT_CHARS) {
    return Response.json(
      {
        error: `Batch is too large (${userMessage.length.toLocaleString()} chars > ${MAX_INPUT_CHARS.toLocaleString()} cap). Untag some ads or split into smaller batches.`,
      },
      { status: 400 }
    );
  }

  // 7. Call Claude Opus 4.7
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: WINNERS_LOG_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return Response.json(
      { error: `Claude API error (${res.status}): ${errText.slice(0, 500)}` },
      { status: 502 }
    );
  }

  const json = (await res.json()) as ClaudeResponse;
  const text =
    json.content?.find((b) => b.type === "text" && b.text)?.text ?? "";

  if (!text) {
    return Response.json(
      { error: "Claude returned no text content" },
      { status: 502 }
    );
  }

  return Response.json({
    markdown: text,
    model: MODEL,
    ad_count: poolRows.length,
    store: storeFilter,
    tokens_used: json.usage ?? null,
  });
}
