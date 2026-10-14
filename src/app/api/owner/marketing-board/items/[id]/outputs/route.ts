import { requireBoardUser } from "@/lib/marketing-board/auth";
import { loadItem } from "@/lib/marketing-board/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/;

/**
 * POST — attach what was made from the reference.
 * Body: { kind: "fb_ad", draft_id }            an ad submitted through the dashboard
 *    or { kind: "upload", file_path, note? }    a video uploaded via /upload-url
 */
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireBoardUser();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db, employee } = auth;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad JSON" }, { status: 400 });

  let row: Record<string, unknown>;
  if (b.kind === "fb_ad") {
    const draftId = typeof b.draft_id === "string" && UUID.test(b.draft_id) ? b.draft_id : null;
    if (!draftId) return Response.json({ error: "Pick an ad" }, { status: 400 });
    const { data: draft } = await db
      .from("ad_drafts")
      .select("id, fb_ad_id, ad_account_id, name, ad_data, adset_data")
      .eq("id", draftId)
      .maybeSingle();
    if (!draft?.fb_ad_id) return Response.json({ error: "That ad was not submitted to Facebook" }, { status: 400 });
    const adData = (draft.ad_data ?? {}) as Record<string, unknown>;
    const adsetData = (draft.adset_data ?? {}) as Record<string, unknown>;
    const { data: dup } = await db
      .from("marketing_board_outputs")
      .select("id")
      .eq("item_id", id)
      .eq("fb_ad_id", draft.fb_ad_id)
      .maybeSingle();
    if (dup) return Response.json({ error: "That ad is already attached" }, { status: 409 });
    row = {
      item_id: id,
      kind: "fb_ad",
      draft_id: draft.id,
      fb_ad_id: draft.fb_ad_id,
      ad_account_id: draft.ad_account_id,
      ad_name: (typeof adData.name === "string" && adData.name) || draft.name,
      fb_video_id: typeof adData.video_id === "string" ? adData.video_id : null,
      start_time: typeof adsetData.start_time === "string" ? adsetData.start_time : null,
      added_by: employee.id,
    };
  } else if (b.kind === "upload") {
    const path = typeof b.file_path === "string" ? b.file_path : "";
    // An upload for this card, or a Remake Studio clip.
    if (!new RegExp(`^outputs/${id}/[0-9a-f-]{36}\\.(mp4|mov|webm)$`).test(path) && !/^remake\/[0-9a-f-]{36}\/(clips|mixed|ref)\/[0-9a-f-]{36}-[0-9a-f-]{36}\.mp4$|^remake\/[0-9a-f-]{36}\/ref\/\d+-[0-9a-f-]{36}\.mp4$/.test(path)) {
      return Response.json({ error: "Upload the video first" }, { status: 400 });
    }
    row = {
      item_id: id,
      kind: "upload",
      file_path: path,
      note: typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null,
      added_by: employee.id,
    };
  } else {
    return Response.json({ error: "kind must be fb_ad or upload" }, { status: 400 });
  }

  const { error } = await db.from("marketing_board_outputs").insert(row);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const item = await loadItem(db, id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ item });
}
