import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// GET /api/facebook/ad-statuses?ad_ids=a,b,c
// Returns { statuses: { "<ad_id>": "<effective_status>" } } using FB's batch
// `?ids=` lookup (up to 50 per call). Used by the Fix Rejections Status
// column to show whether each ad is now Running / In review / Stopped /
// Rejected after a fix — without dropping rows from the list.
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const idsParam = new URL(request.url).searchParams.get("ad_ids");
  const adIds = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (adIds.length === 0) {
    return Response.json({ statuses: {} });
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

  const statuses: Record<string, string> = {};
  try {
    // FB batch lookup caps at ~50 ids per call.
    for (let i = 0; i < adIds.length; i += 50) {
      const chunk = adIds.slice(i, i + 50);
      const params = new URLSearchParams({
        ids: chunk.join(","),
        fields: "effective_status",
        access_token: token,
      });
      const res = await fetch(`${FB_API_BASE}/?${params}`, { cache: "no-store" });
      const json = (await res.json()) as
        | Record<string, { effective_status?: string }>
        | { error?: { message?: string } };
      if (!res.ok) {
        const msg =
          (json as { error?: { message?: string } }).error?.message ||
          `FB error ${res.status}`;
        return Response.json({ error: msg }, { status: 502 });
      }
      for (const [id, val] of Object.entries(
        json as Record<string, { effective_status?: string }>
      )) {
        if (val?.effective_status) statuses[id] = val.effective_status;
      }
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "status fetch failed" },
      { status: 502 }
    );
  }

  return Response.json({ statuses });
}
