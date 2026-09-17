import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllFbPages } from "@/lib/facebook/pages";

export const dynamic = "force-dynamic";

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

  try {
    const { pages, warnings, counts } = await fetchAllFbPages(
      tokenSetting.value as string
    );

    // Only a total blackout is an error. A partial read still lists Pages, and
    // saying so beats hiding the ones that did come back.
    if (pages.length === 0 && warnings.length > 0) {
      return Response.json(
        {
          error: `Facebook returned no Pages. ${warnings.join("; ")}`,
          warnings,
        },
        { status: 502 }
      );
    }

    return Response.json({ data: pages, warnings, counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch pages";
    return Response.json({ error: message }, { status: 500 });
  }
}
