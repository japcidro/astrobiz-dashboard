import type { SupabaseClient } from "@supabase/supabase-js";
import { signBoardPaths } from "./storage";
import {
  archiveCutoff,
  type ArchivePage,
  type BoardItem,
  type BoardView,
  type CommentRow,
  type ItemKind,
  type ItemRow,
  type OutputRow,
  type Person,
} from "./types";

const MAX_ITEMS = 400;

type NameMap = Map<string, string>;

async function loadNames(db: SupabaseClient): Promise<{ names: NameMap; people: Person[] }> {
  const { data } = await db
    .from("employees")
    .select("id, full_name, role, is_active")
    .order("full_name");
  const rows = (data ?? []) as Array<{ id: string; full_name: string; role: string; is_active: boolean }>;
  const names: NameMap = new Map(rows.map((r) => [r.id, r.full_name]));
  // Assignable: active marketers first, then admins (the owner included).
  const people = rows
    .filter((r) => r.is_active && (r.role === "marketing" || r.role === "admin"))
    .sort((a, b) => (a.role === b.role ? a.full_name.localeCompare(b.full_name) : a.role === "marketing" ? -1 : 1))
    .map(({ id, full_name, role }) => ({ id, full_name, role }));
  return { names, people };
}

async function loadStores(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("shopify_stores").select("name").eq("is_active", true).order("name");
  return ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
}

function assemble(
  items: ItemRow[],
  comments: CommentRow[],
  outputs: OutputRow[],
  names: NameMap,
  signed: Map<string, string>
): BoardItem[] {
  const byItem = <T extends { item_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.item_id) ?? [];
      list.push(r);
      m.set(r.item_id, list);
    }
    return m;
  };
  const commentsBy = byItem(comments);
  const outputsBy = byItem(outputs);
  const name = (id: string | null) => (id ? names.get(id) ?? null : null);

  return items.map((it) => ({
    ...it,
    assignee_name: name(it.assignee_id),
    video_url: it.video_path ? signed.get(it.video_path) ?? null : null,
    image_url: it.image_path ? signed.get(it.image_path) ?? null : null,
    thumb_url: it.thumb_path ? signed.get(it.thumb_path) ?? null : null,
    comments: (commentsBy.get(it.id) ?? []).map((c) => ({ ...c, author_name: name(c.author_id) })),
    outputs: (outputsBy.get(it.id) ?? []).map((o) => ({
      ...o,
      added_by_name: name(o.added_by),
      file_url: o.file_path ? signed.get(o.file_path) ?? null : null,
    })),
  }));
}

/** Notes, outputs and signed URLs for a set of cards. */
async function hydrate(db: SupabaseClient, items: ItemRow[], names: NameMap): Promise<BoardItem[]> {
  const ids = items.map((i) => i.id);
  const [{ data: commentRows }, { data: outputRows }] = ids.length
    ? await Promise.all([
        db.from("marketing_board_comments").select("*").in("item_id", ids).order("created_at", { ascending: true }),
        db.from("marketing_board_outputs").select("*").in("item_id", ids).order("created_at", { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }];
  const comments = (commentRows ?? []) as CommentRow[];
  const outputs = (outputRows ?? []) as OutputRow[];

  const signed = await signBoardPaths(db, [
    ...items.flatMap((i) => [i.video_path, i.thumb_path, i.image_path]),
    ...outputs.map((o) => o.file_path),
  ]);
  return assemble(items, comments, outputs, names, signed);
}

/**
 * Archived cards: Done, and finished at or before the cutoff. A Done card
 * with no done_at (none today) counts as archived rather than vanishing.
 */
function archived(db: SupabaseClient, cutoff: string, select = "*", opts?: { count: "exact"; head?: boolean }) {
  return db
    .from("marketing_board_items")
    .select(select, opts)
    .eq("status", "done")
    .or(`done_at.lte."${cutoff}",done_at.is.null`);
}

const countOf = (r: { count: number | null }) => r.count ?? 0;

/**
 * The live board: To do, In progress, and cards done in the last
 * ARCHIVE_AFTER_HOURS, with their notes and outputs and URLs signed. Older
 * Done cards live in the Archive (loadArchive) and are only counted here.
 */
export async function loadBoard(db: SupabaseClient): Promise<BoardView> {
  const cutoff = archiveCutoff();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: itemRows }, { names, people }, stores, videoArchived, imageArchived, doneWeek] = await Promise.all([
    db
      .from("marketing_board_items")
      .select("*")
      .or(`status.neq.done,done_at.gt."${cutoff}"`)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
    loadNames(db),
    loadStores(db),
    archived(db, cutoff, "id", { count: "exact", head: true }).eq("kind", "video"),
    archived(db, cutoff, "id", { count: "exact", head: true }).eq("kind", "image"),
    db.from("marketing_board_items").select("id", { count: "exact", head: true }).eq("status", "done").gt("done_at", weekAgo),
  ]);
  const items = await hydrate(db, (itemRows ?? []) as ItemRow[], names);
  return {
    items,
    people,
    stores,
    archived: { video: countOf(videoArchived), image: countOf(imageArchived) },
    done_this_week: countOf(doneWeek),
  };
}

export const ARCHIVE_PAGE = 48;

/** One page of the Archive for a tab, newest finished first, with the board's filters. */
export async function loadArchive(
  db: SupabaseClient,
  opts: { kind: ItemKind; assignee?: string | null; store?: string | null; q?: string | null; offset?: number }
): Promise<ArchivePage> {
  const offset = Math.max(0, opts.offset ?? 0);
  let query = archived(db, archiveCutoff(), "*", { count: "exact" }).eq("kind", opts.kind);
  if (opts.assignee) query = query.eq("assignee_id", opts.assignee);
  if (opts.store) query = query.eq("store", opts.store);
  if (opts.q) query = query.ilike("title", `%${opts.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  const [{ data, count, error }, { names }] = await Promise.all([
    query
      .order("done_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + ARCHIVE_PAGE - 1),
    loadNames(db),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ItemRow[];
  return { items: await hydrate(db, rows, names), total: count ?? rows.length };
}

/** One card, after a change. */
export async function loadItem(db: SupabaseClient, id: string): Promise<BoardItem | null> {
  const [{ data: row }, { names }] = await Promise.all([
    db.from("marketing_board_items").select("*").eq("id", id).maybeSingle(),
    loadNames(db),
  ]);
  if (!row) return null;
  return (await hydrate(db, [row as ItemRow], names))[0];
}

/** Queue the Mac worker to save a copy of the reference: the video with yt-dlp, or the image behind a link. */
export async function queueFetch(db: SupabaseClient, item: Pick<ItemRow, "id" | "source_url"> & { kind?: ItemKind }) {
  const image = item.kind === "image";
  await db.from("hook_studio_jobs").insert({
    kind: "board_fetch",
    engine: image ? "fetch" : "yt-dlp",
    params: { item_id: item.id, url: item.source_url, ...(image ? { kind: "image" } : {}) },
    status: "queued",
  });
  await db.from("marketing_board_items").update({ video_status: "pending", video_error: null }).eq("id", item.id);
}
