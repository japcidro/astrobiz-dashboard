import { getEmployee } from "@/lib/supabase/get-employee";
import { createClient } from "@/lib/supabase/server";
import type { CallConfirmerLanguage } from "@/lib/call-confirmer/types";

export const dynamic = "force-dynamic";

interface UpsertBody {
  store_id?: string;
  enabled?: boolean;
  agent_name?: string;
  voice_id?: string | null;
  language?: CallConfirmerLanguage;
  greeting_template?: string;
  business_hours_start?: string;
  business_hours_end?: string;
  max_attempts?: number;
  retry_interval_minutes?: number;
  support_phone?: string | null;
  daily_budget_usd?: number;
  per_call_max_seconds?: number;
}

const ALLOWED_LANGUAGES: CallConfirmerLanguage[] = [
  "taglish",
  "tagalog",
  "english",
];

export async function GET() {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("call_confirmer_configs")
    .select("*");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ configs: data ?? [] });
}

export async function POST(req: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: UpsertBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.store_id) {
    return Response.json({ error: "store_id required" }, { status: 400 });
  }

  // Validation
  if (body.enabled && !body.voice_id) {
    return Response.json(
      { error: "voice_id required when enabling" },
      { status: 400 }
    );
  }
  if (body.language && !ALLOWED_LANGUAGES.includes(body.language)) {
    return Response.json({ error: "Invalid language" }, { status: 400 });
  }
  if (body.support_phone && !/^\+\d{10,15}$/.test(body.support_phone)) {
    return Response.json(
      { error: "support_phone must be E.164 (e.g. +639171234567)" },
      { status: 400 }
    );
  }
  if (
    body.daily_budget_usd !== undefined &&
    (body.daily_budget_usd <= 0 || body.daily_budget_usd > 1000)
  ) {
    return Response.json(
      { error: "daily_budget_usd must be > 0 and <= 1000" },
      { status: 400 }
    );
  }
  if (
    body.per_call_max_seconds !== undefined &&
    (body.per_call_max_seconds < 30 || body.per_call_max_seconds > 300)
  ) {
    return Response.json(
      { error: "per_call_max_seconds must be 30-300" },
      { status: 400 }
    );
  }
  if (
    body.max_attempts !== undefined &&
    (body.max_attempts < 1 || body.max_attempts > 10)
  ) {
    return Response.json(
      { error: "max_attempts must be 1-10" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // Verify the store actually exists + is active
  const { data: store, error: storeErr } = await supabase
    .from("shopify_stores")
    .select("id")
    .eq("id", body.store_id)
    .maybeSingle();
  if (storeErr) return Response.json({ error: storeErr.message }, { status: 500 });
  if (!store) {
    return Response.json({ error: "Store not found" }, { status: 404 });
  }

  const upsertPayload = {
    store_id: body.store_id,
    enabled: body.enabled ?? false,
    agent_name: body.agent_name ?? "Maria",
    voice_id: body.voice_id ?? null,
    language: body.language ?? "taglish",
    greeting_template: body.greeting_template ?? null,
    business_hours_start: body.business_hours_start ?? "09:00",
    business_hours_end: body.business_hours_end ?? "18:00",
    max_attempts: body.max_attempts ?? 3,
    retry_interval_minutes: body.retry_interval_minutes ?? 90,
    support_phone: body.support_phone ?? null,
    daily_budget_usd: body.daily_budget_usd ?? 5.0,
    per_call_max_seconds: body.per_call_max_seconds ?? 120,
  };

  const { data, error } = await supabase
    .from("call_confirmer_configs")
    .upsert(upsertPayload, { onConflict: "store_id" })
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ config: data });
}
