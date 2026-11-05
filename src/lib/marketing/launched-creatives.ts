// Launched Creatives: every ad launched in a window, at ad level, with its
// first days of results and Meta's rejection history.
//
// This file holds the shapes and the pure arithmetic (windows from launch,
// verdicts, status labels) so the API route and the screen agree and the
// numbers can be unit-tested. Facebook and Supabase reads live in
//   src/lib/marketing/ad-daily-sync.ts    (per-ad per-day insights)
//   src/lib/marketing/ad-rejections.ts    (Meta's review feedback)
//   src/app/api/marketing/launched-creatives/route.ts

export interface DailyRow {
  date: string; // YYYY-MM-DD, Philippine time (the ad accounts' timezone)
  spend: number;
  purchases: number;
  purchase_value: number;
  add_to_cart: number;
  link_clicks: number;
  landing_page_views: number;
  impressions: number;
  reach: number;
}

export interface WindowTotals {
  spend: number;
  purchases: number;
  purchase_value: number;
  add_to_cart: number;
  link_clicks: number;
  landing_page_views: number;
  impressions: number;
  /** Cost per purchase; 0 when nothing sold. */
  cpp: number;
  roas: number;
  /** Link clicks over impressions, in percent. */
  ctr: number;
  /** Days of the window that have passed (a 3-day window on day 2 is 2). */
  days_elapsed: number;
  /** True once every day of the window is in the past. */
  complete: boolean;
}

export interface RejectionPolicy {
  scope: string;
  policy: string;
  description: string;
}

export interface RejectionIssue {
  level: string | null;
  type: string | null;
  summary: string | null;
  message: string | null;
  code: number | null;
}

export interface AdRejection {
  status: string; // DISAPPROVED | WITH_ISSUES as last seen
  policies: RejectionPolicy[];
  issues: RejectionIssue[];
  first_seen_at: string;
  last_seen_at: string;
  cleared_at: string | null;
}

/** The creative that ran before Fix Rejections swapped in the safe image. */
export interface OriginalCreative {
  creative_id: string;
  creative_type: "video" | "image";
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  preview_url: string | null;
}

export interface AdFix {
  fixed_at: string;
  safe_image_name: string | null;
  by_name: string | null;
  status: string; // success | partial
  /** Null when the swap did not record the old creative, or Facebook no longer returns it. */
  original: OriginalCreative | null;
}

/**
 * Green, yellow or red for a day's (or a window's) cost per purchase against
 * the bar: within the bar is good, up to half again over is in doubt, and
 * anything past that, or spend with no sale at all, is bad. No spend: nothing.
 */
export function cppTone(spend: number, purchases: number, cppBar: number): "good" | "warn" | "bad" | "none" {
  if (spend <= 0 && purchases <= 0) return "none";
  if (purchases <= 0) return "bad";
  const cpp = spend / purchases;
  if (cpp <= cppBar) return "good";
  if (cpp <= cppBar * 1.5) return "warn";
  return "bad";
}

export type ReviewState =
  | "scheduled"
  | "active"
  | "in_review"
  | "rejected"
  | "issues"
  | "paused"
  | "off"
  | "unknown";

export interface LaunchedAd {
  ad_id: string;
  account_id: string;
  account_name: string;
  ad_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  store_name: string | null;
  marketer_name: string;
  is_nursery: boolean;

  creative_type: "video" | "image";
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  preview_url: string | null;

  created_time: string | null;
  start_time: string | null;
  effective_status: string | null;
  review_state: ReviewState;

  /** PHT day the ad was launched (ad created, or the ad set's scheduled start if later). */
  launch_date: string | null;
  /** PHT day of the first impressions; null while nothing has delivered. */
  first_delivery_date: string | null;
  /** Days with impressions so far. */
  days_delivered: number;
  last_delivery_date: string | null;

  first_3_days: WindowTotals;
  first_7_days: WindowTotals;
  lifetime: WindowTotals;
  /** The original creative's results before the safe-image swap; null when never swapped. */
  before_fix: WindowTotals | null;

  /** Day-by-day from first delivery, capped for payload size. */
  daily: DailyRow[];

  rejection: AdRejection | null;
  fix: AdFix | null;
}

