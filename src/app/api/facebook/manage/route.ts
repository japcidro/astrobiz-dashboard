import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { action, entity_id } = body as {
    action: string;
    entity_id: string;
  };

  if (!action || !entity_id) {
    return Response.json({ error: "Missing action or entity_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: tokenSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();

  if (!tokenSetting?.value) {
    return Response.json({ error: "Facebook token not configured" }, { status: 400 });
  }

  const token = tokenSetting.value;

  try {
    if (action === "toggle_status") {
      const { new_status } = body as { new_status: "ACTIVE" | "PAUSED" };
      if (!["ACTIVE", "PAUSED"].includes(new_status)) {
        return Response.json({ error: "Invalid status. Use ACTIVE or PAUSED." }, { status: 400 });
      }

      const res = await fetch(
        `${FB_API_BASE}/${entity_id}?${new URLSearchParams({
          access_token: token,
          status: new_status,
        })}`,
        { method: "POST" }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `FB API error: ${res.status}`);
      }

      return Response.json({ success: true, entity_id, status: new_status });
    }

    if (action === "update_budget") {
      const { daily_budget, lifetime_budget } = body as {
        daily_budget?: number;
        lifetime_budget?: number;
      };

      if (daily_budget == null && lifetime_budget == null) {
        return Response.json({ error: "Provide daily_budget or lifetime_budget" }, { status: 400 });
      }

      // FB API expects budget in cents
      const params: Record<string, string> = { access_token: token };
      if (daily_budget != null) {
        params.daily_budget = Math.round(daily_budget * 100).toString();
      }
      if (lifetime_budget != null) {
        params.lifetime_budget = Math.round(lifetime_budget * 100).toString();
      }

      const res = await fetch(
        `${FB_API_BASE}/${entity_id}?${new URLSearchParams(params)}`,
        { method: "POST" }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `FB API error: ${res.status}`);
      }

      return Response.json({ success: true, entity_id, daily_budget, lifetime_budget });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Facebook API error";
    return Response.json({ error: message }, { status: 500 });
  }
}
