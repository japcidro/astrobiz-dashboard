// Profit tool — ADMIN ONLY. Marketing role must NEVER see this output
// (enforced by permissions.ts allowlist). We forward to the existing
// /api/profit/daily route using CRON_SECRET to bypass session auth,
// so we inherit the battle-tested COGS/shipping/returns projection math
// instead of re-implementing 700 lines of it.

import type { DailyPnlRow, ProfitSummary } from "@/lib/profit/types";

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  return "http://localhost:3000";
}

export async function getNetProfit(input: {
  date_filter?: string;
  date_from?: string;
  date_to?: string;
  store_name?: string;
}): Promise<{
  date_filter: string;
  store: string;
  summary: ProfitSummary;
  daily: DailyPnlRow[];
  note?: string;
  error?: string;
}> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return {
      date_filter: input.date_filter ?? "today",
      store: input.store_name ?? "ALL",
      summary: {
        revenue: 0,
        order_count: 0,
        cogs: 0,
        ad_spend: 0,
        shipping: 0,
        returns_value: 0,
        net_profit: 0,
        margin_pct: 0,
      },
      daily: [],
      error:
        "CRON_SECRET not set in environment. Ask an admin to configure it so the AI can query net profit.",
    };
  }

  const params = new URLSearchParams({
    date_filter: input.date_filter ?? "today",
    store: input.store_name ?? "ALL",
  });
  if (input.date_from) params.set("date_from", input.date_from);
  if (input.date_to) params.set("date_to", input.date_to);

  const url = `${getBaseUrl()}/api/profit/daily?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      date_filter: input.date_filter ?? "today",
      store: input.store_name ?? "ALL",
      summary: {
        revenue: 0,
        order_count: 0,
        cogs: 0,
        ad_spend: 0,
        shipping: 0,
        returns_value: 0,
        net_profit: 0,
        margin_pct: 0,
      },
      daily: [],
      error: `Profit API ${res.status}: ${text.slice(0, 300)}`,
    };
  }

  const json = (await res.json()) as {
    daily: DailyPnlRow[];
    summary: ProfitSummary;
  };

  // Trim daily rows to keep tool result compact — 90 days max, summary
  // covers totals anyway.
  const daily = (json.daily ?? []).slice(-90);
  const hasProjected = daily.some(
    (d) => d.shipping_projected || d.returns_projected
  );

  return {
    date_filter: input.date_filter ?? "today",
    store: input.store_name ?? "ALL",
    summary: json.summary,
    daily,
    note: hasProjected
      ? "Some rows include projected shipping/returns for in-transit orders. Actuals finalize once J&T uploads complete."
      : undefined,
  };
}
