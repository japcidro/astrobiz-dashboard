import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// Quick "did the migrations run" check. Admin-only. Uses the service
// client so RLS can't hide things from us. Safe to leave around — it
// only reports structural facts + whether a key is set (not its value).

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

async function columnExists(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  column: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .limit(1);
  if (error) {
    // 42703 = undefined column; PGRST204/PGRST205 = schema cache stale.
    const missing = /column .* does not exist/i.test(error.message);
    return !missing && !error.message.includes("does not exist");
  }
  return Array.isArray(data);
}

async function tableExists(
  supabase: ReturnType<typeof createServiceClient>,
  table: string
): Promise<boolean> {
  const { error } = await supabase.from(table).select("*").limit(1);
  if (!error) return true;
  if (/relation .* does not exist/i.test(error.message)) return false;
  // Other errors (permission, RLS) mean the table exists.
  return true;
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const checks: Check[] = [];

  // Pick & Pack manual-clear migration
  const packSourceOk = await columnExists(supabase, "pack_verifications", "source");
  const packNotesOk = await columnExists(supabase, "pack_verifications", "notes");
  checks.push({
    name: "pack_verifications.source column (manual-clear migration)",
    ok: packSourceOk,
  });
  checks.push({
    name: "pack_verifications.notes column",
    ok: packNotesOk,
  });

  // AI Analytics Phase 1 migration
  const adAnalysesOk = await tableExists(supabase, "ad_creative_analyses");
  checks.push({
    name: "ad_creative_analyses table (ai-analytics-migration)",
    ok: adAnalysesOk,
  });

  // Chat sessions migration
  const sessionsOk = await tableExists(supabase, "ai_chat_sessions");
  checks.push({
    name: "ai_chat_sessions table (chat history migration)",
    ok: sessionsOk,
  });

  // API keys in app_settings
  const { data: keyRows } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["anthropic_api_key", "gemini_api_key", "fb_access_token"]);
  const keys = new Map(
    (keyRows ?? []).map((r) => [
      r.key as string,
      typeof r.value === "string" && r.value.trim().length > 0,
    ])
  );
  checks.push({
    name: "anthropic_api_key set in app_settings",
    ok: keys.get("anthropic_api_key") ?? false,
  });
  checks.push({
    name: "gemini_api_key set in app_settings",
    ok: keys.get("gemini_api_key") ?? false,
  });
  checks.push({
    name: "fb_access_token set in app_settings",
    ok: keys.get("fb_access_token") ?? false,
  });

  // Row counts for the new tables — how much has actually been written.
  const counts: Record<string, number | string> = {};
  for (const t of [
    "pack_verifications",
    "ad_creative_analyses",
    "ai_chat_sessions",
  ]) {
    const { count, error } = await supabase
      .from(t)
      .select("*", { count: "exact", head: true });
    counts[t] = error ? `error: ${error.message}` : (count ?? 0);
  }

  const passed = checks.filter((c) => c.ok).length;
  return Response.json({
    summary: `${passed} / ${checks.length} checks passing`,
    checks,
    row_counts: counts,
  });
}
