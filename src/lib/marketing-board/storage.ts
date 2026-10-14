import type { SupabaseClient } from "@supabase/supabase-js";

export const BOARD_BUCKET = "marketing-board";

/** Signed read URLs last an hour; the page refetches well before that. */
const SIGNED_TTL_SECONDS = 60 * 60;

/** Sign many paths in one round trip; unknown paths come back null. */
export async function signBoardPaths(
  db: SupabaseClient,
  paths: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(paths.filter((p): p is string => !!p)));
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const { data } = await db.storage.from(BOARD_BUCKET).createSignedUrls(wanted, SIGNED_TTL_SECONDS);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

const SAFE_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** Output uploads are videos only. */
export function outputExtensionFor(mime: string): string | null {
  return SAFE_EXT[mime] ?? null;
}
