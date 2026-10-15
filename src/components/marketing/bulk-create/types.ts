// ── Bulk create: one row per ad ─────────────────────────────────────────────
//
// One row per ad. `group_id` says which ad set the ad belongs to: a row added
// with "+ Ad" next to another shares its group, and every row in a group
// carries the same `adset_name` and `adset_budget`. The first ad submitted in a group creates the ad set
// and the rest are added to it.

export interface BulkAdRow {
  id: string;
  group_id: string;
  adset_name: string;
  // This ad set's budget in pesos — daily or lifetime, whichever Section B
  // uses. Null means Section B's amount.
  adset_budget: number | null;
  ad_name: string;
  creative_type: "image" | "video";
  image_hash: string | null;
  video_id: string | null;
  file_name: string | null;
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

// The "Default ad copy" box above the table.
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
  adsetName = "",
  adsetBudget: number | null = null
): BulkAdRow {
  return {
    id: crypto.randomUUID(),
    group_id: groupId,
    adset_name: adsetName,
    adset_budget: adsetBudget,
    ad_name: "",
    creative_type: "image",
    image_hash: null,
    video_id: null,
    file_name: null,
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

export function hasCreative(row: BulkAdRow): boolean {
  return !!row.image_hash || !!row.video_id;
}
