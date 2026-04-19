import type { SupabaseClient } from "@supabase/supabase-js";
import type { BriefingData, BriefingType } from "./types";

const MODEL = "claude-sonnet-4-5-20250929";

function formatPHP(num: number): string {
  return `₱${num.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function renderDataForClaude(type: BriefingType, periodLabel: string, d: BriefingData): string {
  const lines: string[] = [];
  lines.push(`PERIOD: ${periodLabel} (${type} briefing)`);
  lines.push("");
  lines.push("FINANCIAL");
  lines.push(`- Revenue: ${formatPHP(d.revenue)}`);
  lines.push(`- Orders: ${d.orders}`);
  lines.push(`- Ad spend: ${formatPHP(d.ad_spend)}`);
  lines.push(`- Net profit (est): ${formatPHP(d.net_profit_est)}`);
  lines.push(`- ROAS: ${d.roas.toFixed(2)}x`);
  lines.push(`- CPA: ${formatPHP(d.cpa)}`);
  if (d.revenue_delta_pct !== null)
    lines.push(`- Revenue vs previous period: ${d.revenue_delta_pct.toFixed(1)}%`);
  if (d.profit_delta_pct !== null)
    lines.push(`- Profit vs previous period: ${d.profit_delta_pct.toFixed(1)}%`);
  lines.push("");

  lines.push("OPERATIONS");
  lines.push(`- Unfulfilled: ${d.unfulfilled_count} (${d.aging_count} aging 3+ days)`);
  lines.push(`- Fulfilled: ${d.fulfilled_count}`);
  lines.push(`- Autopilot: paused ${d.autopilot.paused}, resumed ${d.autopilot.resumed} (${formatPHP(d.autopilot.total_spend_affected)} total spend affected)`);
  lines.push(`- RTS: ${d.rts.rts_count} parcels worth ${formatPHP(d.rts.rts_value)}${d.rts.top_province ? ` (top province: ${d.rts.top_province})` : ""}`);
  lines.push("");

  if (d.top_products.length > 0) {
    lines.push("TOP PRODUCTS");
    for (const p of d.top_products) {
      lines.push(`- ${p.product_title} (${p.store_name}): ${p.units_sold} units, ${formatPHP(p.revenue)}`);
    }
    lines.push("");
  }

  if (d.top_ads.length > 0) {
    lines.push("TOP ADS");
    for (const a of d.top_ads) {
      lines.push(`- ${a.ad_name}: ${formatPHP(a.spend)} spend, ${a.roas.toFixed(2)}x ROAS, ${a.purchases} purchases`);
    }
    lines.push("");
  }

  if (d.worst_ads.length > 0) {
    lines.push("ADS TO REVIEW (high spend, 0 purchases)");
    for (const a of d.worst_ads) {
      lines.push(`- ${a.ad_name}: ${formatPHP(a.spend)} spend, 0 purchases`);
    }
    lines.push("");
  }

  if (d.store_breakdown.length > 0) {
    lines.push("STORES");
    for (const s of d.store_breakdown.slice(0, 4)) {
      lines.push(`- ${s.store_name}: ${formatPHP(s.revenue)} / ${s.orders} orders / ${s.unfulfilled} unfulfilled`);
    }
    lines.push("");
  }

  if (d.stock_movement.length > 0) {
    lines.push("STOCK MOVEMENT");
    for (const s of d.stock_movement) {
      const arrow = s.delta > 0 ? "+" : "";
      lines.push(`- ${s.product_title} (${s.store_name}): ${arrow}${s.delta} units (now at ${s.stock_now})`);
    }
    lines.push("");
  }

  if (d.team_hours.length > 0) {
    lines.push("TEAM HOURS");
    for (const t of d.team_hours) {
      lines.push(`- ${t.role}: ${t.hours}h`);
    }
  }

  return lines.join("\n");
}

function buildSystemPrompt(type: BriefingType): string {
  const role =
    type === "morning"
      ? "You're writing a 6 AM morning briefing to the CEO of an e-commerce business based in the Philippines. The CEO just woke up and wants to know what happened yesterday in 2-3 short paragraphs. Focus on the 2-3 things they should actually do today based on yesterday's numbers."
      : type === "evening"
        ? "You're writing a 10 PM end-of-day report to the CEO. Summarize what happened today in 2-3 short paragraphs. Call out surprises — good and bad. End with what to watch tomorrow."
        : type === "weekly"
          ? "You're writing a Monday morning weekly review to the CEO. Summarize last week in 3-4 paragraphs. Compare to the prior week. Identify the #1 thing to double down on and the #1 thing to stop doing this week."
          : "You're writing a start-of-month strategic review. Summarize last month in 4-5 paragraphs. Cover: what drove revenue, where margin came from (or didn't), what worked in ads/creative, inventory/RTS issues, and 2-3 priorities for the coming month.";

  return `${role}

Rules:
- Write in clear, direct English. NO fluff, NO hype language, NO emojis.
- Use Philippine peso (₱) for all money. Round to whole pesos.
- Reference specific numbers from the data. Don't invent numbers.
- If a metric is missing or zero, say so plainly.
- Prefer concrete verbs: "Kill ad X", "Reorder SKU Y", "Resume ad Z" — not vague advice.
- Keep it skimmable. Short paragraphs. No bullet lists in the summary itself — that's shown separately.`;
}

export async function generateAISummary(
  supabase: SupabaseClient,
  type: BriefingType,
  periodLabel: string,
  data: BriefingData
): Promise<string | null> {
  const { data: keyRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

  if (!keyRow?.value) {
    console.error("[briefings/summarize] No anthropic_api_key in app_settings");
    return null;
  }

  const systemPrompt = buildSystemPrompt(type);
  const userContent = renderDataForClaude(type, periodLabel, data);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": keyRow.value as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[briefings/summarize] Claude error", res.status, errText.slice(0, 300));
      return null;
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = json.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n\n")
      .trim();
    return text || null;
  } catch (err) {
    console.error("[briefings/summarize] fetch failed", err);
    return null;
  }
}
