/**
 * Display helpers for P&L figures.
 */

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
