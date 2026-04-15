/**
 * ADMIN PROFIT / P&L TAB — Data Accuracy Tests
 *
 * Verifies /admin/profit data matches /api/profit/daily.
 * This is the most critical test — it cross-references:
 * - Revenue from Shopify orders
 * - COGS from cogs_items table
 * - Ad spend from Facebook
 * - Shipping from J&T deliveries (projected at 12% of revenue)
 * - Returns from J&T (with 25% worst-case RTS rule)
 * - Net profit = Revenue - COGS - Ad Spend - Shipping - Returns
 */

import { test, expect } from "@playwright/test";
import { apiFetch, parseDisplayNumber, waitForDataLoad, approxEqual } from "./helpers";

interface PnlApiResponse {
  summary: {
    revenue: number;
    order_count: number;
    cogs: number;
    ad_spend: number;
    shipping: number;
    returns_value: number;
    net_profit: number;
    margin_pct: number;
  };
  daily: Array<{
    date: string;
    revenue: number;
    order_count: number;
    cogs: number;
    ad_spend: number;
    shipping: number;
    returns_value: number;
    net_profit: number;
    margin_pct: number;
    shipping_projected: boolean;
    returns_projected: boolean;
  }>;
  stores: string[];
  missing_cogs_skus: string[];
  warnings: string[];
}

