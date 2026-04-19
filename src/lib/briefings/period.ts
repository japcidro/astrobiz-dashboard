import type { BriefingType, PeriodRange } from "./types";

// Convert a JS Date to YYYY-MM-DD in PHT (Asia/Manila, UTC+8).
function toPHTDateString(d: Date): string {
  const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return pht.toISOString().slice(0, 10);
}

function formatRangeLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  };
  const startStr = start.toLocaleDateString("en-PH", opts);
  const endStr = end.toLocaleDateString("en-PH", opts);
  return `${startStr} – ${endStr}`;
}

export function getPeriod(type: BriefingType, now: Date = new Date()): PeriodRange {
  const phtNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);

  if (type === "morning") {
    // Yesterday in PHT
    const y = new Date(phtNow);
    y.setUTCDate(y.getUTCDate() - 1);
    const dateStr = y.toISOString().slice(0, 10);
    const label = y.toLocaleDateString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Manila",
    });
    return {
      start: y,
      end: y,
      label,
      dateFilter: "yesterday",
      datePreset: "yesterday",
    };
  }

  if (type === "evening") {
    const dateStr = phtNow.toISOString().slice(0, 10);
    const label = phtNow.toLocaleDateString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "Asia/Manila",
    });
    return {
      start: phtNow,
      end: phtNow,
      label,
      dateFilter: "today",
      datePreset: "today",
    };
  }

  if (type === "weekly") {
    // Last 7 days ending yesterday
    const end = new Date(phtNow);
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return {
      start,
      end,
      label: `Week of ${formatRangeLabel(start, end)}`,
      dateFilter: "last_7d",
      datePreset: "last_7_days",
    };
  }

  // monthly — last 30 days
  const end = new Date(phtNow);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const label = start.toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
  return {
    start,
    end,
    label: `${label} (last 30 days)`,
    dateFilter: "last_30d",
    datePreset: "last_30_days",
  };
}

export function phtDateString(d: Date): string {
  return toPHTDateString(d);
}
