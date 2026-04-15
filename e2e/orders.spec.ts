/**
 * VA ORDERS TAB — Data Accuracy Tests
 *
 * Verifies that the data displayed on /va/orders matches the raw API response
 * from /api/shopify/orders. This ensures:
 * - Summary cards (Total Orders, Revenue, Unfulfilled, etc.) are accurate
 * - Order count in the table matches the API
 * - Revenue totals match Shopify data
 * - Status filters work correctly
 */

import { test, expect } from "@playwright/test";
import { apiFetch, parseDisplayNumber, waitForDataLoad } from "./helpers";

interface OrdersApiResponse {
  orders: Array<{
    id: number;
    name: string;
    total_price: string;
    fulfillment_status: string | null;
    cancelled_at: string | null;
    is_cod: boolean;
    age_level: string;
  }>;
  summary: {
    total_orders: number;
    total_revenue: number;
    unfulfilled_count: number;
    fulfilled_count: number;
    cancelled_count: number;
    partially_fulfilled_count: number;
    avg_fulfillment_hours: number | null;
    aging_warning_count: number;
    aging_danger_count: number;
  };
  stores: Array<{ id: string; name: string }>;
  role: string;
}

test.describe("VA Orders — Data Accuracy", () => {
  let apiData: OrdersApiResponse;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "./e2e/.auth/session.json" });
    const page = await ctx.newPage();
    apiData = (await apiFetch(page, "/api/shopify/orders?date_filter=today&store=ALL&status=all")) as OrdersApiResponse;
    await ctx.close();
  });

  test("summary cards match API response", async ({ page }) => {
    await page.goto("/va/orders");
    await waitForDataLoad(page);

    // Find all summary card values — use <p> tag to avoid matching icon spans
    const cards = page.locator(".rounded-xl").filter({ has: page.locator(".text-xs.text-gray-400") });

    // Total Orders
    const totalOrdersCard = cards.filter({ hasText: /^Total Orders/ });
    const totalOrdersValue = await totalOrdersCard.locator("p.text-lg.font-bold").textContent();
    expect(parseDisplayNumber(totalOrdersValue || "0")).toBe(apiData.summary.total_orders);

    // Unfulfilled — use exact label from the component
    const unfulfilledCard = cards.filter({ has: page.locator("span.text-xs", { hasText: "Unfulfilled" }) });
    const unfulfilledValue = await unfulfilledCard.locator("p.text-lg.font-bold").textContent();
    expect(parseDisplayNumber(unfulfilledValue || "0")).toBe(apiData.summary.unfulfilled_count);

    // Fulfilled — use exact label match to avoid matching "Partially Fulfilled" / "Avg Fulfillment"
    const fulfilledCard = cards.filter({ has: page.locator("span.text-xs", { hasText: /^Fulfilled$/ }) });
    const fulfilledValue = await fulfilledCard.locator("p.text-lg.font-bold").textContent();
    expect(parseDisplayNumber(fulfilledValue || "0")).toBe(apiData.summary.fulfilled_count);

    // Cancelled
    const cancelledCard = cards.filter({ has: page.locator("span.text-xs", { hasText: "Cancelled" }) });
    const cancelledValue = await cancelledCard.locator("p.text-lg.font-bold").textContent();
    expect(parseDisplayNumber(cancelledValue || "0")).toBe(apiData.summary.cancelled_count);
  });

  test("revenue card matches API (admin only)", async ({ page }) => {
    if (apiData.role !== "admin") {
      test.skip();
      return;
    }

    await page.goto("/va/orders");
    await waitForDataLoad(page);

    const revenueCard = page.locator(".rounded-xl").filter({ hasText: "Revenue" });
    const revenueValue = await revenueCard.locator("p.text-lg.font-bold").textContent();
    const displayRevenue = parseDisplayNumber(revenueValue || "0");
    const apiRevenue = apiData.summary.total_revenue;

    // Allow ₱1 tolerance for rounding
    expect(Math.abs(displayRevenue - apiRevenue)).toBeLessThan(2);
  });

  test("order count in table matches API total", async ({ page }) => {
    await page.goto("/va/orders");
    await waitForDataLoad(page);

    // Count rows in the orders table (each order is a <tr> in tbody)
    const tableRows = page.locator("table tbody tr");
    const rowCount = await tableRows.count();

    // Should match API order count
    expect(rowCount).toBe(apiData.orders.length);
  });

  test("orders are sorted by date descending (newest first)", async ({ page }) => {
    await page.goto("/va/orders");
    await waitForDataLoad(page);

    if (apiData.orders.length < 2) {
      test.skip();
      return;
    }

    // First order name in the table should match API's first order (already sorted desc)
    const firstRow = page.locator("table tbody tr").first();
    const firstOrderName = await firstRow.locator("td").first().textContent();
    expect(firstOrderName).toContain(apiData.orders[0].name);
  });

  test("status filter: unfulfilled shows correct count", async ({ page }) => {
    // Fetch API data for unfulfilled only
    const unfulfilled = (await apiFetch(
      page,
      "/api/shopify/orders?date_filter=today&store=ALL&status=unfulfilled"
    )) as OrdersApiResponse;

    await page.goto("/va/orders");
    await waitForDataLoad(page);

    // Select "Unfulfilled" in status dropdown
    await page.locator("select").filter({ hasText: "All" }).last().selectOption("unfulfilled");
    await waitForDataLoad(page);

    const tableRows = page.locator("table tbody tr");
    const rowCount = await tableRows.count();
    expect(rowCount).toBe(unfulfilled.orders.length);
  });

  test("store dropdown lists all active stores", async ({ page }) => {
    await page.goto("/va/orders");
    await waitForDataLoad(page);

    // Find the store dropdown
    const storeSelect = page.locator("select").filter({ hasText: "All Stores" });
    const options = await storeSelect.locator("option").allTextContents();

    // Should have "All Stores" + each store
    expect(options.length).toBe(apiData.stores.length + 1); // +1 for "All Stores"
    for (const store of apiData.stores) {
      expect(options).toContain(store.name);
    }
  });

  test("individual order data matches API", async ({ page }) => {
    if (apiData.orders.length === 0) {
      test.skip();
      return;
    }

    await page.goto("/va/orders");
    await waitForDataLoad(page);

    // Verify first 3 orders have correct order numbers displayed
    const maxCheck = Math.min(3, apiData.orders.length);
    for (let i = 0; i < maxCheck; i++) {
      const row = page.locator("table tbody tr").nth(i);
      const rowText = await row.textContent();
      expect(rowText).toContain(apiData.orders[i].name);
    }
  });

  test("date filter: last 7 days returns data", async ({ page }) => {
    await page.goto("/va/orders");
    await waitForDataLoad(page);

    // Click "Last 7 Days" button
    await page.getByText("Last 7 Days").click();
    await waitForDataLoad(page);

    // Fetch API data for last 7 days
    const last7d = (await apiFetch(
      page,
      "/api/shopify/orders?date_filter=last_7d&store=ALL&status=all"
    )) as OrdersApiResponse;

    // Verify total orders card updated
    const totalOrdersCard = page.locator(".rounded-xl").filter({ hasText: "Total Orders" });
    const totalOrdersValue = await totalOrdersCard.locator(".text-lg.font-bold").textContent();
    expect(parseDisplayNumber(totalOrdersValue || "0")).toBe(last7d.summary.total_orders);
  });
});
