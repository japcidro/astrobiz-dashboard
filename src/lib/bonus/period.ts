/**
 * Semi-monthly bonus cutoff periods (PHT).
 *
 * The company checks parcel volume every 15th and every end-of-month, so a
 * bonus period is either the 1st–15th or the 16th–last day of the month.
 * Everything here is pure date math on `YYYY-MM-DD` strings so it stays
 * testable and free of the local-timezone traps that bit the J&T queries.
 */

export interface BonusPeriod {
  /** Inclusive first calendar day, YYYY-MM-DD (PHT). */
  start: string;
  /** Inclusive cutoff day, YYYY-MM-DD (PHT). */
  end: string;
  /** Human label, e.g. "Sep 1–15, 2026". */
  label: string;
  /** Calendar days the full period spans (15, 13, 14, 15 or 16). */
  days_total: number;
  /** Days already counted, capped at days_total. 0 before the period starts. */
  days_elapsed: number;
  /** Days still to come, including nothing once the period has closed. */
  days_remaining: number;
  /** True once the cutoff day has passed — the average is final. */
  is_complete: boolean;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Today's calendar date in PHT (UTC+8), as YYYY-MM-DD. */
export function phtToday(now: Date = new Date()): string {
  const pht = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return toDateStr(
    pht.getUTCFullYear(),
    pht.getUTCMonth() + 1,
    pht.getUTCDate()
  );
}

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateStr(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days between two YYYY-MM-DD strings (b - a), timezone-free. */
export function daysBetween(a: string, b: string): number {
  const pa = parseDateStr(a);
  const pb = parseDateStr(b);
  const ua = Date.UTC(pa.y, pa.m - 1, pa.d);
  const ub = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((ub - ua) / 86400000);
}

/** Shift a YYYY-MM-DD string by N days. */
export function addDays(dateStr: string, delta: number): string {
  const { y, m, d } = parseDateStr(dateStr);
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  return toDateStr(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}

/**
 * The cutoff period containing `dateStr`, measured as of `asOf`
 * (defaults to the same date, i.e. a live in-progress period).
 */
export function getBonusPeriod(
  dateStr: string,
  asOf: string = dateStr
): BonusPeriod {
  const { y, m, d } = parseDateStr(dateStr);

  const firstHalf = d <= 15;
  const startDay = firstHalf ? 1 : 16;
  const endDay = firstHalf ? 15 : daysInMonth(y, m);

  const start = toDateStr(y, m, startDay);
  const end = toDateStr(y, m, endDay);
  const daysTotal = endDay - startDay + 1;

  // How far into the period we are. Clamped at both ends so a period in
  // the past reads as complete and one in the future reads as untouched.
  const elapsedRaw = daysBetween(start, asOf) + 1;
  const daysElapsed = Math.max(0, Math.min(daysTotal, elapsedRaw));

  return {
    start,
    end,
    label: `${MONTH_NAMES[m - 1]} ${startDay}–${endDay}, ${y}`,
    days_total: daysTotal,
    days_elapsed: daysElapsed,
    days_remaining: daysTotal - daysElapsed,
    is_complete: daysBetween(end, asOf) >= 1,
  };
}

/** The cutoff period immediately before the one containing `dateStr`. */
export function getPreviousBonusPeriod(
  dateStr: string,
  asOf: string = dateStr
): BonusPeriod {
  const current = getBonusPeriod(dateStr, asOf);
  return getBonusPeriod(addDays(current.start, -1), asOf);
}

/** Every calendar day in the period, as YYYY-MM-DD. */
export function periodDays(period: BonusPeriod): string[] {
  const out: string[] = [];
  for (let i = 0; i < period.days_total; i++) {
    out.push(addDays(period.start, i));
  }
  return out;
}
