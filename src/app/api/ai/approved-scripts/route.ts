import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type {
  ApprovedScriptAngleType,
  CreateApprovedScriptInput,
} from "@/lib/ai/approved-scripts-types";

export const dynamic = "force-dynamic";

// GET — list approved scripts. Query params: store, status, angle_type
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store");
  const status = searchParams.get("status");
  const angleType = searchParams.get("angle_type");
  // include=creatives joins approved_script_creatives so the Bulk Create
  // import picker can show per-script creative thumbnails in one round trip.
  const include = searchParams.get("include");

  const supabase = await createClient();

  const selectCols =
    include === "creatives"
      ? "*, approved_script_creatives(*)"
      : "*";

  let query = supabase
    .from("approved_scripts")
    .select(selectCols)
    .order("approved_at", { ascending: false });

  if (store) query = query.eq("store_name", store);
  if (status) query = query.eq("status", status);
  if (angleType) query = query.eq("angle_type", angleType);

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ scripts: data || [] });
}

// POST — create a new approved script (called when user clicks Approve on a
// parsed script card in the chat panel)
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CreateApprovedScriptInput;

  if (!body.store_name || !body.angle_title || !body.hook || !body.body_script) {
    return Response.json(
      { error: "store_name, angle_title, hook, and body_script are required" },
      { status: 400 }
    );
  }

  const angleType = normalizeAngleType(body.angle_type);
  const intensity = normalizeScore(body.intensity);
  const capacity = normalizeScore(body.capacity);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("approved_scripts")
    .insert({
      store_name: body.store_name,
      source_thread_id: body.source_thread_id ?? null,
      source_message_index: body.source_message_index ?? null,
      script_number: body.script_number ?? null,
      angle_title: body.angle_title,
      avatar: body.avatar ?? null,
      angle_type: angleType,
      intensity,
      capacity,
      hook: body.hook,
      body_script: body.body_script,
      variant_hooks: body.variant_hooks ?? [],
      approved_by: employee.id,
      // v2 classification — only persisted when the structured tool_use
      // payload was present (new threads). Old threads using markdown
      // parsing will have these as null until the script is re-approved.
      awareness_level: body.awareness_level ?? null,
      funnel_stage: body.funnel_stage ?? null,
      hook_framework: body.hook_framework ?? null,
      strategic_format: body.strategic_format ?? null,
      video_format: body.video_format ?? null,
      big_idea: body.big_idea ?? null,
      variable_shifts: body.variable_shifts ?? [],
      source_winner_ad_id: body.source_winner_ad_id ?? null,
      source_winner_analysis_id: body.source_winner_analysis_id ?? null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ script: data });
}

function normalizeAngleType(
  value: string | null | undefined
): ApprovedScriptAngleType | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper === "D" || upper === "E" || upper === "M" || upper === "B") {
    return upper;
  }
  return null;
}

function normalizeScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  if (value < 1 || value > 10) return null;
  return Math.round(value);
}
