/**
 * Pure P&L formula functions — extracted for testability.
 * These are the EXACT same calculations used in /api/profit/daily.
 */

export const SHIPPING_RATE = 0.12; // 12% of revenue
export const RTS_WORST_CASE_RATE = 0.25; // 25% worst case
export const RTS_MIN_DELIVERED = 200; // threshold to use actual rate

/**
 * Net profit = Revenue - COGS - Ad Spend - Shipping - Returns
 */
export function calculateNetProfit(
  revenue: number,
  cogs: number,
  adSpend: number,
  shipping: number,
  returnsValue: number
): number {
  return revenue - cogs - adSpend - shipping - returnsValue;
}

/**
 * Margin % = (Net Profit / Revenue) * 100, rounded to 2 decimals
 */
export function calculateMarginPct(netProfit: number, revenue: number): number {
  if (revenue <= 0) return 0;
  return Math.round((netProfit / revenue) * 10000) / 100;
}

/**
 * Projected shipping = 12% of revenue
 */
export function calculateProjectedShipping(revenue: number): number {
  return revenue * SHIPPING_RATE;
}

/**
 * COGS for a line item = cogs_per_unit × quantity.
 * Returns 0 if SKU not found in COGS map.
 */
export function calculateLineItemCogs(
  cogsPerUnit: number | undefined,
  quantity: number
): number {
  if (cogsPerUnit == null) return 0;
  return cogsPerUnit * quantity;
}

/**
 * Total COGS for an order = sum of (cogs_per_unit × quantity) for each line item.
 */
export function calculateOrderCogs(
  lineItems: Array<{ sku: string | null; quantity: number }>,
  cogsMap: Map<string, number>,
  storeName: string
): { totalCogs: number; missingSkus: string[] } {
  let totalCogs = 0;
  const missingSkus: string[] = [];

  for (const li of lineItems) {
    const sku = (li.sku || "").toLowerCase();
    if (!sku) continue;
    const cogsKey = `${storeName}::${sku}`;
    const cogsPerUnit = cogsMap.get(cogsKey);
    if (cogsPerUnit != null) {
      totalCogs += cogsPerUnit * li.quantity;
    } else {
      missingSkus.push(`${storeName}::${li.sku}`);
    }
  }

  return { totalCogs, missingSkus };
}

/**
 * Worst-case RTS returns:
 * If a store has < 200 delivered parcels all-time,
 * returns = MAX(actual_returns, 25% of revenue).
 *
 * This means: if actual returns are LOWER than 25% of revenue,
 * we assume the worst case (25%). If actual returns are already
 * higher, we use the actual number.
 */
export function calculateWorstCaseReturns(
  actualReturns: number,
  storeRevenue: number,
  deliveredCount: number
): { returnsValue: number; isProjected: boolean } {
  if (deliveredCount >= RTS_MIN_DELIVERED) {
    // Enough data — use actual returns
    return { returnsValue: actualReturns, isProjected: false };
  }

  const worstCase = storeRevenue * RTS_WORST_CASE_RATE;

  if (worstCase > actualReturns) {
    return { returnsValue: worstCase, isProjected: true };
  }

  // Actual is already worse than 25% — use actual
  return { returnsValue: actualReturns, isProjected: false };
}

/**
 * Distribute projected returns across dates proportionally by revenue.
 * Example: if store has ₱60k on day1 and ₱40k on day2 (total ₱100k),
 * and we need to add ₱10k in projected returns,
 * day1 gets ₱6k (60%) and day2 gets ₱4k (40%).
 */
export function distributeReturnsByRevenue(
  additionalReturns: number,
  dateRevenues: Map<string, number>,
  totalRevenue: number
): Map<string, number> {
  const distribution = new Map<string, number>();

  if (totalRevenue <= 0) return distribution;

  for (const [date, dateRevenue] of dateRevenues) {
    const proportion = dateRevenue / totalRevenue;
    distribution.set(date, additionalReturns * proportion);
  }

  return distribution;
}

/**
 * Round to 2 decimal places (same as the API does).
 */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
