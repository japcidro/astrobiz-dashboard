import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// POST /api/facebook/pause-ads
// body: { ad_ids: string[], status?: "PAUSED" | "ACTIVE" }  (default PAUSED)
//
// Bulk stop (or resume) ads — used by the Fix Rejections "Stop selected"
// button to immediately halt delivery on the chosen ads. Sets each ad's own
// status; returns a per-ad result so the UI can update the Status column.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    ad_ids?: string[];
    status?: "PAUSED" | "ACTIVE";
  };
  const adIds = (body.ad_ids ?? []).filter(Boolean);
  const status = body.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
  if (adIds.length === 0) {
    return Response.json({ error: "ad_ids required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: tokenRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  const token = tokenRow?.value as string | undefined;
  if (!token) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }

  const results: Record<string, { ok: boolean; error?: string }> = {};
  for (const adId of adIds) {
    try {
      const res = await fetch(`${FB_API_BASE}/${adId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: token, status }).toString(),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: { message?: string } }).error?.message ||
            `FB error ${res.status}`
        );
      }
      results[adId] = { ok: true };
      // Best-effort audit, mirrors the manage route's convention.
      try {
        await supabase.from("autopilot_actions").insert({
          action: status === "PAUSED" ? "manual_paused" : "manual_resumed",
          ad_id: adId,
          actor_id: employee.id,
          status: "success",
        });
      } catch {
        /* audit is best-effort */
      }
    } catch (e) {
      results[adId] = {
        ok: false,
        error: e instanceof Error ? e.message : "failed",
      };
    }
  }

  return Response.json({ success: true, status, results });
}
