import { createClient } from "@/lib/supabase/server";
import { fbGet } from "@/lib/fb-ads-module/fb-api";

/** Read the shared System-User Facebook token from app_settings. */
export async function getSystemToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_access_token")
    .single();
  return (data?.value as string) || null;
}

/**
 * Derive a Page access token for the given page from the system-user token.
 * Works when the system user is assigned to the page. Falls back to the
 * system token itself when a page token can't be derived.
 */
export async function getPageToken(pageId: string): Promise<string | null> {
  const systemToken = await getSystemToken();
  if (!systemToken) return null;
  try {
    const info = await fbGet(`/${pageId}`, systemToken, { fields: "access_token" });
    if (typeof info.access_token === "string" && info.access_token) {
      return info.access_token;
    }
  } catch {
    // keep systemToken fallback
  }
  return systemToken;
}
