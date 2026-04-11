/**
 * Global client-side data cache.
 * Survives navigation within the same tab.
 * All pages share this cache — if Dashboard fetches ads data,
 * Ad Performance page can reuse it without re-fetching.
 *
 * Usage:
 *   const data = await cachedFetch("/api/facebook/all-ads?date_preset=today", { ttl: 5 * 60 * 1000 });
 */

interface CacheEntry {
  data: unknown;
  timestamp: number;
  url: string;
}

const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch with client-side caching.
 * Returns cached data instantly if available and not expired.
 * Strips _t cache-buster params from the cache key.
 *
 * @param url - The fetch URL
 * @param options.ttl - Cache TTL in ms (default 5 min)
 * @param options.forceRefresh - Bypass cache and fetch fresh (adds refresh=1)
 */
export async function cachedFetch<T = unknown>(
  url: string,
  options?: { ttl?: number; forceRefresh?: boolean }
): Promise<{ data: T; cached: boolean; timestamp: number }> {
  const ttl = options?.ttl ?? DEFAULT_TTL;
  const forceRefresh = options?.forceRefresh ?? false;

  // Normalize cache key — strip _t and refresh params
  const cacheKey = url.replace(/[&?]_t=\d+/g, "").replace(/[&?]refresh=1/g, "");

  // Check cache
  if (!forceRefresh) {
    const entry = cache.get(cacheKey);
    if (entry && Date.now() - entry.timestamp < ttl) {
      return { data: entry.data as T, cached: true, timestamp: entry.timestamp };
    }
  }

  // Fetch fresh
  const fetchUrl = forceRefresh && !url.includes("refresh=1")
    ? url + (url.includes("?") ? "&" : "?") + "refresh=1"
    : url;

  const res = await fetch(fetchUrl);
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(`Server error (${res.status})`);
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);

  const now = Date.now();
  cache.set(cacheKey, { data: json, timestamp: now, url: cacheKey });

  return { data: json as T, cached: false, timestamp: now };
}

/**
 * Get the timestamp of when a URL was last fetched.
 * Returns null if never fetched.
 */
export function getLastFetchTime(url: string): number | null {
  const cacheKey = url.replace(/[&?]_t=\d+/g, "").replace(/[&?]refresh=1/g, "");
  const entry = cache.get(cacheKey);
  return entry ? entry.timestamp : null;
}

/**
 * Format "Last refreshed: X min ago" string
 */
export function formatLastRefreshed(timestamp: number | null): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * Clear all cached data
 */
export function clearCache(): void {
  cache.clear();
}
