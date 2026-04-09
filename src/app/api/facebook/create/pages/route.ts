import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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

  const token = tokenSetting.value;

  try {
    // Try /me/accounts first (works for User tokens and System Users with page assignments)
    const params = new URLSearchParams({
      access_token: token,
      fields: "id,name,picture{url}",
      limit: "100",
    });

    const res = await fetch(`${FB_API_BASE}/me/accounts?${params}`, {
      cache: "no-store",
    });

    let pages: Array<{ id: string; name: string; picture?: { data?: { url?: string } } }> = [];

    if (res.ok) {
      const json = await res.json();
      pages = json.data || [];
    }

    // If no pages found, try via Business Manager (owned_pages)
    if (pages.length === 0) {
      // Get business ID from /me
      const meRes = await fetch(
        `${FB_API_BASE}/me?${new URLSearchParams({ access_token: token, fields: "business" })}`,
        { cache: "no-store" }
      );

      if (meRes.ok) {
        const meJson = await meRes.json();
        const businessId = meJson.business?.id;

        if (businessId) {
          const bizParams = new URLSearchParams({
            access_token: token,
            fields: "id,name,picture{url}",
            limit: "100",
          });

          const bizRes = await fetch(
            `${FB_API_BASE}/${businessId}/owned_pages?${bizParams}`,
            { cache: "no-store" }
          );

          if (bizRes.ok) {
            const bizJson = await bizRes.json();
            pages = bizJson.data || [];
          }
        }
      }
    }

    return Response.json({ data: pages });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch pages";
    return Response.json({ error: message }, { status: 500 });
  }
}
