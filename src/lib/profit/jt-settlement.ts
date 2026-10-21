/**
 * How a J&T parcel's outcome settles over time, and what that means for a
 * date whose parcels are still moving.
 *
 * Measured on 5,655 waybills, July–October 2026:
 *
 *   * Luzon parcels deliver in a day (p50 1.0, p95 3.0). Luzon returns are
 *     marked "Returned" by day 4 (p50 3.9); 91% are visible by day 6.
 *   * Visayas/Mindanao parcels deliver in 4 days (p50 3.9, p95 6.7). Their
 *     returns take 10 days (p50 9.9); only 3.5% are visible by day 6 and
 *     95% by day 14.
 *   * Only ~1.5% of parcels that DO deliver arrive after the 5-day (Luzon)
 *     or 8-day (VisMin) cutoff, so "still in transit past the cutoff" is a
 *     reliable return signal.
 *
 * A flat "project for 6 days, then trust the file" rule therefore under-counts
 * VisMin returns for dates 6–8 days old (the backtest showed 61–68% of the
 * final figure). Instead, every parcel that is still open is charged its COD
 * times the chance it comes back given its region and how long it has been
 * out — a survival curve read from the store's own history.
 *
 * Everything here is pure so the route stays thin and the maths is testable.
 */

import { getProvinceCutoff } from "./province-tiers";
import { RTS_MIN_DELIVERED } from "./formulas";

export type Region = "Luzon" | "VisMin";

/** Submissions newer than this are excluded from the trailing RTS rate — their outcomes are not final yet. */
export const RTS_RATE_SETTLE_LAG_DAYS = 14;
/** Width of the trailing window the RTS rate is read from, before the lag. */
export const RTS_RATE_WINDOW_DAYS = 60;
/** The hazard curve is built from submissions in this window… */
export const HAZARD_WINDOW_DAYS = 120;
/** …but only those old enough to have fully settled. */
export const HAZARD_SETTLE_LAG_DAYS = 21;
/** Ages past this are fully settled: anything still open is a return. */
export const HAZARD_MAX_AGE_DAYS = 14;
/** Fewer open parcels than this at an age → fall back to the measured default. */
export const HAZARD_MIN_SAMPLE = 40;

/**
 * P(parcel eventually returns | still not delivered/returned at age A), by
 * region. Index = age in days since J&T submission. Measured Jul–Oct 2026;
 * used when the database does not have enough history for an age bucket.
 */
export const DEFAULT_RETURN_HAZARD: Record<Region, number[]> = {
  Luzon: [0.14, 0.37, 0.6, 0.75, 0.78, 0.66, 0.55, 0.57, 0.58, 0.74, 0.86, 0.91, 1, 1, 1],
  VisMin: [0.29, 0.29, 0.29, 0.37, 0.54, 0.75, 0.88, 0.93, 0.97, 0.99, 0.99, 0.99, 1, 1, 1],
};

export type ReturnHazardCurve = Record<Region, number[]>;

export type ParcelState = "delivered" | "returned" | "open";

export interface SettlementParcel {
  submission_date: string | null;
  signing_time?: string | null;
  province: string | null;
  classification: string | null;
  is_delivered: boolean | null;
  is_returned: boolean | null;
}

const DAY_MS = 86_400_000;
const PHT_OFFSET_MS = 8 * 3_600_000;

/** Calendar day index in Philippine time. */
export function phtDayIndex(ms: number): number {
  return Math.floor((ms + PHT_OFFSET_MS) / DAY_MS);
}

/**
 * Whole calendar days (PHT) between the parcel's J&T submission and `nowMs`.
 * null when the submission date is missing or unreadable.
 */
export function parcelAgeDays(
  submissionDate: string | null | undefined,
  nowMs: number
): number | null {
  if (!submissionDate) return null;
  const sub = new Date(submissionDate).getTime();
  if (!Number.isFinite(sub)) return null;
  return phtDayIndex(nowMs) - phtDayIndex(sub);
}

export function regionForProvince(province: string | null | undefined): Region {
  return getProvinceCutoff(province || "") === 5 ? "Luzon" : "VisMin";
}

/**
 * The parcel's state as of `nowMs`, not as of its last upload.
 *
 * The upload route stamps `classification` once, with the age the parcel had
 * on upload day. Nothing re-ran that later, so a parcel uploaded as "In
 * Transit" stayed one until it showed up in another file — and a date's
 * aged returns only appeared if someone re-uploaded an overlapping range.
 * Re-applying the cutoff here makes the P&L move with the calendar.
 */
export function resolveParcelState(parcel: SettlementParcel, nowMs: number): ParcelState {
  if (parcel.is_delivered) return "delivered";
  if (parcel.is_returned) return "returned";
  if (parcel.classification === "In Transit") {
    const age = parcelAgeDays(parcel.submission_date, nowMs);
    if (age != null && age > getProvinceCutoff(parcel.province || "")) return "returned";
  }
  return "open";
}

/**
 * Chance an open parcel of `region` at `ageDays` still comes back.
 * Past the curve's end everything still open is a return.
 */
