import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import type { CreateApprovedScriptCreativeInput } from "@/lib/ai/approved-script-creatives-types";

export const dynamic = "force-dynamic";

// GET /api/ai/approved-scripts/[id]/creatives
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("approved_script_creatives")
    .select("*")
    .eq("approved_script_id", id)
    .order("uploaded_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ creatives: data ?? [] });
}

// POST /api/ai/approved-scripts/[id]/creatives
// Body: CreateApprovedScriptCreativeInput
// Client has already uploaded the file to FB and got back image_hash or
// video_id. We only persist the reference here.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as CreateApprovedScriptCreativeInput;

  if (!body.fb_ad_account_id || !body.creative_type) {
    return Response.json(
      { error: "fb_ad_account_id and creative_type are required" },
      { status: 400 }
    );
  }
  if (body.creative_type === "image" && !body.fb_image_hash) {
    return Response.json(
      { error: "fb_image_hash required for image creative" },
      { status: 400 }
    );
  }
  if (body.creative_type === "video" && !body.fb_video_id) {
    return Response.json(
      { error: "fb_video_id required for video creative" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("approved_script_creatives")
    .insert({
      approved_script_id: id,
      fb_ad_account_id: body.fb_ad_account_id,
      creative_type: body.creative_type,
      fb_image_hash: body.creative_type === "image" ? body.fb_image_hash : null,
      fb_video_id: body.creative_type === "video" ? body.fb_video_id : null,
      file_name: body.file_name ?? null,
      thumbnail_url: body.thumbnail_url ?? null,
      label: body.label ?? null,
      uploaded_by: employee.id,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ creative: data });
}
