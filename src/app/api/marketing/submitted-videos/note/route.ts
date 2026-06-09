import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// POST { fb_ad_id, note } → save (or clear, if empty) a note on an ad.
// Admin only — the CEO's feedback on a creative.
export async function POST(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { fb_ad_id?: string; note?: string };
  if (!body.fb_ad_id) {
    return Response.json({ error: "Missing fb_ad_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const note = (body.note ?? "").trim();

  // Empty note → remove the row (clears the indicator).
  if (!note) {
    const { error } = await supabase
      .from("fb_ad_notes")
      .delete()
      .eq("fb_ad_id", body.fb_ad_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      data: { note: null, note_at: null, note_by_name: null },
    });
  }

  const { data, error } = await supabase
    .from("fb_ad_notes")
    .upsert(
      { fb_ad_id: body.fb_ad_id, note, updated_by: employee.id },
      { onConflict: "fb_ad_id" }
    )
    .select("note, updated_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    data: {
      note: data.note,
      note_at: data.updated_at,
      note_by_name: employee.full_name,
    },
  });
}
