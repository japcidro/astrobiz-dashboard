import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertInsertParams } from "./types";

export async function insertAlert(
  supabase: SupabaseClient,
  params: AlertInsertParams
): Promise<string | null> {
  const { data, error } = await supabase.rpc("insert_admin_alert", {
    p_type: params.type,
    p_severity: params.severity,
    p_title: params.title,
    p_body: params.body ?? null,
    p_resource_type: params.resource_type ?? null,
    p_resource_id: params.resource_id ?? null,
    p_action_url: params.action_url ?? null,
    p_payload: params.payload ?? null,
    p_dedup_hours: params.dedup_hours ?? 24,
  });

  if (error) {
    console.error("[alerts] insertAlert error:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}
