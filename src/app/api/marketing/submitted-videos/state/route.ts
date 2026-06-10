import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

// GET ?fb_ad_id=...  → current reviewed / note / starred state for one ad.
// Lets the review modal hydrate itself no matter where it's opened from
// (Submitted Videos grid or the Ad Performance "View" button).
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fbAdId = searchParams.get("fb_ad_id");
  if (!fbAdId) {
    return Response.json({ error: "Missing fb_ad_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const [review, note, star] = await Promise.all([
    supabase
      .from("fb_ad_reviews")
      .select("reviewed_at, reviewed_by, reviewer:employees!reviewed_by(full_name)")
      .eq("fb_ad_id", fbAdId)
      .maybeSingle(),
    supabase
      .from("fb_ad_notes")
      .select("note, updated_at, author:employees!updated_by(full_name)")
      .eq("fb_ad_id", fbAdId)
      .maybeSingle(),
    supabase
      .from("fb_ad_stars")
      .select("fb_ad_id")
      .eq("fb_ad_id", fbAdId)
      .maybeSingle(),
  ]);

  const reviewRow = review.data as
    | { reviewed_at: string | null; reviewer: { full_name?: string } | null }
    | null;
  const noteRow = note.data as
    | { note: string | null; updated_at: string | null; author: { full_name?: string } | null }
    | null;

  return Response.json({
    data: {
      reviewed_at: reviewRow?.reviewed_at ?? null,
      reviewed_by_name: reviewRow?.reviewer?.full_name ?? null,
      note: (noteRow?.note || "").trim() ? noteRow!.note : null,
      note_at: noteRow?.updated_at ?? null,
      note_by_name: noteRow?.author?.full_name ?? null,
      is_starred: !!star.data,
    },
  });
}
