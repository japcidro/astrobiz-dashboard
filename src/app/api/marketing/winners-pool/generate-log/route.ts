import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { WINNERS_LOG_SYSTEM_PROMPT } from "@/lib/ai/winners-log-spec";

export const dynamic = "force-dynamic";
// Opus 4.7 with ~30K tokens of pooled-ad input + ~10-20K tokens out can
// run 60-120s. 300s gives plenty of headroom.
export const maxDuration = 300;

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 32_000;

// Hard cap on the combined per-ad data we send. Opus 4.7 has 1M tokens
// but realistic Log batches are 5-30 ads; we sanity-cap chars at 800K
// (~200K input tokens) to fail fast on a runaway batch.
const MAX_INPUT_CHARS = 800_000;

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

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const storeFilter = url.searchParams.get("store");

  const supabase = await createClient();

  // 1. Anthropic key
  const { data: keyRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();
  if (!keyRow?.value) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings." },
      { status: 400 }
    );
  }
  const apiKey = keyRow.value as string;

  // 2. Winner pool ads
  let poolQ = supabase
    .from("winner_pool_ads")
    .select("ad_id, store_name, tagged_at")
    .order("tagged_at", { ascending: false });
  if (storeFilter) poolQ = poolQ.eq("store_name", storeFilter);
  const { data: poolRows, error: poolErr } = await poolQ;
  if (poolErr) return Response.json({ error: poolErr.message }, { status: 500 });
  if (!poolRows || poolRows.length === 0) {
    return Response.json(
      { error: "Winners Pool is empty. Tag at least one ad first." },
      { status: 400 }
    );
  }
  const adIds = poolRows.map((r) => r.ad_id as string);

  // 3. Deconstruction analyses for those ads (transcript + classification)
  const { data: analyses, error: anaErr } = await supabase
    .from("ad_creative_analyses")
    .select("ad_id, analysis, created_at")
    .in("ad_id", adIds);
  if (anaErr) return Response.json({ error: anaErr.message }, { status: 500 });
  const analysisByAd = new Map<string, DeconstructionAnalysis>();
  for (const row of (analyses ?? []) as Array<{
    ad_id: string;
    analysis: DeconstructionAnalysis;
  }>) {
    analysisByAd.set(row.ad_id, row.analysis);
  }

  // 4. FB metrics for those ads — use the cached all-ads payload as the
  //    canonical source. We don't refetch from FB; just pull from cache.
  //    No date range filter here — the cache already represents the last
  //    14-day window which is what the Log assumes.
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `${url.protocol}//${url.host}`;
  let fbMetrics: Record<string, FbAdRow> = {};
  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const fbRes = await fetch(
      `${baseUrl}/api/facebook/all-ads?date_preset=last_14d&account=ALL`,
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

  // 5. Build user message — one block per ad with everything Claude needs
  const adBlocks: string[] = [];
  for (const p of poolRows) {
    const adId = p.ad_id as string;
    const ana = analysisByAd.get(adId);
    const fb = fbMetrics[adId];
    const block = [
      `=== AD #${adBlocks.length + 1} ===`,
      `ad_id: ${adId}`,
      `ad_name: ${fb?.ad ?? "(unknown — not in last_14d FB cache)"}`,
      `campaign: ${fb?.campaign ?? "(unknown)"}`,
      `store: ${p.store_name ?? "(unknown)"}`,
      `tagged_at: ${p.tagged_at}`,
      ``,
      `-- METRICS (last_14d window, FB cache) --`,
      `spend_php: ${fb ? fb.spend.toFixed(2) : ""}`,
      `purchases: ${fb?.purchases ?? ""}`,
      `cpa_php: ${fb?.cpa ? fb.cpa.toFixed(2) : ""}`,
      `roas: ${fb?.roas ? fb.roas.toFixed(2) + "x" : ""}`,
      `impressions: ${fb?.impressions ?? ""}`,
      `ctr_pct: ${fb?.ctr ? fb.ctr.toFixed(2) : ""}`,
      `current_status: ${fb?.status ?? ""}`,
      ``,
      `-- DECONSTRUCTOR ANALYSIS (Gemini Flash) --`,
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
        : "(no deconstruction available for this ad)",
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
    `Below is one structured block per ad in the Winners Pool. Build the`,
    `Log document per the Section 4 entry format. Determine each Result`,
    `(WINNER/LOSER/MIXED) by comparing the metrics relative to the others`,
    `in this batch. Then append the Patterns Observed + Anti-Collapse`,
    `Reminder sections per Section 6.`,
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

  // 6. Call Claude Opus 4.7
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
