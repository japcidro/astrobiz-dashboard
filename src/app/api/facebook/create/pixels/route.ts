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
      limit: "200",
    });

    // An ad account can hold more pixels than one page returns (the Chinkee
    // account has over 50), so follow paging until the list is complete.
    // Otherwise a store's pixel past the first page is missing from the
    // dropdown and its saved default cannot be selected.
    const pixels: { id: string; name: string }[] = [];
    let url = `${FB_API_BASE}/${accountId}/adspixels?${params}`;
    for (let page = 0; url && page < 20; page++) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `FB API error: ${res.status}`);
      }
      const json = await res.json();
      pixels.push(...(json.data || []));
      url = json.paging?.next ?? "";
    }
    pixels.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return Response.json({ data: pixels });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch pixels";
    return Response.json({ error: message }, { status: 500 });
  }
}