export interface LaunchedCreativesResponse {
  data: LaunchedAd[];
  window_days: number;
  refreshed_at: string;
  from_cache: boolean;
  /** Facebook could not be read for some part; the rest is shown. */
  warnings: string[];
}

export const WINDOW_OPTIONS = [7, 14, 30, 60, 90] as const;
export const DEFAULT_WINDOW_DAYS = 30;
/** Daily rows sent per ad: enough for the sparkline and the detail table. */
export const MAX_DAILY_ROWS = 30;

const PHT = "Asia/Manila";

/** YYYY-MM-DD of an instant in Philippine time. */
export function phtDate(input: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PHT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(input));
}

export function phtToday(now: Date = new Date()): string {
  return phtDate(now);
}

/** Add days to a YYYY-MM-DD string (no timezone arithmetic; dates are calendar days). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * The day the ad went live: the ad's creation, or the ad set's scheduled
 * start when that is later. Null when the start is still in the future.
 */
export function launchDateOf(
  createdTime: string | null,
  startTime: string | null,
  now: Date = new Date()
): { launch_date: string | null; scheduled: boolean } {
  const created = createdTime ? new Date(createdTime).getTime() : null;
  const start = startTime ? new Date(startTime).getTime() : null;
  if (start !== null && start > now.getTime()) {
    return { launch_date: null, scheduled: true };
  }
  const t = Math.max(created ?? 0, start ?? 0);
  if (!t) return { launch_date: null, scheduled: false };
  return { launch_date: phtDate(t), scheduled: false };
}

const EMPTY_TOTALS = {
  spend: 0,
  purchases: 0,
  purchase_value: 0,
  add_to_cart: 0,
  link_clicks: 0,
  landing_page_views: 0,
  impressions: 0,
};

function finish(
  sums: typeof EMPTY_TOTALS,
  daysElapsed: number,
  complete: boolean
): WindowTotals {
  return {
    ...sums,
    cpp: sums.purchases > 0 ? sums.spend / sums.purchases : 0,
    roas: sums.spend > 0 ? sums.purchase_value / sums.spend : 0,
    ctr: sums.impressions > 0 ? (sums.link_clicks / sums.impressions) * 100 : 0,
    days_elapsed: daysElapsed,
    complete,
  };
}

/** Sum the rows whose date is within [from, to] inclusive. */
export function sumRows(
  rows: DailyRow[],
  from: string | null,
  to: string | null
): typeof EMPTY_TOTALS {
  const sums = { ...EMPTY_TOTALS };
  for (const r of rows) {
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    sums.spend += r.spend;
    sums.purchases += r.purchases;
    sums.purchase_value += r.purchase_value;
    sums.add_to_cart += r.add_to_cart;
    sums.link_clicks += r.link_clicks;
    sums.landing_page_views += r.landing_page_views;
    sums.impressions += r.impressions;
  }
  return sums;
}

/**
 * The first N days from the ad's first delivery day. "First 3 days" means
 * delivery days 1, 2 and 3 on the calendar, not the three best days. A
 * window still running is marked incomplete so the screen can say so.
 */
export function windowFromStart(
  rows: DailyRow[],
  startDate: string | null,
  days: number,
  today: string
): WindowTotals {
  if (!startDate) return finish({ ...EMPTY_TOTALS }, 0, false);
  const end = addDays(startDate, days - 1);
  const elapsed = Math.max(0, Math.min(days, daysBetween(startDate, today) + 1));
  return finish(sumRows(rows, startDate, end), elapsed, end < today);
}

export function lifetimeFrom(rows: DailyRow[], startDate: string | null, today: string): WindowTotals {
  const elapsed = startDate ? Math.max(0, daysBetween(startDate, today) + 1) : 0;
  return finish(sumRows(rows, startDate, null), elapsed, false);
}

/** First and last PHT day with impressions, and how many such days. */
export function deliverySpan(rows: DailyRow[]): {
  first: string | null;
  last: string | null;
  days: number;
} {
  let first: string | null = null;
  let last: string | null = null;
  let days = 0;
  for (const r of rows) {
    if (r.impressions <= 0 && r.spend <= 0) continue;
    days += 1;
    if (!first || r.date < first) first = r.date;
    if (!last || r.date > last) last = r.date;
  }
  return { first, last, days };
}

