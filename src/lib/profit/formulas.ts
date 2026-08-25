/**
 * Pure P&L formula functions — extracted for testability.
 * These are the EXACT same calculations used in /api/profit/daily.
 */

/**
 * Legacy flat shipping estimate. Superseded by the real per-parcel J&T fee —
 * kept only so historical comparisons and tests can still reference it.
 * @deprecated use calculateShippingWithProjection
 */
export const SHIPPING_RATE = 0.12; // 12% of revenue

/**
 * How many days of order age the void-settlement curve covers. Measured from
 * real data: cancellations are essentially complete by day 10-14 across every
 * store, so past this a date's revenue is taken as final.
 */
export const VOID_SETTLEMENT_DAYS = 14;
export const RTS_WORST_CASE_RATE = 0.25; // 25% worst case
export const RTS_MIN_DELIVERED = 200; // threshold to use actual rate
// Number of days a parcel needs before its J&T outcome is "settled enough"
// to trust without projection. Past this, actual delivered/returned counts
// in the J&T file are treated as truth and no further projection is added.
// Within this window, many Shopify orders haven't been picked-packed-shipped
// yet — they're invisible to the J&T data and need projection from the
// store's all-time RTS rate against the day's order count.
export const SETTLEMENT_WINDOW_DAYS = 6;

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
 * Project returns from in-transit parcels using the store's actual RTS rate.
 * Only applies when the store has enough settled data (200+ delivered).
 *
 * For stores below the threshold, the 25% worst-case rule already covers this.
 * For stores above it, in-transit parcels are unaccounted — this fills the gap.
 */
export function calculateInTransitProjectedReturns(
  deliveredCount: number,
  returnedCount: number,
  inTransitCount: number,
  avgCodPerReturn: number,
  avgShipCostPerReturn: number
): { projectedReturns: number; projectedRtsRate: number } {
  const settled = deliveredCount + returnedCount;

  if (settled < RTS_MIN_DELIVERED || inTransitCount <= 0) {
    return { projectedReturns: 0, projectedRtsRate: 0 };
  }

  const rtsRate = returnedCount / settled;
  const estimatedReturns = Math.round(inTransitCount * rtsRate);
  const projectedReturns = estimatedReturns * (avgCodPerReturn + avgShipCostPerReturn);

  return { projectedReturns, projectedRtsRate: rtsRate };
}

/**
 * Per-date returns projection from Shopify order count.
 *
 * Replaces the old in-transit-pool model for established stores. Reasoning:
 * a recent date's J&T data is incomplete because pick-pack hasn't caught up,
 * so the date shows artificially low returns and the dashboard reports
 * inflated net profit. Using the date's Shopify order count as the
 * "expected total parcels" closes that gap — every paid order eventually
 * becomes a J&T parcel (or a cancellation, which is excluded upstream).
 *
 * Only applies inside the settlement window. Past it, actual J&T data is
 * trusted as-is and no projection is added.
 *
 * Returns the ADDITIONAL returns to add on top of what's already counted.
 * If actual returns for the date already exceed the expected projection,
 * returns 0 — we don't override real data with a lower estimate.
 */
export function calculateUnsettledOrderProjection(
  orderCount: number,
  rtsRate: number,
  avgReturnCost: number,
  actualReturnsForDate: number,
  ageDays: number
): { projectedReturns: number; isProjected: boolean } {
  if (
    ageDays >= SETTLEMENT_WINDOW_DAYS ||
    orderCount <= 0 ||
    rtsRate <= 0 ||
    avgReturnCost <= 0
  ) {
    return { projectedReturns: 0, isProjected: false };
  }
  const expectedTotalReturns = orderCount * rtsRate * avgReturnCost;
  const additional = Math.max(0, expectedTotalReturns - actualReturnsForDate);
  return { projectedReturns: additional, isProjected: additional > 0 };
}

/**
 * Round to 2 decimal places (same as the API does).
 */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Orders are not cancelled when they are placed. A lead that never answers the
 * confirmation call gets deleted 3+ days later, so a young date still counts
 * revenue that is going to disappear. Measured across May-Aug 2026: by the end
 * of an order's own day essentially none of its cohort's cancellations have
 * happened yet, half land around day 4, and they are complete by day 10-14.
 *
 * Let G be the gross revenue booked on a date, v the share of it eventually
 * voided, and s(A) the share of that void value already settled at age A:
 *
 *   observed R(A) = G * (1 - v * s(A))
 *   final    R(f) = G * (1 - v)
 *   =>  R(f) = R(A) * (1 - v) / (1 - v * s(A))
 *
 * This returns that multiplier, to be applied to revenue, order count and COGS
 * alike. 1 means there is nothing left to adjust.
 */
export function calculateVoidAdjustmentFactor(
  voidRate: number,
  settledFraction: number
): number {
  if (!Number.isFinite(voidRate) || voidRate <= 0 || voidRate >= 1) return 1;
  const s = Math.min(1, Math.max(0, settledFraction));
  const denominator = 1 - voidRate * s;
  if (denominator <= 0) return 1;
  const factor = (1 - voidRate) / denominator;
  // Can only ever shrink a date — never inflate one.
  return Math.min(1, Math.max(0, factor));
}

/**
 * Read s(A) out of a stored settlement curve, where curve[i] is the share of
 * void value settled by age i. Ages past the end of the curve are fully settled.
 */
export function settledFractionForAge(
  curve: number[] | null | undefined,
  ageDays: number
): number {
  if (!curve || curve.length === 0) return 1;
  if (ageDays < 0) return 0;
  if (ageDays >= curve.length) return 1;
  const v = curve[ageDays];
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/**
 * Shipping for a date = the real J&T fee for every parcel on file, plus the
 * store's average fee for orders that have no parcel yet.
 *
 * The J&T fee is zone-based (PHP 78 to Metro Manila, up to PHP 259 for far
 * provinces), so the real per-parcel number is meaningfully better than any
 * flat rate. But J&T files are uploaded in batches and pick-pack lags the
 * order, so the newest ~3 days only have parcels for about 60% of their
 * orders. Without the projection those days would show almost no shipping
 * cost and report inflated profit.
 */
export function calculateShippingWithProjection(
  actualShippingCost: number,
  parcelCount: number,
  orderCount: number,
  avgShippingPerParcel: number
): { shipping: number; projectedParcels: number; isProjected: boolean } {
  const missing = Math.max(0, orderCount - parcelCount);
  const rate = avgShippingPerParcel > 0 ? avgShippingPerParcel : 0;
  const projected = missing * rate;
  return {
    shipping: actualShippingCost + projected,
    projectedParcels: missing,
    isProjected: missing > 0 && rate > 0,
  };
}

/**
 * Average order value. Uses the void-adjusted order count, so deleting leads
 * moves it the way it moves in reality.
 */
export function calculateAov(revenue: number, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return revenue / orderCount;
}

/**
 * Cost per purchase — ad spend divided by orders that survived confirmation.
 * Deleted leads were paid for but bought nothing, so they raise CPP.
 */
export function calculateCpp(adSpend: number, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return adSpend / orderCount;
}