test.describe("Profit / P&L — Data Accuracy", () => {
  let apiData: PnlApiResponse;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "./e2e/.auth/session.json" });
    const page = await ctx.newPage();
    apiData = (await apiFetch(page, "/api/profit/daily?date_filter=this_month&store=ALL")) as PnlApiResponse;
    await ctx.close();
  });

  test("net profit formula: Revenue - COGS - Ad Spend - Shipping - Returns", async ({ page }) => {
    const expectedNetProfit =
      apiData.summary.revenue -
      apiData.summary.cogs -
      apiData.summary.ad_spend -
      apiData.summary.shipping -
      apiData.summary.returns_value;

    expect(approxEqual(apiData.summary.net_profit, expectedNetProfit, 1)).toBeTruthy();
  });

  test("margin percentage = net_profit / revenue * 100", async ({ page }) => {
    if (apiData.summary.revenue === 0) {
      expect(apiData.summary.margin_pct).toBe(0);
      return;
    }

    const expectedMargin = (apiData.summary.net_profit / apiData.summary.revenue) * 100;
    expect(approxEqual(apiData.summary.margin_pct, expectedMargin, 0.1)).toBeTruthy();
  });

  test("summary totals = sum of daily rows", async ({ page }) => {
    const dailyTotals = apiData.daily.reduce(
      (acc, row) => ({
        revenue: acc.revenue + row.revenue,
        cogs: acc.cogs + row.cogs,
        ad_spend: acc.ad_spend + row.ad_spend,
        shipping: acc.shipping + row.shipping,
        returns_value: acc.returns_value + row.returns_value,
        order_count: acc.order_count + row.order_count,
      }),
      { revenue: 0, cogs: 0, ad_spend: 0, shipping: 0, returns_value: 0, order_count: 0 }
    );

    expect(approxEqual(apiData.summary.revenue, dailyTotals.revenue, 1)).toBeTruthy();
    expect(approxEqual(apiData.summary.cogs, dailyTotals.cogs, 1)).toBeTruthy();
    expect(approxEqual(apiData.summary.ad_spend, dailyTotals.ad_spend, 1)).toBeTruthy();
    expect(approxEqual(apiData.summary.shipping, dailyTotals.shipping, 1)).toBeTruthy();
    expect(approxEqual(apiData.summary.returns_value, dailyTotals.returns_value, 1)).toBeTruthy();
    expect(apiData.summary.order_count).toBe(dailyTotals.order_count);
  });

  test("each daily row net_profit is correctly calculated", async ({ page }) => {
    for (const row of apiData.daily) {
      const expected = row.revenue - row.cogs - row.ad_spend - row.shipping - row.returns_value;
      expect(approxEqual(row.net_profit, expected, 0.1)).toBeTruthy();
    }
  });

  test("each daily row margin_pct is correct", async ({ page }) => {
    for (const row of apiData.daily) {
      if (row.revenue === 0) {
        expect(row.margin_pct).toBe(0);
      } else {
        const expected = (row.net_profit / row.revenue) * 100;
        expect(approxEqual(row.margin_pct, expected, 0.1)).toBeTruthy();
      }
    }
  });

  test("shipping is always 12% of revenue (projected)", async ({ page }) => {
    for (const row of apiData.daily) {
      if (row.revenue > 0) {
        const expectedShipping = row.revenue * 0.12;
        expect(approxEqual(row.shipping, expectedShipping, 0.1)).toBeTruthy();
        expect(row.shipping_projected).toBe(true);
      }
    }
  });

  test("daily rows are sorted by date descending", async ({ page }) => {
    for (let i = 1; i < apiData.daily.length; i++) {
      expect(apiData.daily[i - 1].date >= apiData.daily[i].date).toBeTruthy();
    }
  });

  test("summary cards on page match API", async ({ page }) => {
    if (apiData.summary.revenue === 0 && apiData.daily.length === 0) {
      test.skip();
      return;
    }

    await page.goto("/admin/profit");
    await waitForDataLoad(page);

    // Click "This Month" filter
    await page.getByText("This Month").click();
    await waitForDataLoad(page);

    const cards = page.locator(".rounded-xl").filter({ has: page.locator(".text-xs") });

    // Revenue
    const revenueCard = cards.filter({ hasText: "Revenue" }).first();
    const revenueValue = await revenueCard.locator("p.text-lg.font-bold").textContent();
    const displayRevenue = parseDisplayNumber(revenueValue || "0");
    expect(approxEqual(displayRevenue, apiData.summary.revenue, 2)).toBeTruthy();

    // Net Profit
    const profitCard = cards.filter({ hasText: "Net Profit" });
    const profitValue = await profitCard.locator("p.text-lg.font-bold").textContent();
    const displayProfit = parseDisplayNumber(profitValue || "0");
    expect(approxEqual(displayProfit, Math.abs(apiData.summary.net_profit), 2)).toBeTruthy();
  });

  test("P&L table row count matches daily data", async ({ page }) => {
    if (apiData.daily.length === 0) {
      test.skip();
      return;
    }

    await page.goto("/admin/profit");
    await waitForDataLoad(page);

    await page.getByText("This Month").click();
    await waitForDataLoad(page);

    // Table should have one row per day + possibly a totals row
    const tableRows = page.locator("table tbody tr");
    const rowCount = await tableRows.count();
    // At least as many rows as daily data (may have totals row)
    expect(rowCount).toBeGreaterThanOrEqual(apiData.daily.length);
  });

  test("revenue cross-check: P&L revenue matches orders revenue for same period", async ({ page }) => {
    // Fetch orders for this month to cross-reference revenue
    const ordersData = (await apiFetch(
      page,
      "/api/shopify/orders?date_filter=this_month&store=ALL&status=all"
    )) as { summary: { total_revenue: number }; orders: Array<{ total_price: string; cancelled_at: string | null; financial_status: string }> };

    // P&L excludes cancelled and voided/refunded orders
    const pnlOrders = ordersData.orders.filter(
      (o) => !o.cancelled_at && o.financial_status !== "voided" && o.financial_status !== "refunded"
    );
    const pnlRevenue = pnlOrders.reduce((sum, o) => sum + parseFloat(o.total_price), 0);

    // Revenue should match (within tolerance for timing/caching differences)
    expect(approxEqual(apiData.summary.revenue, pnlRevenue, 100)).toBeTruthy();
  });

  test("missing COGS SKUs are reported", async ({ page }) => {
    // If there are missing COGS, they should be reported in the response
    if (apiData.missing_cogs_skus.length > 0) {
      // Each missing SKU should be in "StoreName::SKU" format
      for (const sku of apiData.missing_cogs_skus) {
        expect(sku).toContain("::");
      }
    }
  });

  test("store filter narrows data correctly", async ({ page }) => {
    if (apiData.stores.length < 1) {
      test.skip();
      return;
    }

    const firstStore = apiData.stores[0];
    const filteredData = (await apiFetch(
      page,
      `/api/profit/daily?date_filter=this_month&store=${encodeURIComponent(firstStore)}`
    )) as PnlApiResponse;

    // Filtered revenue should be <= total revenue
    expect(filteredData.summary.revenue).toBeLessThanOrEqual(apiData.summary.revenue + 1);
    // Filtered should still have valid net profit formula
    const expectedNetProfit =
      filteredData.summary.revenue -
      filteredData.summary.cogs -
      filteredData.summary.ad_spend -
      filteredData.summary.shipping -
      filteredData.summary.returns_value;
    expect(approxEqual(filteredData.summary.net_profit, expectedNetProfit, 1)).toBeTruthy();
  });
});
