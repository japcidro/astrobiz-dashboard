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
const STORAGE_KEY = "astrobiz_cache";

// Restore cache from sessionStorage on load
function restoreCache() {
  if (typeof window === "undefined") return;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const entries: [string, CacheEntry][] = JSON.parse(stored);
      const now = Date.now();
      for (const [key, entry] of entries) {
        // Only restore entries that haven't expired (10 min max)
        if (now - entry.timestamp < 10 * 60 * 1000) {
          cache.set(key, entry);
        }
      }
    }
  } catch {}
}

// Persist cache to sessionStorage
function persistCache() {
  if (typeof window === "undefined") return;
  try {
    const entries = Array.from(cache.entries());
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

// Restore on module load
restoreCache();

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

  // Don't cache error responses or empty FB data (likely rate limited)
  const hasError = json.error || (json.data && Array.isArray(json.data) && json.data.length === 0 && json.totals?.count === 0);

  const now = Date.now();
  if (!hasError) {
    cache.set(cacheKey, { data: json, timestamp: now, url: cacheKey });
    persistCache();
  }

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
  if (typeof window !== "undefined") {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }
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
// Only warm Shopify endpoints in background (no rate limit issues)
// Facebook data is cached on first visit via cachedFetch (10min TTL)
// and server-side cache (10min) — no need to pre-warm
const WARM_ENDPOINTS = [
  { url: "/api/shopify/orders?date_filter=today&store=ALL", delay: 0 },
  { url: "/api/shopify/orders?date_filter=this_month&store=ALL", delay: 3000 },
  { url: "/api/shopify/inventory?store=ALL", delay: 6000 },
  { url: "/api/shopify/stores", delay: 9000 },
  { url: "/api/shopify/fulfillment", delay: 12000 },
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

  persistCache();
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
