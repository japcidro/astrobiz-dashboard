/**
 * Date formatting for J&T data. Every timestamp J&T produces is Philippine
 * time, so these all render in Asia/Manila regardless of the viewer's clock.
 */

/** "Aug 23, 2026" in PHT — J&T dates are always Philippine time. */
export function formatPhDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Aug 24, 2026, 10:05 PM" in PHT. The year matters once a gap opens up. */
export function formatPhDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function phPart(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    ...opts,
  });
}

/**
 * Collapse a submission range to the shortest unambiguous form:
 *   same day    -> "May 2, 2026"
 *   same month  -> "May 8 – 10, 2026"
 *   same year   -> "Apr 30 – May 1, 2026"
 *   otherwise   -> "Dec 30, 2025 – Jan 2, 2026"
 */
export function formatDateRange(
  min: string | null | undefined,
  max: string | null | undefined
): string {
  if (!min && !max) return "—";
  if (!min || !max) return formatPhDate(min || max);

  const opts = { month: "short", day: "numeric" } as const;
  const startFull = formatPhDate(min);
  const endFull = formatPhDate(max);
  if (startFull === endFull) return startFull;

  const sameYear = phPart(min, { year: "numeric" }) === phPart(max, { year: "numeric" });
  if (!sameYear) return `${startFull} – ${endFull}`;

  const sameMonth = phPart(min, { month: "short" }) === phPart(max, { month: "short" });
  if (sameMonth) {
    return `${phPart(min, opts)} – ${phPart(max, { day: "numeric" })}, ${phPart(max, { year: "numeric" })}`;
  }
  return `${phPart(min, opts)} – ${endFull}`;
}

/** "2 hours ago" / "3 days ago" / "3 months ago" — how stale the last upload is. */
export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30.44);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}
