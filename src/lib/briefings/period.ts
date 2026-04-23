import type { BriefingType, PeriodRange } from "./types";

const PHT_TZ = "Asia/Manila";

// YYYY-MM-DD for a Date rendered in PHT. Uses Intl so it's correct
// regardless of the Date's internal UTC timestamp — no manual +8h hacks.
function formatPhtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PHT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// A Date representing 00:00 PHT of the given YYYY-MM-DD. Using +08:00
// in the ISO string gives a single unambiguous UTC instant.
function phtMidnight(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+08:00`);
}

function addDays(d: Date, days: number): Date {
  // PHT has no DST, so simple ms arithmetic is safe for PHT midnights.
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function fullDateLabel(d: Date): string {
  return d.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: PHT_TZ,
  });
}

function formatRangeLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: PHT_TZ,
  };
  return `${start.toLocaleDateString("en-PH", opts)} – ${end.toLocaleDateString("en-PH", opts)}`;
}

export function getPeriod(
  type: BriefingType,
  now: Date = new Date()
): PeriodRange {
  const todayStr = formatPhtDate(now);
  const todayMid = phtMidnight(todayStr);

  if (type === "morning") {
    // Yesterday in PHT
    const y = addDays(todayMid, -1);
    return {
      start: y,
      end: y,
      label: fullDateLabel(y),
      dateFilter: "yesterday",
      datePreset: "yesterday",
    };
  }

  if (type === "evening") {
    return {
      start: todayMid,
      end: todayMid,
      label: fullDateLabel(todayMid),
      dateFilter: "today",
      datePreset: "today",
    };
  }

  if (type === "weekly") {
    // Last 7 days ending yesterday
    const end = addDays(todayMid, -1);
    const start = addDays(end, -6);
    return {
      start,
      end,
      label: `Week of ${formatRangeLabel(start, end)}`,
      dateFilter: "last_7d",
      datePreset: "last_7_days",
    };
  }

  // monthly — last 30 days
  const end = addDays(todayMid, -1);
  const start = addDays(end, -29);
  const monthLabel = start.toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: PHT_TZ,
  });
  return {
    start,
    end,
    label: `${monthLabel} (last 30 days)`,
    dateFilter: "last_30d",
    datePreset: "last_30_days",
  };
}

export function phtDateString(d: Date): string {
  return formatPhtDate(d);
}
