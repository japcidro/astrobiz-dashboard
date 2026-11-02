/**
 * Display helpers for P&L figures.
 */

import type { StoreRtsRate } from "./types";
import { RTS_MIN_DELIVERED } from "./formulas";
import { RTS_RATE_WINDOW_DAYS } from "./jt-settlement";

/**
 * Order counts carry a fraction once the void adjustment has been applied —
 * 4 gross orders at a 12.5% expected cancellation rate is 3.5 expected to
 * survive, and that 3.5 is what AOV and CPP divide by.
 *
 * Rounding it away for display used to make the page contradict itself: the
 * summary card divided by 4 while the daily row divided by 3.5, so the same
 * day showed two different AOVs. Showing the fraction keeps every ratio on the
 * page reconcilable — revenue / orders always equals the AOV next to it.
 *
 * Whole numbers (no adjustment, or a big enough count that the fraction is
 * noise) render plainly.
 */
export function formatOrderCount(count: number): string {
  if (!Number.isFinite(count)) return "0";
  const rounded = Math.round(count);
  // Above this the fraction is smaller than the rounding of everything else
  // on the row, so a decimal is just noise.
  if (Math.abs(count - rounded) < 0.05 || Math.abs(count) >= 1000) {
    return rounded.toLocaleString("en-PH");
  }
  return count.toLocaleString("en-PH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** "22.1%" */
export function formatRtsRate(rate: number): string {
  if (!Number.isFinite(rate)) return "0%";
  return `${Math.round(rate * 1000) / 10}%`;
}

/**
 * The rate the "at current RTS" line is charged at, when one rate covers
 * the whole page: the selected store's, or the only store in the data.
 * With several stores every row mixes their rates, so there is no single
 * figure to print and this returns null; the tooltip lists them instead.
 */
export function rtsRateLabel(
  rates: Record<string, StoreRtsRate> | null | undefined,
  storeFilter: string
): string | null {
  if (!rates) return null;
  const names = Object.keys(rates);
  const wanted = storeFilter.toUpperCase();
  const pick =
    wanted !== "ALL"
      ? names.find((n) => n.toUpperCase() === wanted)
      : names.length === 1
        ? names[0]
        : undefined;
  if (!pick) return null;
  return formatRtsRate(rates[pick].rate);
}

/**
 * Every store's rate and where it was read from, for the tooltip:
 * "I LOVE PATCHES 22.1% (trailing 60d, 540 settled); NEW STORE 10% (all-time, 40 settled, thin)"
 */
export function describeRtsRates(
  rates: Record<string, StoreRtsRate> | null | undefined
): string {
  if (!rates) return "";
  return Object.entries(rates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([store, r]) => {
      const basis = r.windowed ? `trailing ${RTS_RATE_WINDOW_DAYS}d` : "all-time";
      const thin = r.settled < RTS_MIN_DELIVERED ? ", thin" : "";
      return `${store} ${formatRtsRate(r.rate)} (${basis}, ${r.settled} settled${thin})`;
    })
    .join("; ");
}
