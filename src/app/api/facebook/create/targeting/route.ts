import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const type = searchParams.get("type") || "adinterest"; // adinterest | adTargetingCategory

  if (!query || query.length < 2) {
    return Response.json({ data: [] });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json({ error: "Token not configured" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      access_token: tokenSetting.value,
      q: query,
      type,
      limit: "20",
    });

    const res = await fetch(`${FB_API_BASE}/search?${params}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `FB API error: ${res.status}`);
    }

    const json = await res.json();
    const data = (json.data || []).map(
      (item: { id: string; name: string; audience_size?: number }) => ({
        id: item.id,
        name: item.name,
        audience_size: item.audience_size || null,
      })
    );

    return Response.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
