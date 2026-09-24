import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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
import {
  describeAccountStatus,
  minorToMajor,
  metaBillingUrl,
  metaPaymentSettingsUrl,
  adsManagerUrl,
  storesForAccount,
  DISABLE_REASON_MAP,
  FUNDING_TYPE_MAP,
  type BillingAccount,
  type BillingResponse,
} from "@/lib/facebook/billing";
import { matchAdToStore } from "@/lib/profit/store-matching";

export const dynamic = "force-dynamic";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

// Five minutes: a balance changes the moment a payment clears, and this is
// the page someone watches while waiting for exactly that. ?refresh=1
// bypasses it.
const BILLING_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

// One Graph call for every account: /?ids=act_a,act_b&fields=…
const ACCOUNT_FIELDS = [
  "id",
  "name",
  "account_id",
  "account_status",
  "disable_reason",
  "balance",
  "amount_spent",
  "spend_cap",
  "currency",
  "funding_source_details",
  "is_prepay_account",
  "business{id,name}",
  "timezone_name",
].join(",");

interface GraphAccount {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
  disable_reason?: number;
  balance?: string;
  amount_spent?: string;
  spend_cap?: string;
  currency?: string;
  funding_source_details?: {
    id?: string;
    display_string?: string;
    type?: number;
    coupons?: Array<{ amount?: number }>;
  };
  is_prepay_account?: boolean;
  business?: { id: string; name: string };
  timezone_name?: string;
  error?: { message: string };
}

type CachedPayload = { accounts: BillingAccount[] };

function summarize(accounts: BillingAccount[]): BillingResponse["summary"] {
  return {
    total: accounts.length,
    active: accounts.filter((a) => a.status.tone === "ok").length,
    needs_attention: accounts.filter((a) => a.status.tone !== "ok").length,
    needs_payment: accounts.filter((a) => a.status.needsPayment).length,
    outstanding: accounts
      .filter((a) => a.status.needsPayment)
      .reduce((sum, a) => sum + a.balance, 0),
    credits_remaining: accounts.reduce(
      (sum, a) => sum + (a.funding?.credits_remaining ?? 0),
      0
    ),
  };
}

function respond(
  payload: CachedPayload,
  extra: Partial<BillingResponse> = {}
): Response {
  const body: BillingResponse = {
    accounts: payload.accounts,
    summary: summarize(payload.accounts),
    from_cache: false,
    ...extra,
  };
  return Response.json(body);
}

/**
 * GET /api/facebook/billing
 *
 * Every selected ad account with its Meta status, unpaid balance, payment
 * method, and the stores advertising from it — the answer to "which
 * account went down, and what do I pay to bring it back?".
 */
