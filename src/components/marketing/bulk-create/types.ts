// ── Bulk create: one row per ad ─────────────────────────────────────────────
//
// Rows stay a flat list (that is what gets submitted, one request per ad), and
// `group_id` says which ad set each ad belongs to. Every row in a group carries
// the same `adset_name`; the first ad submitted in a group creates the ad set
// and the rest are added to it.

export interface BulkAdRow {
  id: string;
  group_id: string;
  adset_name: string;
  ad_name: string;
  creative_type: "image" | "video";
  image_hash: string | null;
  video_id: string | null;
  file_name: string | null;
  // Local object URL for the thumbnail. Browser-only, never sent anywhere.
  preview_url: string | null;
  primary_text: string;
  headline: string;
  description: string;
  status: "pending" | "uploading" | "submitting" | "done" | "error";
  error: string | null;
}

export interface AdSetGroup {
  group_id: string;
  adset_name: string;
  rows: BulkAdRow[];
}

// Shared copy that any ad leaves blank falls back to.
export interface DefaultCopy {
  primary_text: string;
  headline: string;
  description: string;
}

export const EMPTY_COPY: DefaultCopy = {
  primary_text: "",
  headline: "",
  description: "",
};

export function makeEmptyRow(
  groupId: string = crypto.randomUUID(),
  adsetName = ""
): BulkAdRow {
  return {
    id: crypto.randomUUID(),
    group_id: groupId,
    adset_name: adsetName,
    ad_name: "",
    creative_type: "image",
    image_hash: null,
    video_id: null,
    file_name: null,
    preview_url: null,
    primary_text: "",
    headline: "",
    description: "",
    status: "pending",
    error: null,
  };
}

// Groups in the order they first appear in the list.
export function groupRows(rows: BulkAdRow[]): AdSetGroup[] {
  const groups = new Map<string, AdSetGroup>();
  for (const row of rows) {
    const group = groups.get(row.group_id);
    if (group) group.rows.push(row);
    else
      groups.set(row.group_id, {
        group_id: row.group_id,
        adset_name: row.adset_name,
        rows: [row],
      });
  }
  return [...groups.values()];
}

// The copy that will actually be sent for this ad: its own text, or the
// default where it was left blank.
export function resolveCopy(row: BulkAdRow, defaults: DefaultCopy): DefaultCopy {
  return {
    primary_text: row.primary_text.trim() ? row.primary_text : defaults.primary_text,
    headline: row.headline.trim() ? row.headline : defaults.headline,
    description: row.description.trim() ? row.description : defaults.description,
  };
}

export function hasCreative(row: BulkAdRow): boolean {
  return !!row.image_hash || !!row.video_id;
}

// File name without its extension — a sensible starting ad name.
export function baseFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").slice(0, 80);
}
