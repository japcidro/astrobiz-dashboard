import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface WatchRow {
  id: string;
  ad_id: string;
  ad_account_id: string | null;
  spend_threshold: number;
  since_date: string;
}

// Cron: auto-pause "Fix Rejections" cat ads in SCALING campaigns once their
// post-fix spend reaches the threshold (default ₱70). We never touch the
// scaling budget — we just stop the individual ad after it has grabbed a
// little engagement. Runs every 15 min (see vercel.json).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const token = tokenRow?.value as string | undefined;
  if (!token) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }

  const { data: rows } = await supabase
    .from("fix_rejection_autopause")
    .select("id, ad_id, ad_account_id, spend_threshold, since_date")
    .eq("status", "watching")
    .limit(500);

  const watching = (rows ?? []) as WatchRow[];
  const until = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  let paused = 0;
  let checked = 0;
  const errors: string[] = [];

  for (const row of watching) {
    checked++;
    try {
      // Spend since the fix date (PHT).
      const params = new URLSearchParams({
        fields: "spend",
        time_range: JSON.stringify({ since: row.since_date, until }),
        access_token: token,
      });
      const insRes = await fetch(
        `${FB_API_BASE}/${row.ad_id}/insights?${params}`,
        { cache: "no-store" }
      );
      const insJson = (await insRes.json()) as {
        data?: Array<{ spend?: string }>;
        error?: { message?: string };
      };
      if (!insRes.ok) {
        errors.push(`${row.ad_id}: ${insJson.error?.message || insRes.status}`);
        continue;
      }
      const spend = parseFloat(insJson.data?.[0]?.spend ?? "0") || 0;

      if (spend >= row.spend_threshold) {
        // Pause the ad.
        const pauseRes = await fetch(`${FB_API_BASE}/${row.ad_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ access_token: token, status: "PAUSED" }).toString(),
        });
        if (!pauseRes.ok) {
          const j = await pauseRes.json().catch(() => ({}));
          errors.push(
            `${row.ad_id}: pause failed — ${
              (j as { error?: { message?: string } }).error?.message || pauseRes.status
            }`
          );
          continue;
        }
        await supabase
          .from("fix_rejection_autopause")
          .update({
            status: "paused",
            last_spend: spend,
            paused_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        // Best-effort audit.
        try {
          await supabase.from("autopilot_actions").insert({
            action: "manual_paused",
            ad_id: row.ad_id,
            status: "success",
          });
        } catch {
          /* best-effort */
        }
        paused++;
      } else {
        await supabase
          .from("fix_rejection_autopause")
          .update({ last_spend: spend, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    } catch (e) {
      errors.push(`${row.ad_id}: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  return Response.json({ ok: true, checked, paused, errors });
}