export async function GET(request: Request) {
  const employee = await getEmployee();
  if (!employee) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (employee.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";

  const supabase = await createClient();
  // Cache + rate-limit state live behind admin-only RLS; the service client
  // is how every other Facebook route reaches them.
  const db = createServiceClient();

  const [{ data: tokenSetting }, { data: selectedSetting }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "fb_access_token").single(),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fb_selected_accounts")
      .single(),
  ]);

  const token = tokenSetting?.value as string | undefined;
  if (!token) {
    return Response.json(
      { error: "Facebook token not configured. Add one in Settings → Facebook Ads." },
      { status: 400 }
    );
  }

  let selectedAccountIds: string[] = [];
  try {
    selectedAccountIds = selectedSetting?.value ? JSON.parse(selectedSetting.value) : [];
  } catch {
    selectedAccountIds = [];
  }

  const cacheKey = buildCacheKey("fb_billing", {
    v: "1",
    accounts: [...selectedAccountIds].sort().join(",") || "all",
  });

  if (!forceRefresh) {
    const cached = await getCachedResponse<CachedPayload>(
      db,
      cacheKey,
      BILLING_CACHE_MAX_AGE_MS
    );
    if (cached) {
      return respond(cached.data, {
        from_cache: true,
        refreshed_at: cached.refreshed_at,
      });
    }
  }

  const serveStale = async (extra: Partial<BillingResponse>) => {
    const { data: staleRow } = await db
      .from("cached_api_data")
      .select("response_data, refreshed_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (!staleRow) return null;
    return respond(staleRow.response_data as CachedPayload, {
      from_cache: true,
      stale: true,
      refreshed_at: staleRow.refreshed_at,
      ...extra,
    });
  };

  const blockedUntil = await getBlockedUntil(db);
  if (blockedUntil) {
    const stale = await serveStale({
      rate_limited: true,
      blocked_until: blockedUntil.toISOString(),
    });
    if (stale) return stale;
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
    // Which accounts to bill-check: the ones selected in Settings, or every
    // account the token can see when nothing was selected.
    let accountIds = selectedAccountIds;
    if (accountIds.length === 0) {
      const listRes = await fbFetchWithLimits(
        `${FB_API_BASE}/me/adaccounts?fields=id&limit=100&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
        db
      );
      const listData = await listRes.json();
      if (listData.error) {
        return Response.json({ error: listData.error.message }, { status: 400 });
      }
      accountIds = (listData.data || []).map((a: { id: string }) => a.id);
    }

    if (accountIds.length === 0) {
      return respond({ accounts: [] });
    }

    const [detailRes, defaultsResult, adsCache] = await Promise.all([
      fbFetchWithLimits(
        `${FB_API_BASE}/?ids=${accountIds.join(",")}&fields=${encodeURIComponent(ACCOUNT_FIELDS)}&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
        db
      ),
      // Store → ad account, as set in Create Ad's store defaults.
      supabase
        .from("store_ad_defaults")
        .select("ad_account_id, shopify_stores(name)"),
      // The Ad Performance cache already knows every ad and its account —
      // reuse it rather than walking three accounts' campaigns again.
      db
        .from("cached_api_data")
        .select("response_data")
        .eq("cache_key", "ads_v3:account=ALL&date_preset=last_7d")
        .maybeSingle(),
    ]);

    const detail = await detailRes.json();
    if (detail.error) {
      return Response.json({ error: detail.error.message }, { status: 400 });
    }

    const defaultsByAccount = new Map<string, string[]>();
    for (const row of defaultsResult.data ?? []) {
      const accountId = row.ad_account_id as string | null;
      const store = (row.shopify_stores as unknown as { name: string } | null)?.name;
      if (!accountId || !store) continue;
      const list = defaultsByAccount.get(accountId) ?? [];
      list.push(store.toUpperCase());
      defaultsByAccount.set(accountId, list);
    }

    const adRows =
      ((adsCache.data?.response_data as { data?: unknown } | null)?.data as
        | Array<{ account_id: string; campaign?: string; adset?: string; spend?: number }>
        | undefined) ?? [];

    const accounts: BillingAccount[] = [];
    for (const id of accountIds) {
      const a = detail[id] as GraphAccount | undefined;
      if (!a || a.error) {
        // One account the token lost access to should not blank the others.
        accounts.push({
          id,
          account_id: id.replace(/^act_/, ""),
          name: id,
          account_status: -1,
          status: {
            label: "UNKNOWN",
            tone: "muted",
            headline: a?.error?.message
              ? `Meta refused to describe this account: ${a.error.message}`
              : "Meta returned nothing for this account.",
            action: "Check the token's access to this account in Business Settings.",
            needsPayment: false,
          },
          disable_reason: "NONE",
          currency: "PHP",
          balance: 0,
          amount_spent: 0,
          spend_cap: 0,
          is_prepay: false,
          funding: null,
          business: null,
          timezone: null,
          stores: [],
          links: {
            pay: metaBillingUrl(id, null),
            payment_settings: metaPaymentSettingsUrl(id, null),
            ads_manager: adsManagerUrl(id),
          },
        });
        continue;
      }

      const currency = a.currency ?? "PHP";
      const businessId = a.business?.id ?? null;
      const funding = a.funding_source_details;

      accounts.push({
        id: a.id,
        account_id: a.account_id,
        name: a.name,
        account_status: a.account_status,
        status: describeAccountStatus(a.account_status, a.disable_reason ?? 0),
        disable_reason: DISABLE_REASON_MAP[a.disable_reason ?? 0] ?? "NONE",
        currency,
        balance: minorToMajor(a.balance, currency),
        amount_spent: minorToMajor(a.amount_spent, currency),
        spend_cap: minorToMajor(a.spend_cap, currency),
        is_prepay: a.is_prepay_account ?? false,
        funding: funding
          ? {
              type: FUNDING_TYPE_MAP[funding.type ?? 0] ?? "Unknown",
              display: funding.display_string ?? null,
              credits_remaining: minorToMajor(
                (funding.coupons ?? []).reduce((s, c) => s + (c.amount ?? 0), 0),
                currency
              ),
            }
          : null,
        business: a.business ?? null,
        timezone: a.timezone_name ?? null,
        stores: storesForAccount(
          adRows,
          a.id,
          a.name,
          matchAdToStore,
          defaultsByAccount.get(a.id) ?? []
        ),
        links: {
          pay: metaBillingUrl(a.id, businessId),
          payment_settings: metaPaymentSettingsUrl(a.id, businessId),
          ads_manager: adsManagerUrl(a.id),
        },
      });
    }

    // Problems first, then by name — the account that needs paying is the
    // one the reader came for.
    const toneRank = { bad: 0, warn: 1, muted: 2, ok: 3 } as const;
    accounts.sort(
      (x, y) =>
        toneRank[x.status.tone] - toneRank[y.status.tone] ||
        x.name.localeCompare(y.name)
    );

    const payload: CachedPayload = { accounts };
    await setCachedResponse(db, "fb_billing", cacheKey, payload).catch(() => {});

    return respond(payload, { from_cache: false });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      const stale = await serveStale({
        rate_limited: true,
        blocked_until: e.blockedUntil?.toISOString() ?? null,
      });
      if (stale) return stale;
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
      { error: e instanceof Error ? e.message : "Failed to fetch billing" },
      { status: 500 }
    );
  }
}
