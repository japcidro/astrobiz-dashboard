import type { SupabaseClient } from "@supabase/supabase-js";
import { signBoardPaths } from "./storage";
import type {
  BoardItem,
  BoardView,
  CommentRow,
  ItemRow,
  OutputRow,
  Person,
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
    thumb_url: it.thumb_path ? signed.get(it.thumb_path) ?? null : null,
    comments: (commentsBy.get(it.id) ?? []).map((c) => ({ ...c, author_name: name(c.author_id) })),
    outputs: (outputsBy.get(it.id) ?? []).map((o) => ({
      ...o,
      added_by_name: name(o.added_by),
      file_url: o.file_path ? signed.get(o.file_path) ?? null : null,
    })),
  }));
}

/** The whole board: every card with its notes and outputs, URLs signed. */
export async function loadBoard(db: SupabaseClient): Promise<BoardView> {
  const [{ data: itemRows }, { names, people }, stores] = await Promise.all([
    db.from("marketing_board_items").select("*").order("created_at", { ascending: false }).limit(MAX_ITEMS),
    loadNames(db),
    loadStores(db),
  ]);
  const items = (itemRows ?? []) as ItemRow[];
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
    ...items.flatMap((i) => [i.video_path, i.thumb_path]),
    ...outputs.map((o) => o.file_path),
  ]);

  return { items: assemble(items, comments, outputs, names, signed), people, stores };
}

/** One card, after a change. */
export async function loadItem(db: SupabaseClient, id: string): Promise<BoardItem | null> {
  const { data: row } = await db.from("marketing_board_items").select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const item = row as ItemRow;
  const [{ data: commentRows }, { data: outputRows }, { names }] = await Promise.all([
    db.from("marketing_board_comments").select("*").eq("item_id", id).order("created_at", { ascending: true }),
    db.from("marketing_board_outputs").select("*").eq("item_id", id).order("created_at", { ascending: true }),
    loadNames(db),
  ]);
  const comments = (commentRows ?? []) as CommentRow[];
  const outputs = (outputRows ?? []) as OutputRow[];
  const signed = await signBoardPaths(db, [item.video_path, item.thumb_path, ...outputs.map((o) => o.file_path)]);
  return assemble([item], comments, outputs, names, signed)[0];
}

/** Queue the Mac worker to save a high-quality copy of the reference. */
export async function queueFetch(db: SupabaseClient, item: Pick<ItemRow, "id" | "source_url">) {
  await db.from("hook_studio_jobs").insert({
    kind: "board_fetch",
    engine: "yt-dlp",
    params: { item_id: item.id, url: item.source_url },
    status: "queued",
  });
  await db.from("marketing_board_items").update({ video_status: "pending", video_error: null }).eq("id", item.id);
}
