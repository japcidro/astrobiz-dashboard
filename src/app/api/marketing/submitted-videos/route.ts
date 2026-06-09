import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { SubmittedAd } from "@/lib/marketing/submitted-videos";

export const dynamic = "force-dynamic";

// Shape of a raw ad_drafts row with the embeds we request below.
interface DraftRow {
  id: string;
  employee_id: string;
  ad_account_id: string;
  name: string;
  ad_data: Record<string, unknown> | null;
  adset_data: Record<string, unknown> | null;
  fb_ad_id: string | null;
  fb_campaign_id: string | null;
  fb_adset_id: string | null;
  submitted_at: string | null;
  shopify_store_id: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  marketer: { full_name: string | null; email: string | null } | null;
  reviewer: { full_name: string | null } | null;
  store: { name: string | null } | null;
}

const SELECT =
  "id, employee_id, ad_account_id, name, ad_data, adset_data, fb_ad_id, fb_campaign_id, fb_adset_id, submitted_at, shopify_store_id, reviewed_at, reviewed_by, " +
  "marketer:employees!employee_id(full_name, email), " +
  "reviewer:employees!reviewed_by(full_name), " +
  "store:shopify_stores!shopify_store_id(name)";

function toSubmittedAd(row: DraftRow): SubmittedAd {
  const ad = (row.ad_data ?? {}) as Record<string, unknown>;
  const adset = (row.adset_data ?? {}) as Record<string, unknown>;
  const videoId = (ad.video_id as string | null) ?? null;
  const imageHash = (ad.image_hash as string | null) ?? null;

  return {
    id: row.id,
    ad_name: (ad.name as string) || row.name || "Submitted Ad",
    creative_type: videoId ? "video" : "image",
    video_id: videoId,
    image_hash: imageHash,
    file_name: (ad.file_name as string | null) ?? null,
    primary_text: (ad.primary_text as string | null) ?? null,
    headline: (ad.headline as string | null) ?? null,
    marketer_id: row.employee_id,
    marketer_name: row.marketer?.full_name || row.marketer?.email || "Unknown",
    marketer_email: row.marketer?.email || "",
    submitted_at: row.submitted_at,
    fb_ad_id: row.fb_ad_id,
    fb_campaign_id: row.fb_campaign_id,
    fb_adset_id: row.fb_adset_id,
    ad_account_id: row.ad_account_id,
    start_time: (adset.start_time as string | null) ?? null,
    store_id: row.shopify_store_id,
    store_name: row.store?.name ?? null,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    reviewed_by_name: row.reviewer?.full_name ?? null,
  };
}

export async function GET() {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const isMarketing = employee.role === "marketing";

  // Marketers see only their own submissions; admin sees everyone's.
  const { data, error } = await fetchAllRows<DraftRow>(
    () => {
      let q = supabase
        .from("ad_drafts")
        .select(SELECT)
        .eq("status", "submitted");
      if (isMarketing) q = q.eq("employee_id", employee.id);
      return q;
    },
    { orderColumn: "id", ascending: true }
  );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const ads = data
    .map(toSubmittedAd)
    // Newest submissions first.
    .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));

  return Response.json({ data: ads });
}

// Mark / unmark a submission as reviewed. Admin only — "reviewed" is the
// CEO's signal that they've watched this ad.
export async function PATCH(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { id?: string; reviewed?: boolean };
  if (!body.id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const supabase = await createClient();
  const reviewed = body.reviewed !== false; // default: mark reviewed

  const { data, error } = await supabase
    .from("ad_drafts")
    .update({
      reviewed_at: reviewed ? new Date().toISOString() : null,
      reviewed_by: reviewed ? employee.id : null,
    })
    .eq("id", body.id)
    .eq("status", "submitted")
    .select("id, reviewed_at, reviewed_by")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    data: {
      id: data.id,
      reviewed_at: data.reviewed_at,
      reviewed_by: data.reviewed_by,
      reviewed_by_name: reviewed ? employee.full_name : null,
    },
  });
}
