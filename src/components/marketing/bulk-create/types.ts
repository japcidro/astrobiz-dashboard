// ── Bulk create: one row per ad ─────────────────────────────────────────────
//
// Copy suggested from the image: once an image is uploaded, Claude reads it
// and writes the three copy fields (src/lib/ai/suggest-ad-copy.ts). The
// suggestion fills only fields that are still empty, and `suggested` keeps
// the exact values written so the table can tell "suggested, untouched" from
// "edited by you" and offer an undo.
//
// One row per ad. `group_id` says which ad set the ad belongs to: a row added
// with "+ Ad" next to another shares its group, and every row in a group
// carries the same `adset_name`, `adset_budget` and `existing_adset_id`. In
// "new" / "existing campaign" mode the first ad submitted in a group creates
// the ad set and the rest are added to it; in "existing ad set" mode every ad
// in the group goes into the ad set `existing_adset_id` points at.

export interface BulkAdRow {
  id: string;
  group_id: string;
  adset_name: string;
  // This ad set's budget in pesos — daily or lifetime, whichever Section B
  // uses. Null means Section B's amount.
  adset_budget: number | null;
  // "Existing ad set" mode only: the Facebook ad set this group's ads join.
  existing_adset_id: string | null;
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
  // Object URL of the uploaded image, for the thumbnail. Null for videos.
  preview_url: string | null;
  suggest_status: "idle" | "writing" | "done" | "error";
  suggest_error: string | null;
  // The last suggestion as Claude returned it (what it saw, alternatives).
  suggestion: CopySuggestion | null;
  // The suggested values this row's fields were last set to.
  suggested: { primary_text: string | null; headline: string | null; description: string | null };
}

/** What Claude saw in the image, shown on the row so the copy makes sense. */
export interface ImageRead {
  person: string;
  setting: string;
  text_on_image: string;
  product_visible: boolean;
  promo: string;
  angle: string;
}

export interface CopySuggestion {
  read: ImageRead;
  primary_text: string;
  headline: string;
  description: string;
  headline_alternatives: string[];
}

export type CopyField = "primary_text" | "headline" | "description";
export const COPY_FIELDS: CopyField[] = ["primary_text", "headline", "description"];

/** "suggested": the field still holds what was suggested; "edited": it was suggested and then changed; null: never suggested. */
export function suggestedState(row: BulkAdRow, field: CopyField): "suggested" | "edited" | null {
  const was = row.suggested[field];
  if (was == null) return null;
  return row[field] === was ? "suggested" : "edited";
}

export const NO_SUGGESTED = { primary_text: null, headline: null, description: null } as const;

// An ad set Facebook already has, offered in the "Existing Ad Set" mode's
// per-row dropdown. Budgets are in pesos; both null under a campaign budget.
export interface ExistingAdset {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
}

// "Broad 25-45 — ₱800/day — paused": enough to tell sibling ad sets apart.
export function existingAdsetLabel(a: ExistingAdset): string {
  const parts = [a.name];
  if (a.daily_budget != null) parts.push(`₱${a.daily_budget}/day`);
  else if (a.lifetime_budget != null) parts.push(`₱${a.lifetime_budget} lifetime`);
  if (a.effective_status !== "ACTIVE")
    parts.push(a.effective_status.replace(/_/g, " ").toLowerCase());
  return parts.join(" — ");
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
  adsetBudget: number | null = null,
  existingAdsetId: string | null = null
): BulkAdRow {
  return {
    id: crypto.randomUUID(),
    group_id: groupId,
    adset_name: adsetName,
    adset_budget: adsetBudget,
    existing_adset_id: existingAdsetId,
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
    preview_url: null,
    suggest_status: "idle",
    suggest_error: null,
    suggestion: null,
    suggested: { ...NO_SUGGESTED },
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
