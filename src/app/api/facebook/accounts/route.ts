import { createClient } from "@/lib/supabase/server";
import { getEmployee } from "@/lib/supabase/get-employee";
import {
  buildCacheKey,
  getCachedResponse,
  setCachedResponse,
} from "@/lib/data-cache";
import {
  fbFetchWithLimits,
  RateLimitedError,
  getBlockedUntil,
} from "@/lib/facebook/rate-limit";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";
// 1 hour — accounts list almost never changes intra-day. Manual refresh
// (?refresh=1) bypasses this for admin-triggered re-syncs.
const ACCOUNTS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

const ACCOUNT_STATUS_MAP: Record<number, string> = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
};

export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  // Allow passing a token directly for testing before saving
  let token = searchParams.get("token");
  const forceRefresh = searchParams.get("refresh") === "1";

  const supabase = await createClient();

  if (!token) {
    const { data: tokenSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_access_token")
      .single();
    token = tokenSetting?.value || null;
  }

  if (!token) {
    return Response.json({ error: "No token provided" }, { status: 400 });
  }

  // Get selected accounts filter (RLS-scoped to current user — no FB call)
  const { data: selectedSetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "fb_selected_accounts")
    .single();

  let selectedAccountIds: string[] = [];
  try {
    selectedAccountIds = selectedSetting?.value
      ? JSON.parse(selectedSetting.value)
      : [];
  } catch {
    selectedAccountIds = [];
  }

  type AccountRow = {
    id: string;
    name: string;
    account_id: string;
    status: string;
    is_active: boolean;
  };

  const cacheKey = buildCacheKey("fb_accounts", { v: "1" });

  // Cache read — only when not forcing refresh AND we have a valid token
  // matching the cache (we don't try to scope per-token because in this
  // app there's a single Business Manager system token).
  if (!forceRefresh) {
    const cached = await getCachedResponse<{ accounts: AccountRow[] }>(
      supabase,
      cacheKey,
      ACCOUNTS_CACHE_MAX_AGE_MS
    );
    if (cached) {
      const filtered =
        selectedAccountIds.length > 0
          ? cached.data.accounts.filter((a) => selectedAccountIds.includes(a.id))
          : cached.data.accounts;
      return Response.json({
        accounts: filtered,
        from_cache: true,
        refreshed_at: cached.refreshed_at,
      });
    }
  }

  // Preflight: don't burn rate budget if FB already told us we're blocked.
  const blockedUntil = await getBlockedUntil(supabase);
  if (blockedUntil) {
    // Try to serve any stale cache rather than erroring out.
    const { data: staleRow } = await supabase
      .from("cached_api_data")
      .select("response_data, refreshed_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (staleRow) {
      const stale = staleRow.response_data as { accounts: AccountRow[] };
      const filtered =
        selectedAccountIds.length > 0
          ? stale.accounts.filter((a) => selectedAccountIds.includes(a.id))
          : stale.accounts;
      return Response.json({
        accounts: filtered,
        from_cache: true,
        stale: true,
        rate_limited: true,
        blocked_until: blockedUntil.toISOString(),
        refreshed_at: staleRow.refreshed_at,
      });
    }
    return Response.json(
      {
        error: "Facebook is rate-limiting us — try again shortly.",
        rate_limited: true,
        blocked_until: blockedUntil.toISOString(),
      },
      { status: 503 }
    );
  }

  try {
    const res = await fbFetchWithLimits(
      `${FB_API_BASE}/me/adaccounts?fields=id,name,account_id,account_status&limit=100&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
      supabase
    );

    const data = await res.json();

    if (data.error) {
      return Response.json({ error: data.error.message }, { status: 400 });
    }

    const allAccounts: AccountRow[] = (data.data || []).map(
      (a: {
        id: string;
        name: string;
        account_id: string;
        account_status: number;
      }) => ({
        id: a.id,
        name: a.name,
        account_id: a.account_id,
        status: ACCOUNT_STATUS_MAP[a.account_status] || "UNKNOWN",
        is_active: a.account_status === 1,
      })
    );

    // Cache the FULL list (pre-filter) so different users with different
    // selected-account settings can all share the cache.
    await setCachedResponse(supabase, "fb_accounts", cacheKey, {
      accounts: allAccounts,
    });

    const filtered =
      selectedAccountIds.length > 0
        ? allAccounts.filter((a) => selectedAccountIds.includes(a.id))
        : allAccounts;

    return Response.json({ accounts: filtered, from_cache: false });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      // Try to serve stale cache so the UI doesn't go blank.
      const { data: staleRow } = await supabase
        .from("cached_api_data")
        .select("response_data, refreshed_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (staleRow) {
        const stale = staleRow.response_data as { accounts: AccountRow[] };
        const filtered =
          selectedAccountIds.length > 0
            ? stale.accounts.filter((a) => selectedAccountIds.includes(a.id))
            : stale.accounts;
        return Response.json({
          accounts: filtered,
          from_cache: true,
          stale: true,
          rate_limited: true,
          blocked_until: e.blockedUntil?.toISOString() ?? null,
          refreshed_at: staleRow.refreshed_at,
        });
      }
      return Response.json(
        {
          error: e.message,
          rate_limited: true,
          blocked_until: e.blockedUntil?.toISOString() ?? null,
        },
        { status: 503 }
      );
    }
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}
