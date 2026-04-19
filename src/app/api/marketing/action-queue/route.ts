import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface AdRow {
  ad_id: string;
  ad: string;
  spend: number;
  roas: number;
  cpa: number;
  purchases: number;
  campaign_name?: string;
}

interface QueueItem {
  ad_id: string;
  ad_name: string;
  campaign_name: string | null;
  spend_7d: number;
  roas_7d: number;
  purchases_7d: number;
  reason: "scaling_winner" | "fading_winner" | "new_winner" | "dead_weight";
  reason_label: string;
}

// Returns the top marketing decisions today — a simple action queue
// that picks from the past 7 days of ad data.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const cookie = request.headers.get("cookie") ?? "";

  const sevenDayRes = await fetch(
    `${baseUrl}/api/facebook/all-ads?date_preset=last_7_days&account=ALL`,
    { headers: { cookie }, cache: "no-store" }
  );
  if (!sevenDayRes.ok) {
    return Response.json({ queue: [], autopilot_last_24h: [] });
  }
  const sevenDayData = (await sevenDayRes.json()) as { ads?: AdRow[] };
  const ads = sevenDayData.ads ?? [];

  const queue: QueueItem[] = [];

  // Scaling winners: spend >= ₱3k, roas >= 3
  const scalingWinners = ads
    .filter((a) => a.spend >= 3000 && a.roas >= 3.0)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 3)
    .map((a) => ({
      ad_id: a.ad_id,
      ad_name: a.ad || a.ad_id,
      campaign_name: a.campaign_name ?? null,
      spend_7d: a.spend,
      roas_7d: a.roas,
      purchases_7d: a.purchases,
      reason: "scaling_winner" as const,
      reason_label: `₱${Math.round(a.spend).toLocaleString()} / ${a.roas.toFixed(2)}x ROAS — scale?`,
    }));

  // Fading winners: spend >= ₱2k, roas between 1.2 and 2.0 (was profitable, now marginal)
  const fadingWinners = ads
    .filter((a) => a.spend >= 2000 && a.roas >= 1.2 && a.roas < 2.0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 2)
    .map((a) => ({
      ad_id: a.ad_id,
      ad_name: a.ad || a.ad_id,
      campaign_name: a.campaign_name ?? null,
      spend_7d: a.spend,
      roas_7d: a.roas,
      purchases_7d: a.purchases,
      reason: "fading_winner" as const,
      reason_label: `ROAS sliding to ${a.roas.toFixed(2)}x — review creative?`,
    }));

  // Dead weight: spend >= ₱1.5k, 0 purchases
  const deadWeight = ads
    .filter((a) => a.spend >= 1500 && a.purchases === 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 2)
    .map((a) => ({
      ad_id: a.ad_id,
      ad_name: a.ad || a.ad_id,
      campaign_name: a.campaign_name ?? null,
      spend_7d: a.spend,
      roas_7d: a.roas,
      purchases_7d: a.purchases,
      reason: "dead_weight" as const,
      reason_label: `₱${Math.round(a.spend).toLocaleString()} spent, 0 purchases — kill?`,
    }));

  queue.push(...scalingWinners, ...fadingWinners, ...deadWeight);

  // Autopilot recent actions (last 24h)
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: autopilotRows } = await supabase
    .from("autopilot_actions")
    .select("id, action, rule_matched, ad_name, spend, created_at")
    .gte("created_at", since)
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(8);

  return Response.json({
    queue: queue.slice(0, 5),
    autopilot_last_24h: autopilotRows ?? [],
  });
}