/**
 * Everything the screen shows about an ad's numbers, from its daily rows.
 * `fixDate` (PHT day of the safe-image swap) splits the lifetime so the
 * original creative's sales are not credited to the animal picture.
 */
export function computeMetrics(
  rows: DailyRow[],
  launchDate: string | null,
  fixDate: string | null,
  today: string
): Pick<
  LaunchedAd,
  | "first_delivery_date"
  | "last_delivery_date"
  | "days_delivered"
  | "first_3_days"
  | "first_7_days"
  | "lifetime"
  | "before_fix"
  | "daily"
> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const span = deliverySpan(sorted);
  const start = span.first ?? launchDate;
  return {
    first_delivery_date: span.first,
    last_delivery_date: span.last,
    days_delivered: span.days,
    first_3_days: windowFromStart(sorted, start, 3, today),
    first_7_days: windowFromStart(sorted, start, 7, today),
    lifetime: lifetimeFrom(sorted, start, today),
    before_fix: fixDate
      ? finish(sumRows(sorted, start, addDays(fixDate, -1)), 0, true)
      : null,
    daily: sorted.filter((r) => !start || r.date >= start).slice(0, MAX_DAILY_ROWS),
  };
}

/** Facebook's effective_status, plus the schedule, as one word for the screen. */
export function reviewStateOf(
  effectiveStatus: string | null,
  scheduled: boolean
): ReviewState {
  if (scheduled) return "scheduled";
  const s = (effectiveStatus ?? "").toUpperCase();
  if (!s) return "unknown";
  if (s === "ACTIVE") return "active";
  if (s.includes("DISAPPROVED")) return "rejected";
  if (s === "WITH_ISSUES") return "issues";
  if (s === "PENDING_REVIEW" || s === "IN_PROCESS" || s === "PREAPPROVED") return "in_review";
  if (s.includes("PAUSED")) return "paused";
  if (s === "ARCHIVED" || s === "DELETED" || s === "ADSET_PAUSED" || s === "CAMPAIGN_PAUSED") return "off";
  return "unknown";
}

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  scheduled: "Scheduled",
  active: "Active",
  in_review: "In review",
  rejected: "Rejected",
  issues: "Issues",
  paused: "Paused",
  off: "Off",
  unknown: "Unknown",
};

export type Verdict = "winner" | "promising" | "mixed" | "losing" | "too_early" | "no_delivery";

export const VERDICT_LABEL: Record<Verdict, string> = {
  winner: "Winner",
  promising: "Promising",
  mixed: "Mixed",
  losing: "Losing",
  too_early: "Too early",
  no_delivery: "No delivery",
};

/**
 * A quick read of the lifetime numbers against the store's cost-per-purchase
 * bar (Julius: ILP and FOLIQ win at ₱250–420, lose at ₱540+). Winner needs
 * five sales at or under the bar; losing needs enough spend to have had a
 * fair chance. Everything in between is mixed, and under one bar of spend
 * it is too early to call.
 */
export function verdictOf(t: WindowTotals, cppBar: number): Verdict {
  if (t.impressions === 0 && t.spend === 0) return "no_delivery";
  if (t.spend < cppBar) return "too_early";
  if (t.purchases >= 5 && t.cpp <= cppBar) return "winner";
  if (t.purchases >= 2 && t.cpp <= cppBar * 1.3) return "promising";
  if (t.spend >= cppBar * 1.5 && (t.purchases === 0 || t.cpp > cppBar * 1.5)) return "losing";
  return "mixed";
}

// Ad-name prefix → marketer. Names look like "ILP-060726JO1", "CAP-043026LIN1".
// Shared with the Submitted Ad Videos screen.
const MARKETERS: { code: string; name: string }[] = [
  { code: "LIN", name: "Linette" },
  { code: "JO", name: "Jhoanna" },
];

export function attributeMarketer(adName: string): { code: string | null; name: string } {
  const found: string[] = [];
  const re = /(LIN|JO)\d*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(adName)) !== null) found.push(m[1].toUpperCase());
  const code = found[0] ?? null;
  const marketer = code ? MARKETERS.find((x) => x.code === code) : null;
  return { code, name: marketer?.name ?? (code ? code : "Unknown") };
}

/** Ads Manager, opened on one ad. `accountId` is "act_123" or "123". */
export function adsManagerUrl(accountId: string, adId: string): string {
  const act = accountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${adId}`;
}
