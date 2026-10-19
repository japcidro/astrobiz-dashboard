export type BoardStatus = "todo" | "in_progress" | "done";
export const BOARD_STATUSES: BoardStatus[] = ["todo", "in_progress", "done"];
export const STATUS_LABEL: Record<BoardStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/**
 * A card stays in Done this long, then leaves the board for the Archive so
 * the board only shows live work. Nothing is written when it happens: the
 * archive is every Done card whose done_at is older than this, so moving a
 * card back to To do or In progress takes it out again.
 */
export const ARCHIVE_AFTER_HOURS = 12;
export const ARCHIVE_AFTER_MS = ARCHIVE_AFTER_HOURS * 3600_000;

/** The done_at at or before which a Done card is archived. */
export const archiveCutoff = (now = Date.now()) => new Date(now - ARCHIVE_AFTER_MS).toISOString();

export const isArchived = (item: { status: BoardStatus; done_at: string | null }, now = Date.now()) =>
  item.status === "done" && (!item.done_at || new Date(item.done_at).getTime() <= now - ARCHIVE_AFTER_MS);

export type SourceType = "tiktok" | "fb_ads_library" | "facebook" | "instagram" | "youtube" | "other";
export const SOURCE_LABEL: Record<SourceType, string> = {
  tiktok: "TikTok",
  fb_ads_library: "Ads Library",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  other: "Link",
};

export type VideoStatus = "pending" | "saving" | "ready" | "failed";

/** A video reference (today's cards) or an image reference for posts and image ads. */
export type ItemKind = "video" | "image";

export interface ItemRow {
  id: string;
  kind: ItemKind;
  /** Saved image for an image card (marketing-board bucket). */
  image_path: string | null;
  source_url: string;
  source_type: SourceType;
  title: string | null;
  author: string | null;
  external_thumbnail_url: string | null;
  embed_id: string | null;
  video_path: string | null;
  thumb_path: string | null;
  video_status: VideoStatus;
  video_error: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  status: BoardStatus;
  store: string | null;
  assignee_id: string | null;
  due_date: string | null;
  done_at: string | null;
  /** Hand-set order inside a column: smaller is higher. New cards get a negative epoch, so newest is on top. */
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  item_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface OutputRow {
  id: string;
  item_id: string;
  kind: "fb_ad" | "upload";
  fb_ad_id: string | null;
  ad_account_id: string | null;
  ad_name: string | null;
  fb_video_id: string | null;
  start_time: string | null;
  draft_id: string | null;
  file_path: string | null;
  note: string | null;
  added_by: string | null;
  created_at: string;
}

export interface CommentView extends CommentRow {
  author_name: string | null;
}

export interface OutputView extends OutputRow {
  added_by_name: string | null;
  /** Signed URL of an uploaded file; FB ads resolve their video on open. */
  file_url: string | null;
}

/** One card, with every signed URL the page needs. */
export interface BoardItem extends ItemRow {
  assignee_name: string | null;
  video_url: string | null;
  image_url: string | null;
  thumb_url: string | null;
  comments: CommentView[];
  outputs: OutputView[];
}

export interface Person {
  id: string;
  full_name: string;
  role: string;
}

export interface BoardView {
  /** Live cards: To do, In progress, and Done for the last ARCHIVE_AFTER_HOURS. */
  items: BoardItem[];
  people: Person[];
  stores: string[];
  /** Archived cards per tab. */
  archived: Record<ItemKind, number>;
  /** Cards finished in the last 7 days, archived ones included. */
  done_this_week: number;
}

/** One page of the Archive, newest finished first. */
export interface ArchivePage {
  items: BoardItem[];
  /** Matching archived cards, all pages. */
  total: number;
}

/** A submitted ad the picker can attach as an output (from ad_drafts). */
export interface SubmittedAdOption {
  draft_id: string;
  fb_ad_id: string;
  ad_account_id: string;
  ad_name: string;
  fb_video_id: string | null;
  start_time: string | null;
  submitted_at: string | null;
  employee_name: string | null;
}

export interface VideoSource {
  source: string | null;
  thumbnail: string | null;
  permalink: string | null;
  error?: string;
}
