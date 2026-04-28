import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

interface LinkRow {
  id: string;
  fb_ad_id: string;
  fb_ad_account_id: string;
  linked_at: string;
}

// GET /api/ai/approved-scripts/[id]/links
// Returns the manual ad_approved_script_links rows for this script — the
// retroactively-tagged live ads. Drafts created via the bulk-create flow
// are NOT included here (they show up via the performance endpoint instead,
// joined through ad_drafts.source_script_id).
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
    .from("ad_approved_script_links")
    .select("id, fb_ad_id, fb_ad_account_id, linked_at")
    .eq("approved_script_id", id)
    .order("linked_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ links: (data || []) as LinkRow[] });
}
