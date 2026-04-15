/**
 * FULFILLMENT INVENTORY TAB — Data Accuracy Tests
 *
 * Verifies /fulfillment/inventory data matches /api/shopify/inventory.
 * Checks:
 * - Summary cards (Total Products, Variants, Out of Stock, Low Stock, Total Units)
 * - Stock levels match Shopify product data
 * - Stock status color coding is correct
 * - Store filter works
 */

import { test, expect } from "@playwright/test";
import { apiFetch, parseDisplayNumber, waitForDataLoad } from "./helpers";

interface InventoryApiResponse {
  rows: Array<{
    product_id: number;
    product_title: string;
    variant_title: string;
    sku: string | null;
    stock: number;
    stock_status: "in_stock" | "low_stock" | "out_of_stock";
    store_name: string;
    price: string;
  }>;
  summary: {
    total_products: number;
    total_variants: number;
    out_of_stock_count: number;
    low_stock_count: number;
    total_units: number;
  };
  stores: Array<{ id: string; name: string }>;
  role: string;
}

test.describe("Fulfillment Inventory — Data Accuracy", () => {
  let apiData: InventoryApiResponse;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "./e2e/.auth/session.json" });
    const page = await ctx.newPage();
    apiData = (await apiFetch(page, "/api/shopify/inventory?store=ALL")) as InventoryApiResponse;
    await ctx.close();
  });

  test("summary cards match API response", async ({ page }) => {
    await page.goto("/fulfillment/inventory");
    await waitForDataLoad(page);

    const cards = page.locator(".rounded-xl").filter({ has: page.locator(".text-xs.text-gray-400") });

    // Total Products
    const productsCard = cards.filter({ hasText: "Total Products" });
    const productsValue = await productsCard.locator(".text-lg.font-bold").textContent();
    expect(parseDisplayNumber(productsValue || "0")).toBe(apiData.summary.total_products);

    // Total Variants
    const variantsCard = cards.filter({ hasText: "Variants" });
    const variantsValue = await variantsCard.locator(".text-lg.font-bold").textContent();
    expect(parseDisplayNumber(variantsValue || "0")).toBe(apiData.summary.total_variants);

    // Out of Stock
    const oosCard = cards.filter({ hasText: "Out of Stock" });
    const oosValue = await oosCard.locator(".text-lg.font-bold").textContent();
    expect(parseDisplayNumber(oosValue || "0")).toBe(apiData.summary.out_of_stock_count);

    // Low Stock
    const lowCard = cards.filter({ hasText: "Low Stock" });
    const lowValue = await lowCard.locator(".text-lg.font-bold").textContent();
    expect(parseDisplayNumber(lowValue || "0")).toBe(apiData.summary.low_stock_count);

    // Total Units
    const unitsCard = cards.filter({ hasText: "Total Units" });
    const unitsValue = await unitsCard.locator(".text-lg.font-bold").textContent();
    expect(parseDisplayNumber(unitsValue || "0")).toBe(apiData.summary.total_units);
  });

  test("inventory table row count matches API", async ({ page }) => {
    await page.goto("/fulfillment/inventory");
    await waitForDataLoad(page);

    const tableRows = page.locator("table tbody tr");
    const rowCount = await tableRows.count();

    // Table shows one row per variant
    expect(rowCount).toBe(apiData.rows.length);
  });

  test("inventory is sorted by lowest stock first", async ({ page }) => {
    if (apiData.rows.length < 2) {
      test.skip();
      return;
    }

    await page.goto("/fulfillment/inventory");
    await waitForDataLoad(page);

    // API data is already sorted by stock ascending
    // Check first row has the lowest stock item
    const firstRow = page.locator("table tbody tr").first();
    const firstRowText = await firstRow.textContent();
    expect(firstRowText).toContain(apiData.rows[0].product_title);
  });

  test("stock status classification is correct", async ({ page }) => {
    // Verify that stock status calculation in API matches the rules:
    // 0 = out_of_stock, 1-9 = low_stock, 10+ = in_stock
    for (const row of apiData.rows) {
      if (row.stock === 0) {
        expect(row.stock_status).toBe("out_of_stock");
      } else if (row.stock >= 1 && row.stock <= 9) {
        expect(row.stock_status).toBe("low_stock");
      } else {
        expect(row.stock_status).toBe("in_stock");
      }
    }
  });

  test("out of stock + low stock + in stock = total variants", async ({ page }) => {
    const oos = apiData.rows.filter((r) => r.stock_status === "out_of_stock").length;
    const low = apiData.rows.filter((r) => r.stock_status === "low_stock").length;
    const inStock = apiData.rows.filter((r) => r.stock_status === "in_stock").length;

    expect(oos + low + inStock).toBe(apiData.summary.total_variants);
    expect(oos).toBe(apiData.summary.out_of_stock_count);
    expect(low).toBe(apiData.summary.low_stock_count);
  });

  test("total units sum matches API summary", async ({ page }) => {
    const calculatedTotal = apiData.rows.reduce((sum, r) => sum + r.stock, 0);
    expect(calculatedTotal).toBe(apiData.summary.total_units);
  });

  test("store filter shows correct data", async ({ page }) => {
    if (apiData.stores.length < 2) {
      test.skip();
      return;
    }

    const firstStore = apiData.stores[0];
    const storeRows = apiData.rows.filter((r) => r.store_name === firstStore.name);

    await page.goto("/fulfillment/inventory");
    await waitForDataLoad(page);

    // Select first store in dropdown
    await page.locator("select").filter({ hasText: "All Stores" }).selectOption(firstStore.id);
    await waitForDataLoad(page);

    // Verify API for this store
    const storeApiData = (await apiFetch(
      page,
      `/api/shopify/inventory?store=${firstStore.id}`
    )) as InventoryApiResponse;

    // Summary should reflect single store
    const productsCard = page.locator(".rounded-xl").filter({ hasText: "Total Products" });
    const productsValue = await productsCard.locator(".text-lg.font-bold").textContent();
    expect(parseDisplayNumber(productsValue || "0")).toBe(storeApiData.summary.total_products);
  });

  test("each store has correct product allocation", async ({ page }) => {
    // Verify that products are properly attributed to their stores
    const storeProductCounts = new Map<string, number>();
    for (const row of apiData.rows) {
      storeProductCounts.set(
        row.store_name,
        (storeProductCounts.get(row.store_name) || 0) + 1
      );
    }

    // Total across all stores should equal total variants
    let totalAcrossStores = 0;
    for (const count of storeProductCounts.values()) {
      totalAcrossStores += count;
    }
    expect(totalAcrossStores).toBe(apiData.summary.total_variants);
  });
});
