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

// ============================================
// Background Refresh System
// Runs every 10 minutes, refreshes all key endpoints
// so every page shows data instantly from cache.
// ============================================

const BACKGROUND_INTERVAL = 10 * 60 * 1000; // 10 minutes
let backgroundTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

// All endpoints to keep warm — staggered to avoid rate limits
const WARM_ENDPOINTS = [
  // Facebook (heaviest — stagger these)
  { url: "/api/facebook/all-ads?date_preset=today", delay: 0 },
  { url: "/api/facebook/all-ads?date_preset=yesterday", delay: 3000 },
  { url: "/api/facebook/all-ads?date_preset=last_7d", delay: 6000 },
  { url: "/api/facebook/all-ads?date_preset=this_month", delay: 9000 },
  { url: "/api/facebook/accounts", delay: 12000 },
  { url: "/api/facebook/create/pages", delay: 15000 },
  // Shopify
  { url: "/api/shopify/orders?date_filter=today&store=ALL", delay: 18000 },
  { url: "/api/shopify/orders?date_filter=this_month&store=ALL", delay: 21000 },
  { url: "/api/shopify/inventory?store=ALL", delay: 24000 },
  { url: "/api/shopify/stores", delay: 27000 },
];

async function refreshInBackground() {
  if (isRefreshing) return;
  isRefreshing = true;

  for (const endpoint of WARM_ENDPOINTS) {
    // Wait for the stagger delay
    if (endpoint.delay > 0) {
      await new Promise((r) => setTimeout(r, endpoint.delay));
    }

    try {
      // Silently refresh — don't care about errors
      const res = await fetch(endpoint.url);
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await res.json();
          const cacheKey = endpoint.url.replace(/[&?]_t=\d+/g, "").replace(/[&?]refresh=1/g, "");
          cache.set(cacheKey, { data: json, timestamp: Date.now(), url: cacheKey });
        }
      }
    } catch {
      // Silently skip failed endpoints
    }
  }

  isRefreshing = false;
}

/**
 * Start the background refresh system.
 * Call once when the app loads (e.g., in the dashboard layout).
 * Runs immediately on first call, then every 10 minutes.
 */
export function startBackgroundRefresh(): void {
  if (backgroundTimer) return; // Already running

  // Initial warm-up after a short delay (let the current page load first)
  setTimeout(() => {
    refreshInBackground();
  }, 5000);

  // Then refresh every 10 minutes
  backgroundTimer = setInterval(() => {
    refreshInBackground();
  }, BACKGROUND_INTERVAL);
}

/**
 * Stop the background refresh system.
 */
export function stopBackgroundRefresh(): void {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
    backgroundTimer = null;
  }
}

/**
 * Check if background refresh is running
 */
export function isBackgroundRefreshActive(): boolean {
  return backgroundTimer !== null;
}
