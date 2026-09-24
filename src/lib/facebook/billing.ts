/**
 * Ad account billing — the pieces of an AdAccount that say whether Meta is
 * still delivering ads for it, and what it would take to make it deliver
 * again.
 *
 * Meta has no API for settling a balance. The token can read the balance,
 * the funding source and the reason an account was shut off, but paying
 * happens on Meta's own Billing page, so this module's job is to say
 * *which* account needs paying, *how much*, and to build the link that
 * lands on that account's "Pay now" button.
 */

export type AccountStatusLabel =
  | "ACTIVE"
  | "DISABLED"
  | "UNSETTLED"
  | "PENDING_REVIEW"
  | "PENDING_SETTLEMENT"
  | "IN_GRACE_PERIOD"
  | "PENDING_CLOSURE"
  | "CLOSED"
  | "ANY_ACTIVE"
  | "ANY_CLOSED"
  | "UNKNOWN";

// account_status — https://developers.facebook.com/docs/marketing-api/reference/ad-account
export const ACCOUNT_STATUS_MAP: Record<number, AccountStatusLabel> = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
  201: "ANY_ACTIVE",
  202: "ANY_CLOSED",
};

// disable_reason — same reference page.
export const DISABLE_REASON_MAP: Record<number, string> = {
  0: "NONE",
  1: "ADS_INTEGRITY_POLICY",
  2: "ADS_IP_REVIEW",
  3: "RISK_PAYMENT",
  4: "GRAY_ACCOUNT_SHUT_DOWN",
  5: "ADS_AFC_REVIEW",
  6: "BUSINESS_INTEGRITY_RAR",
  7: "PERMANENT_CLOSE",
  8: "UNUSED_RESELLER_ACCOUNT",
  9: "UNUSED_ACCOUNT",
  10: "UMBRELLA_AD_ACCOUNT",
  11: "BUSINESS_MANAGER_INTEGRITY_POLICY",
  12: "MISREPRESENTATION",
  13: "AD_ACCOUNT_INTEGRITY_POLICY",
};

const DISABLE_REASON_TEXT: Record<string, string> = {
  RISK_PAYMENT: "Meta flagged a payment risk on this account.",
  ADS_INTEGRITY_POLICY: "Disabled for an ads integrity policy violation.",
  ADS_IP_REVIEW: "Disabled pending an intellectual-property review.",
  GRAY_ACCOUNT_SHUT_DOWN: "Shut down as a gray (unverified) account.",
  ADS_AFC_REVIEW: "Disabled pending an advertiser review.",
  BUSINESS_INTEGRITY_RAR: "Disabled by a business integrity review.",
  PERMANENT_CLOSE: "Permanently closed by Meta.",
  UNUSED_RESELLER_ACCOUNT: "Closed as an unused reseller account.",
  UNUSED_ACCOUNT: "Closed for inactivity.",
  UMBRELLA_AD_ACCOUNT: "Umbrella ad account — not used for delivery.",
  BUSINESS_MANAGER_INTEGRITY_POLICY:
    "Disabled by a Business Manager integrity policy.",
  MISREPRESENTATION: "Disabled for misrepresentation.",
  AD_ACCOUNT_INTEGRITY_POLICY:
    "Disabled for an ad account integrity policy violation.",
};

// funding_source_details.type
export const FUNDING_TYPE_MAP: Record<number, string> = {
  0: "Not set",
  1: "Credit / debit card",
  2: "Facebook Wallet",
  3: "Ad credit",
  4: "Extended credit",
  5: "Order",
  6: "Invoice",
  7: "Facebook token",
  8: "External funding",
  9: "Fee",
  10: "FX",
  11: "Discount",
  12: "PayPal",
  13: "PayPal billing agreement",
  14: "None",
  15: "External deposit",
  16: "Tax",
  17: "Direct debit",
  18: "Dummy",
  19: "Alternative payment",
  20: "Stored balance",
};

export type StatusTone = "ok" | "warn" | "bad" | "muted";

export interface StatusDescription {
  label: AccountStatusLabel;
  tone: StatusTone;
  /** One line: what this status means for the ads inside the account. */
  headline: string;
  /** What to do about it, if anything. */
  action: string | null;
  /** True when the fix is a payment on Meta's Billing page. */
  needsPayment: boolean;
}

