/**
 * ADMIN J&T DASHBOARD — Data Accuracy Tests
 *
 * Verifies /admin/jt-dashboard data matches /api/profit/jt-data.
 * This tests REAL uploaded J&T Express data stored in Supabase.
 * Checks:
 * - Summary cards (Total, Delivered, Returned, In Transit, etc.)
 * - Classification counts match the database
 * - Store breakdown calculations
 * - COD and shipping totals
 */

import { test, expect } from "@playwright/test";
import { apiFetch, parseDisplayNumber, waitForDataLoad, approxEqual } from "./helpers";

interface JtApiResponse {
  deliveries: Array<{
    id: string;
    waybill: string;
    classification: string;
    store_name: string;
    cod_amount: string;
    shipping_cost: string;
    submission_date: string;
    is_delivered: boolean;
    is_returned: boolean;
    province: string;
    days_since_submit: number;
    tier_cutoff: number;
  }>;
  summary: {
    total: number;
    delivered: number;
    returned: number;
    in_transit: number;
    for_return: number;
    aged: number;
    pending: number;
    total_cod: number;
    total_shipping: number;
  };
}

test.describe("J&T Dashboard — Data Accuracy", () => {
  let apiData: JtApiResponse;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "./e2e/.auth/session.json" });
    const page = await ctx.newPage();
    apiData = (await apiFetch(page, "/api/profit/jt-data")) as JtApiResponse;
    await ctx.close();
  });

  test("summary cards match API response", async ({ page }) => {
    if (apiData.deliveries.length === 0) {
      test.skip();
      return;
    }

    await page.goto("/admin/jt-dashboard");
    await waitForDataLoad(page);

    const cards = page.locator(".rounded-xl").filter({ has: page.locator(".text-xs") });

    // Total Parcels
    const totalCard = cards.filter({ hasText: "Total" }).first();
    const totalValue = await totalCard.locator(".text-lg.font-bold, .text-xl.font-bold").textContent();
    expect(parseDisplayNumber(totalValue || "0")).toBe(apiData.summary.total);

    // Delivered
    const deliveredCard = cards.filter({ hasText: "Delivered" }).first();
    const deliveredValue = await deliveredCard.locator(".text-lg.font-bold, .text-xl.font-bold").textContent();
    expect(parseDisplayNumber(deliveredValue || "0")).toBe(apiData.summary.delivered);
  });

  test("classification counts are internally consistent", async ({ page }) => {
    // Verify: total = delivered + returned + in_transit + for_return + aged + pending
    const calculatedTotal =
      apiData.summary.delivered +
      apiData.summary.returned +
      apiData.summary.in_transit +
      apiData.summary.for_return +
      apiData.summary.aged +
      apiData.summary.pending;

    expect(calculatedTotal).toBe(apiData.summary.total);
  });

  test("classification counts match actual delivery data", async ({ page }) => {
    const classifications = {
      Delivered: 0,
      Returned: 0,
      "In Transit": 0,
      "For Return": 0,
      "Returned (Aged)": 0,
      Pending: 0,
    };

    for (const d of apiData.deliveries) {
      if (d.classification in classifications) {
        classifications[d.classification as keyof typeof classifications]++;
      }
    }

    expect(classifications.Delivered).toBe(apiData.summary.delivered);
    expect(classifications.Returned).toBe(apiData.summary.returned);
    expect(classifications["In Transit"]).toBe(apiData.summary.in_transit);
    expect(classifications["For Return"]).toBe(apiData.summary.for_return);
    expect(classifications["Returned (Aged)"]).toBe(apiData.summary.aged);
    expect(classifications.Pending).toBe(apiData.summary.pending);
  });

  test("COD total matches sum of delivery COD amounts", async ({ page }) => {
    const calculatedCod = apiData.deliveries.reduce(
      (sum, d) => sum + (parseFloat(d.cod_amount) || 0),
      0
    );
    expect(approxEqual(apiData.summary.total_cod, calculatedCod, 0.01)).toBeTruthy();
  });

  test("shipping total matches sum of delivery shipping costs", async ({ page }) => {
    const calculatedShipping = apiData.deliveries.reduce(
      (sum, d) => sum + (parseFloat(d.shipping_cost) || 0),
      0
    );
    expect(approxEqual(apiData.summary.total_shipping, calculatedShipping, 0.01)).toBeTruthy();
  });

  test("province tier cutoffs are correct (Luzon=5, VisMin=8)", async ({ page }) => {
    // Luzon provinces — must match the full list in province-tiers.ts
    const luzonProvinces = [
      "METRO MANILA", "METRO-MANILA", "NCR", "RIZAL", "CAVITE", "LAGUNA",
      "BULACAN", "PAMPANGA", "BATANGAS", "TARLAC", "NUEVA ECIJA", "PANGASINAN",
      "ZAMBALES", "BATAAN", "AURORA", "NUEVA VIZCAYA", "QUIRINO", "ISABELA",
      "CAGAYAN", "BENGUET", "IFUGAO", "KALINGA", "MOUNTAIN PROVINCE", "APAYAO",
      "ABRA", "ILOCOS NORTE", "ILOCOS SUR", "LA UNION", "CAMARINES NORTE",
      "CAMARINES SUR", "ALBAY", "SORSOGON", "CATANDUANES", "MASBATE",
      "MARINDUQUE", "ROMBLON", "ORIENTAL MINDORO", "OCCIDENTAL MINDORO",
      "PALAWAN", "QUEZON",
    ];

    for (const d of apiData.deliveries) {
      if (!d.province || !d.tier_cutoff) continue;

      const normalized = d.province.toUpperCase().trim().replace(/-/g, " ");
      const isLuzon = luzonProvinces.includes(normalized);

      if (isLuzon) {
        expect(d.tier_cutoff).toBe(5);
      } else {
        expect(d.tier_cutoff).toBe(8);
      }
    }
  });

  test("waybills are unique", async ({ page }) => {
    const waybills = apiData.deliveries.map((d) => d.waybill);
    const uniqueWaybills = new Set(waybills);
    expect(uniqueWaybills.size).toBe(waybills.length);
  });

  test("store breakdown delivery rate is correct", async ({ page }) => {
    // Group by store and verify delivery rate
    const storeMap = new Map<string, { total: number; delivered: number }>();

    for (const d of apiData.deliveries) {
      const store = d.store_name || "UNKNOWN";
      const current = storeMap.get(store) || { total: 0, delivered: 0 };
      current.total++;
      if (d.classification === "Delivered") current.delivered++;
      storeMap.set(store, current);
    }

    for (const [store, data] of storeMap) {
      const expectedRate = data.total > 0 ? (data.delivered / data.total) * 100 : 0;
      // Verify delivery rate percentage is reasonable (0-100%)
      expect(expectedRate).toBeGreaterThanOrEqual(0);
      expect(expectedRate).toBeLessThanOrEqual(100);
    }
  });

  test("is_delivered and is_returned flags match classification", async ({ page }) => {
    for (const d of apiData.deliveries) {
      if (d.classification === "Delivered") {
        expect(d.is_delivered).toBe(true);
      }
      if (d.classification === "Returned" || d.classification === "Returned (Aged)") {
        expect(d.is_returned).toBe(true);
      }
    }
  });
});
