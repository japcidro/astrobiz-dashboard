import type { SupabaseClient } from "@supabase/supabase-js";

export const HOOK_BUCKET = "hook-studio";

/** Signed read URLs last an hour; the page refetches well before that. */
const SIGNED_TTL_SECONDS = 60 * 60;

export async function signPath(
  db: SupabaseClient,
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(HOOK_BUCKET).createSignedUrl(path, SIGNED_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

/** Sign many paths in one round trip; unknown paths come back null. */
export async function signPaths(
  db: SupabaseClient,
  paths: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(paths.filter((p): p is string => !!p)));
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const { data } = await db.storage.from(HOOK_BUCKET).createSignedUrls(wanted, SIGNED_TTL_SECONDS);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

const SAFE_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extensionFor(mime: string): string | null {
  return SAFE_EXT[mime] ?? null;
}
