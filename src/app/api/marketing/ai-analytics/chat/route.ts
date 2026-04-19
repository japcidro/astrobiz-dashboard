import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

interface AdSnapshot {
  account: string;
  account_id: string;
  campaign: string;
  adset: string;
  ad: string;
  ad_id: string;
  status: string;
  spend: number;
  link_clicks: number;
  cpa: number;
  roas: number;
  add_to_cart: number;
  purchases: number;
  landing_page_views: number;
  cost_per_lpv: number;
  reach: number;
  impressions: number;
  ctr: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function money(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
}

function buildSystemPrompt(
  ads: AdSnapshot[],
  datePreset: string,
  totals: {
    spend: number;
    purchases: number;
    link_clicks: number;
    impressions: number;
  }
): string {
  // Compact the ad list. Keep top 50 by spend to cap tokens.
  const topAds = [...ads].sort((a, b) => b.spend - a.spend).slice(0, 50);

  const tsvHeader =
    "ad_id\tad\tcampaign\tstatus\tspend\tpurchases\troas\tcpa\tctr%\tlpv\tclicks\tatc\timpr\treach";
  const tsvRows = topAds
    .map((a) =>
      [
        a.ad_id,
        a.ad?.slice(0, 60) ?? "",
        a.campaign?.slice(0, 60) ?? "",
        a.status,
        a.spend.toFixed(0),
        a.purchases.toFixed(0),
        a.roas.toFixed(2),
        a.cpa.toFixed(0),
        (a.ctr * 100).toFixed(2),
        a.landing_page_views.toFixed(0),
        a.link_clicks.toFixed(0),
        a.add_to_cart.toFixed(0),
        a.impressions.toFixed(0),
        a.reach.toFixed(0),
      ].join("\t")
    )
    .join("\n");

  const totalsLine = `spend=₱${money(totals.spend)}  purchases=${totals.purchases}  clicks=${money(totals.link_clicks)}  impr=${money(totals.impressions)}`;

  return `You are a senior Facebook Ads performance analyst for Astrobiz, a Philippine e-commerce company running Shopify + Meta Ads. The operator is a marketing team lead looking for clear, decision-oriented insights — not textbook explanations.

Current context:
- Date range: ${datePreset}
- Ad count in view: ${ads.length} (top 50 by spend shown below)
- Account-level totals: ${totalsLine}

Ad-level data (top 50 by spend, TSV format):
${tsvHeader}
${tsvRows}

Glossary of the metrics:
- roas = purchase value ÷ spend  (>1.5 healthy, >2.5 strong for cold PH traffic)
- cpa = cost per purchase (peso)
- ctr = click-through rate (outbound clicks ÷ impressions)
- cost_per_lpv = spend ÷ landing page views
- atc = add-to-cart count
- status = FB delivery status (ACTIVE, PAUSED, etc.)

How to answer:
1. Lead with the specific answer, not caveats. If the user asks "which ads are top", name them by ad name + ROAS/CPA.
2. Reference ads by their "ad" column name when talking about specific ones, not ad_id.
3. When patterns exist, call them out (e.g. "the top 3 ROAS ads all use UGC hooks").
4. When data is insufficient, say so in one line and suggest what you'd need.
5. Be decisive. If the user asks for a recommendation, give one with reasoning. If an ad is bleeding (ROAS < 0.8, spend > ₱3,000), say "kill it" or "pause" and explain.
6. Use Taglish naturally — mix English analysis with Filipino phrases when it feels right, like talking to a colleague. Don't force it.
7. Peso amounts: use ₱ symbol, round to whole pesos for spend/CPA, 2 decimals for ROAS/CTR.
8. Never invent data. If you weren't given a metric, say so.`;
}

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    messages?: ChatMessage[];
    ads_snapshot?: AdSnapshot[];
    date_preset?: string;
    totals?: {
      spend: number;
      purchases: number;
      link_clicks: number;
      impressions: number;
    };
  };

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const adsSnapshot = Array.isArray(body.ads_snapshot) ? body.ads_snapshot : [];
  const datePreset = body.date_preset ?? "last_7d";
  const totals = body.totals ?? {
    spend: 0,
    purchases: 0,
    link_clicks: 0,
    impressions: 0,
  };

  if (messages.length === 0) {
    return Response.json(
      { error: "At least one message is required" },
      { status: 400 }
    );
  }
  if (adsSnapshot.length === 0) {
    return Response.json(
      {
        error:
          "No ads data available. Load the Ad Performance page first, then return.",
      },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: keyRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

  if (!keyRow?.value) {
    return Response.json(
      {
        error:
          "Anthropic API key not configured. Ask an admin to set it in Settings.",
      },
      { status: 400 }
    );
  }

  const systemPrompt = buildSystemPrompt(adsSnapshot, datePreset, totals);

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": keyRow.value,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!claudeRes.ok || !claudeRes.body) {
    const errText = await claudeRes.text();
    console.error("[ai-analytics/chat] Claude error:", claudeRes.status, errText);
    return Response.json(
      {
        error: `Claude API error (${claudeRes.status})`,
        details: errText.slice(0, 300),
      },
      { status: 502 }
    );
  }

  // Pass through Claude's SSE stream directly. The client parses the same format.
  return new Response(claudeRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
