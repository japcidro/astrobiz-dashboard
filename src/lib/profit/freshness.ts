/**
 * How old the J&T parcel data behind the P&L is, and what that means for
 * the reader.
 *
 * Every open parcel is settled at the age it had when its status was last
 * uploaded (see jt-settlement.ts), so a gap in uploads never inflates the
 * expected returns. It does freeze them: a parcel delivered on Saturday keeps
 * its Friday chance of coming back until Monday's file says otherwise. A
 * young date can therefore sit on a low projected profit for days while the
 * courier has long since settled it. The page has to say that the number is
 * waiting on an upload, not on J&T.
 */

/** Past this many hours since the last upload, the profit page calls the data stale. */
export const JT_STALE_AFTER_HOURS = 24;

const HOUR_MS = 3_600_000;

/** Whole hours between the last J&T upload and `nowMs`. null when unknown. */
export function jtDataAgeHours(
  asOf: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (!asOf) return null;
  const t = new Date(asOf).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / HOUR_MS));
}

export function isJtDataStale(
  asOf: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const hours = jtDataAgeHours(asOf, nowMs);
  return hours != null && hours >= JT_STALE_AFTER_HOURS;
}

/** "3 hours", "1 day", "2 days". */
export function formatJtDataAge(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "Oct 30, 5:12 PM" (or "Oct 30" with dateOnly) in Philippine time. */
export function formatJtAsOf(
  iso: string,
  opts: { dateOnly?: boolean } = {}
): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d
    .toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      ...(opts.dateOnly ? {} : { hour: "numeric", minute: "2-digit" }),
      timeZone: "Asia/Manila",
    })
    // Newer ICU puts a narrow no-break space before AM/PM; keep it a plain space.
    .replace(/ /g, " ");
}