export function describeAccountStatus(
  accountStatus: number,
  disableReason: number = 0
): StatusDescription {
  const label = ACCOUNT_STATUS_MAP[accountStatus] ?? "UNKNOWN";
  const reason = DISABLE_REASON_MAP[disableReason] ?? "NONE";
  const reasonText = DISABLE_REASON_TEXT[reason] ?? null;

  switch (label) {
    case "ACTIVE":
    case "ANY_ACTIVE":
      return {
        label,
        tone: "ok",
        headline: "Ads are delivering normally.",
        action: null,
        needsPayment: false,
      };
    case "UNSETTLED":
      return {
        label,
        tone: "bad",
        headline:
          "A payment failed, so Meta has stopped delivering every ad in this account.",
        action:
          "Pay the outstanding balance on Meta's Billing page. Delivery resumes on its own once the payment clears.",
        needsPayment: true,
      };
    case "PENDING_SETTLEMENT":
    case "IN_GRACE_PERIOD":
      return {
        label,
        tone: "warn",
        headline:
          "A payment failed. Ads still run for now, but Meta will shut the account off if the balance stays unpaid.",
        action:
          "Pay the outstanding balance before the grace period ends, or update the payment method.",
        needsPayment: true,
      };
    case "PENDING_REVIEW":
      return {
        label,
        tone: "warn",
        headline: "Meta is reviewing this account. Ads will not deliver until the review clears.",
        action: "Check Account Quality in Business Manager for a request-review option.",
        needsPayment: false,
      };
    case "DISABLED":
      return {
        label,
        tone: "bad",
        headline: reasonText ?? "Meta has disabled this account.",
        action:
          reason === "RISK_PAYMENT"
            ? "Settle the balance and update the payment method on Meta's Billing page, then request a review in Account Quality."
            : "Request a review in Account Quality, or move the stores to another ad account.",
        needsPayment: reason === "RISK_PAYMENT",
      };
    case "PENDING_CLOSURE":
    case "CLOSED":
    case "ANY_CLOSED":
      return {
        label,
        tone: "muted",
        headline: reasonText ?? "This account is closed or closing. No ads deliver from it.",
        action: "Move the stores running here to another ad account.",
        needsPayment: false,
      };
    default:
      return {
        label,
        tone: "muted",
        headline: `Meta reported an account status the dashboard does not know (${accountStatus}).`,
        action: "Open the account in Ads Manager to see what Meta says.",
        needsPayment: false,
      };
  }
}

/**
 * Meta returns money on the AdAccount (balance, amount_spent, spend_cap) in
 * the currency's minor unit as a string — "3132435" means ₱31,324.35.
 * Currencies with no minor unit (JPY, KRW, …) are returned as whole units.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD", "PYG", "UGX", "XAF", "XOF",
]);

export function minorToMajor(
  value: string | number | null | undefined,
  currency: string = "PHP"
): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? n : n / 100;
}

/**
 * Meta's Billing page for one ad account — the page with the "Pay now"
 * button. The Graph API cannot pay a balance; this link is the fix.
 */
export function metaBillingUrl(
  accountId: string,
  businessId: string | null | undefined
): string {
  const asset = accountId.replace(/^act_/, "");
  const params = new URLSearchParams({ asset_id: asset });
  if (businessId) params.set("business_id", businessId);
  return `https://business.facebook.com/billing_hub/accounts/details/?${params.toString()}`;
}

/** Payment methods for the account — where a declined card gets replaced. */
export function metaPaymentSettingsUrl(
  accountId: string,
  businessId: string | null | undefined
): string {
  const asset = accountId.replace(/^act_/, "");
  const params = new URLSearchParams({ asset_id: asset });
  if (businessId) params.set("business_id", businessId);
  return `https://business.facebook.com/billing_hub/payment_settings/?${params.toString()}`;
}

export function adsManagerUrl(accountId: string): string {
  const id = accountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${id}`;
}

// ─── Stores per account ───

export interface AccountStore {
  store: string;
  /** Spend over the window the rows came from (last 7 days), in ₱. */
  spend: number;
  ads: number;
  /** How we know this store runs here. */
  source: "campaigns" | "defaults";
}

/**
 * Which stores advertise from an account, from the ad rows the Ad
 * Performance cache already holds — no extra Graph calls. A store the
 * Create Ad defaults point at this account is listed even with no ads in
 * the window, because the next ad for it will land here.
 */
export function storesForAccount(
  rows: Array<{
    account_id: string;
    campaign?: string | null;
    adset?: string | null;
    spend?: number | null;
  }>,
  accountId: string,
  accountName: string,
  matcher: (campaign: string, adset: string, accountName: string) => string,
  defaultStores: string[] = []
): AccountStore[] {
  const byStore = new Map<string, AccountStore>();

  for (const row of rows) {
    if (row.account_id !== accountId) continue;
    const store = matcher(row.campaign ?? "", row.adset ?? "", accountName);
    if (!store) continue;
    const entry = byStore.get(store) ?? {
      store,
      spend: 0,
      ads: 0,
      source: "campaigns" as const,
    };
    entry.spend += row.spend ?? 0;
    entry.ads += 1;
    byStore.set(store, entry);
  }

  for (const store of defaultStores) {
    if (!byStore.has(store)) {
      byStore.set(store, { store, spend: 0, ads: 0, source: "defaults" });
    }
  }

  return Array.from(byStore.values()).sort(
    (a, b) => b.spend - a.spend || b.ads - a.ads || a.store.localeCompare(b.store)
  );
}

// ─── API response shape ───

export interface BillingAccount {
  id: string; // act_…
  account_id: string;
  name: string;
  account_status: number;
  status: StatusDescription;
  disable_reason: string;
  currency: string;
  /** Unpaid, in ₱ (major units). What "Pay now" would settle. */
  balance: number;
  /** Lifetime spend, in ₱. */
  amount_spent: number;
  /** 0 when no cap is set. */
  spend_cap: number;
  is_prepay: boolean;
  funding: {
    type: string;
    display: string | null;
    /** Unused ad credit, in ₱. */
    credits_remaining: number;
  } | null;
  business: { id: string; name: string } | null;
  timezone: string | null;
  stores: AccountStore[];
  links: {
    pay: string;
    payment_settings: string;
    ads_manager: string;
  };
}

export interface BillingResponse {
  accounts: BillingAccount[];
  summary: {
    total: number;
    active: number;
    needs_attention: number;
    needs_payment: number;
    outstanding: number;
    credits_remaining: number;
  };
  from_cache: boolean;
  stale?: boolean;
  rate_limited?: boolean;
  blocked_until?: string | null;
  refreshed_at?: string;
}
