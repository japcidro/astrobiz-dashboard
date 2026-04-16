import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side data cache backed by Supabase.
 * Stores pre-computed API responses for instant page loads.
 */

const MAX_STALENESS = 30 * 60 * 1000; // 30 min — fallback if cron hasn't run

export function buildCacheKey(type: string, params: Record<string, string>): string {
  const sorted = Object.entries(params)
    .filter(([, v]) => v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${type}:${sorted}`;
}

export async function getCachedResponse<T>(
  supabase: SupabaseClient,
  cacheKey: string,
  maxAge?: number
): Promise<{ data: T; refreshed_at: string } | null> {
  const staleness = maxAge ?? MAX_STALENESS;

  const { data } = await supabase
    .from("cached_api_data")
    .select("response_data, refreshed_at")
    .eq("cache_key", cacheKey)
    .single();

  if (!data) return null;

  const age = Date.now() - new Date(data.refreshed_at).getTime();
  if (age > staleness) return null;

  return {
    data: data.response_data as T,
    refreshed_at: data.refreshed_at,
  };
}

export async function setCachedResponse(
  supabase: SupabaseClient,
  cacheType: string,
  cacheKey: string,
  responseData: unknown
): Promise<void> {
  await supabase
    .from("cached_api_data")
    .upsert(
      {
        cache_type: cacheType,
        cache_key: cacheKey,
        response_data: responseData,
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );
}
