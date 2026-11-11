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

      // Log the manual toggle into autopilot_actions so the Creatives page
      // can surface "Paused by Julius · 2h ago" alongside autopilot pauses.
      // Non-fatal — a failed audit insert must not break the toggle itself.
      try {
        await supabase.from("autopilot_actions").insert({
          action: new_status === "PAUSED" ? "manual_paused" : "manual_resumed",
          ad_id: entity_id,
          actor_id: employee.id,
          status: "success",
        });
      } catch {
        /* audit insert is best-effort */
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

    // Add warm audiences to an ad set that already exists (include and/or
    // exclude), keeping what it has. Advantage+ audience is turned off so the
    // audiences are limits, not hints, same as the create route.
    if (action === "update_audiences") {
      const { include, exclude } = body as { include?: string[]; exclude?: string[] };
      const inc = (include || []).map(String).filter(Boolean);
      const exc = (exclude || []).map(String).filter(Boolean);
      if (inc.length === 0 && exc.length === 0) {
        return Response.json({ error: "Provide include and/or exclude audience ids" }, { status: 400 });
      }

      const readRes = await fetch(
        `${FB_API_BASE}/${entity_id}?${new URLSearchParams({ access_token: token, fields: "targeting" })}`,
        { cache: "no-store" }
      );
      const readJson = await readRes.json();
      if (!readRes.ok) {
        throw new Error(readJson.error?.message || `FB API error: ${readRes.status}`);
      }
      const targeting = (readJson.targeting || {}) as Record<string, unknown>;
      const merge = (current: unknown, ids: string[]) => {
        const seen = new Set<string>();
        const out: { id: string }[] = [];
        const have = Array.isArray(current) ? (current as Array<{ id?: string }>) : [];
        for (const a of [...have, ...ids.map((id) => ({ id }))]) {
          if (!a?.id || seen.has(a.id)) continue;
          seen.add(a.id);
          out.push({ id: a.id });
        }
        return out;
      };
      const next: Record<string, unknown> = { ...targeting };
      if (inc.length) next.custom_audiences = merge(targeting.custom_audiences, inc);
      if (exc.length) next.excluded_custom_audiences = merge(targeting.excluded_custom_audiences, exc);
      next.targeting_automation = { advantage_audience: 0 };

      const res = await fetch(`${FB_API_BASE}/${entity_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: token, targeting: JSON.stringify(next) }).toString(),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.error_user_msg || err.error?.message || `FB API error: ${res.status}`);
      }

      return Response.json({
        success: true,
        entity_id,
        custom_audiences: next.custom_audiences ?? null,
        excluded_custom_audiences: next.excluded_custom_audiences ?? null,
      });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Facebook API error";
    return Response.json({ error: message }, { status: 500 });
  }
}
