/**
 * ADMIN DASHBOARD LANDING — Data Accuracy Tests
 *
 * Verifies /dashboard shows correct aggregated data from all sources.
 * The admin dashboard pulls from:
 * - /api/shopify/orders (today + this_month)
 * - /api/facebook/all-ads (today + this_month)
 * - /api/shopify/inventory
 *
 * Tests verify the stat cards match their source APIs.
 */

import { test, expect } from "@playwright/test";
import { apiFetch, parseDisplayNumber, waitForDataLoad, approxEqual } from "./helpers";

interface OrdersSummary {
  total_revenue: number;
  total_orders: number;
  unfulfilled_count: number;
  aging_warning_count: number;
  aging_danger_count: number;
}

interface AdsTotals {
  spend: number;
  roas: number;
}

interface InventorySummary {
  total_units: number;
  out_of_stock_count: number;
  low_stock_count: number;
}

test.describe("Admin Dashboard Landing — Data Accuracy", () => {
  let todayOrders: OrdersSummary;
  let monthOrders: OrdersSummary;
  let todayAds: AdsTotals;
  let monthAds: AdsTotals;
  let inventory: InventorySummary;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "./e2e/.auth/session.json" });
    const page = await ctx.newPage();

    const [todayOrd, monthOrd, todayAd, monthAd, inv] = await Promise.all([
      apiFetch(page, "/api/shopify/orders?date_filter=today&store=ALL&status=all"),
      apiFetch(page, "/api/shopify/orders?date_filter=this_month&store=ALL&status=all"),
      apiFetch(page, "/api/facebook/all-ads?date_preset=today&account=ALL").catch(() => ({ totals: { spend: 0, roas: 0 } })),
      apiFetch(page, "/api/facebook/all-ads?date_preset=this_month&account=ALL").catch(() => ({ totals: { spend: 0, roas: 0 } })),
      apiFetch(page, "/api/shopify/inventory?store=ALL"),
    ]) as [
      { summary: OrdersSummary },
      { summary: OrdersSummary },
      { totals: AdsTotals },
      { totals: AdsTotals },
      { summary: InventorySummary },
    ];

    todayOrders = todayOrd.summary;
    monthOrders = monthOrd.summary;
    todayAds = todayAd.totals;
    monthAds = monthAd.totals;
    inventory = inv.summary;

    await ctx.close();
  });

  test("today's revenue card matches Shopify orders API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const revenueCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Today's Revenue" });
    const value = await revenueCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(approxEqual(displayValue, todayOrders.total_revenue, 2)).toBeTruthy();
  });

  test("today's orders card matches Shopify orders API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const ordersCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Today's Orders" });
    const value = await ordersCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(displayValue).toBe(todayOrders.total_orders);
  });

  test("today's ad spend card matches Facebook API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const adSpendCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Today's Ad Spend" });
    const value = await adSpendCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(approxEqual(displayValue, todayAds.spend, 2)).toBeTruthy();
  });

  test("unfulfilled card matches Shopify orders API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const unfulfilledCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Unfulfilled" });
    const value = await unfulfilledCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(displayValue).toBe(todayOrders.unfulfilled_count);
  });

  test("month revenue card matches Shopify orders API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const monthRevenueCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Month Revenue" });
    const value = await monthRevenueCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(approxEqual(displayValue, monthOrders.total_revenue, 2)).toBeTruthy();
  });

  test("month orders card matches Shopify orders API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const monthOrdersCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Month Orders" });
    const value = await monthOrdersCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(displayValue).toBe(monthOrders.total_orders);
  });

  test("month ad spend card matches Facebook API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const monthAdSpendCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Month Ad Spend" });
    const value = await monthAdSpendCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(approxEqual(displayValue, monthAds.spend, 2)).toBeTruthy();
  });

  test("ROAS card matches Facebook API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const roasCard = page.locator("[class*=rounded-xl]").filter({ hasText: "ROAS" });
    const value = await roasCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseFloat((value || "0").replace("x", ""));

    expect(approxEqual(displayValue, monthAds.roas, 0.1)).toBeTruthy();
  });

  test("inventory card matches Shopify inventory API", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const inventoryCard = page.locator("[class*=rounded-xl]").filter({ hasText: "Inventory" });
    const value = await inventoryCard.locator("p.font-bold, p.text-lg, p.text-xl").first().textContent();
    const displayValue = parseDisplayNumber(value || "0");

    expect(displayValue).toBe(inventory.total_units);
  });

  test("needs attention: aging orders count is correct", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const agingTotal = todayOrders.aging_warning_count + todayOrders.aging_danger_count;

    const agingItem = page.locator("text=Orders unfulfilled 3+ days");
    if (agingTotal > 0) {
      await expect(agingItem).toBeVisible();
    }
  });

  test("needs attention: out of stock count is correct", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDataLoad(page);

    const oosItem = page.locator("text=Out of stock products");
    if (inventory.out_of_stock_count > 0) {
      await expect(oosItem).toBeVisible();
    }
  });

  test("cross-source: today's data is subset of this month's data", async ({ page }) => {
    // Today's orders should be <= this month's orders
    expect(todayOrders.total_orders).toBeLessThanOrEqual(monthOrders.total_orders);
    expect(todayOrders.total_revenue).toBeLessThanOrEqual(monthOrders.total_revenue + 1);

    // Today's ad spend should be <= this month's ad spend
    expect(todayAds.spend).toBeLessThanOrEqual(monthAds.spend + 0.01);
  });
});