export function returnProbabilityForOpenParcel(
  curve: ReturnHazardCurve,
  region: Region,
  ageDays: number | null
): number {
  const series = curve[region] ?? DEFAULT_RETURN_HAZARD[region];
  const age = ageDays == null || ageDays < 0 ? 0 : ageDays;
  if (age >= series.length) return 1;
  const p = series[age];
  if (!Number.isFinite(p)) return DEFAULT_RETURN_HAZARD[region][Math.min(age, DEFAULT_RETURN_HAZARD[region].length - 1)];
  return Math.min(1, Math.max(0, p));
}

/**
 * Build the hazard curve from settled history: for each age A, among parcels
 * that were still open at A, the share that ended up returned.
 *
 * Only parcels submitted between HAZARD_WINDOW_DAYS and HAZARD_SETTLE_LAG_DAYS
 * ago, with a final outcome and a signing time, are used — younger cohorts
 * would over-represent fast outcomes (Luzon deliveries) and bias the curve
 * low. Thin age buckets fall back to the measured default.
 */
export function buildReturnHazardCurve(
  parcels: SettlementParcel[],
  nowMs: number
): ReturnHazardCurve {
  const nowDay = phtDayIndex(nowMs);
  const signAges: Record<Region, { age: number; returned: boolean }[]> = { Luzon: [], VisMin: [] };

  for (const p of parcels) {
    if (!p.submission_date || !p.signing_time) continue;
    const isDelivered = !!p.is_delivered;
    // Only J&T-confirmed returns carry a signing time; our own "Returned
    // (Aged)" inference never does, so it drops out here on its own.
    const isReturned = !isDelivered && !!p.is_returned;
    if (!isDelivered && !isReturned) continue;
    const sub = new Date(p.submission_date).getTime();
    const sign = new Date(p.signing_time).getTime();
    if (!Number.isFinite(sub) || !Number.isFinite(sign)) continue;
    const subDay = phtDayIndex(sub);
    const cohortAge = nowDay - subDay;
    if (cohortAge < HAZARD_SETTLE_LAG_DAYS || cohortAge > HAZARD_WINDOW_DAYS) continue;
    const signAge = Math.max(0, phtDayIndex(sign) - subDay);
    signAges[regionForProvince(p.province)].push({ age: signAge, returned: isReturned });
  }

  const curve: ReturnHazardCurve = { Luzon: [], VisMin: [] };
  for (const region of ["Luzon", "VisMin"] as Region[]) {
    const rows = signAges[region];
    for (let a = 0; a <= HAZARD_MAX_AGE_DAYS; a++) {
      const open = rows.filter((r) => r.age > a);
      if (open.length < HAZARD_MIN_SAMPLE) {
        curve[region][a] = DEFAULT_RETURN_HAZARD[region][Math.min(a, DEFAULT_RETURN_HAZARD[region].length - 1)];
        continue;
      }
      curve[region][a] = open.filter((r) => r.returned).length / open.length;
    }
  }
  return curve;
}

export interface TrailingRtsRate {
  /** Share of settled parcels that came back. */
  rate: number;
  /** Settled parcels the rate was read from. */
  settled: number;
  /** true when read from the trailing window, false when it fell back to all-time. */
  windowed: boolean;
}

/**
 * The store's RTS rate from its recent, settled history.
 *
 * All-time rates lag: I LOVE PATCHES went from 17% (Jul–Aug) to 24% (Sep),
 * and an all-time figure would still have said 17% for most of September —
 * projecting a third too little. Reads the RTS_RATE_WINDOW_DAYS before the
 * last RTS_RATE_SETTLE_LAG_DAYS (those are not final yet), and falls back to
 * every settled parcel when the window has fewer than RTS_MIN_DELIVERED.
 *
 * `states` are the resolved states (see resolveParcelState) so aged parcels
 * count as returns here too.
 */
export function calculateTrailingRtsRate(
  parcels: { submission_date: string | null; state: ParcelState }[],
  nowMs: number
): TrailingRtsRate {
  const nowDay = phtDayIndex(nowMs);
  let winDel = 0, winRet = 0, allDel = 0, allRet = 0;
  for (const p of parcels) {
    if (p.state === "open") continue;
    const isRet = p.state === "returned";
    if (isRet) allRet++; else allDel++;
    if (!p.submission_date) continue;
    const sub = new Date(p.submission_date).getTime();
    if (!Number.isFinite(sub)) continue;
    const age = nowDay - phtDayIndex(sub);
    if (age < RTS_RATE_SETTLE_LAG_DAYS || age > RTS_RATE_SETTLE_LAG_DAYS + RTS_RATE_WINDOW_DAYS) continue;
    if (isRet) winRet++; else winDel++;
  }
  const winSettled = winDel + winRet;
  if (winSettled >= RTS_MIN_DELIVERED) {
    return { rate: winRet / winSettled, settled: winSettled, windowed: true };
  }
  const allSettled = allDel + allRet;
  return { rate: allSettled > 0 ? allRet / allSettled : 0, settled: allSettled, windowed: false };
}
