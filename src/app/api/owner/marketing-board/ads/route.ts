import { requireBoardUser } from "@/lib/marketing-board/auth";
import type { SubmittedAdOption } from "@/lib/marketing-board/types";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 45;

/**
 * GET ?q=  — ads submitted through the dashboard (Create / Bulk Create),
 * newest first, for the "attach an ad" picker. Every submission lands in
 * ad_drafts with its Facebook ids, so this needs no Facebook call.
 */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const since = new Date(Date.now() - DEFAULT_DAYS * 86400_000).toISOString();

  let query = auth.db
    .from("ad_drafts")
    .select("id, fb_ad_id, ad_account_id, name, ad_data, adset_data, submitted_at, employee:employees!employee_id(full_name)")
    .eq("status", "submitted")
    .not("fb_ad_id", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(60);
  query = q ? query.ilike("name", `%${q.replace(/[%_]/g, "")}%`) : query.gte("submitted_at", since);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const ads: SubmittedAdOption[] = (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      fb_ad_id: string;
      ad_account_id: string;
      name: string;
      ad_data: Record<string, unknown> | null;
      adset_data: Record<string, unknown> | null;
      submitted_at: string | null;
      employee: { full_name?: string } | { full_name?: string }[] | null;
    };
    const emp = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    return {
      draft_id: row.id,
      fb_ad_id: row.fb_ad_id,
      ad_account_id: row.ad_account_id,
      ad_name: (typeof row.ad_data?.name === "string" && row.ad_data.name) || row.name,
      fb_video_id: typeof row.ad_data?.video_id === "string" ? row.ad_data.video_id : null,
      start_time: typeof row.adset_data?.start_time === "string" ? row.adset_data.start_time : null,
      submitted_at: row.submitted_at,
      employee_name: emp?.full_name ?? null,
    };
  });
  return Response.json({ ads });
}
