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
  const accountId = searchParams.get("account_id");

  if (!accountId) {
    return Response.json({ error: "Missing account_id" }, { status: 400 });
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
      fields: "id,name",
      limit: "50",
    });

    const res = await fetch(
      `${FB_API_BASE}/${accountId}/adspixels?${params}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `FB API error: ${res.status}`);
    }

    const json = await res.json();
    return Response.json({ data: json.data || [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch pixels";
    return Response.json({ error: message }, { status: 500 });
  }
}
