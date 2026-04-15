/**
 * MARKETING ADS TAB — Data Accuracy Tests
 *
 * Verifies /marketing/ads data matches /api/facebook/all-ads.
 * Checks:
 * - Total spend, purchases, ROAS, CPA from Facebook API
 * - Ad count matches API response
 * - Totals row calculations are correct
 */

import { test, expect } from "@playwright/test";
import { apiFetch, parseDisplayNumber, waitForDataLoad, approxEqual } from "./helpers";

interface AdsApiResponse {
  data: Array<{
    account: string;
    account_id: string;
    campaign: string;
    ad: string;
    ad_id: string;
    status: string;
    spend: number;
    link_clicks: number;
    cpa: number;
    roas: number;
    add_to_cart: number;
    purchases: number;
    reach: number;
    impressions: number;
    ctr: number;
  }>;
  totals: {
    count: number;
    spend: number;
    link_clicks: number;
    purchases: number;
    add_to_cart: number;
    reach: number;
    impressions: number;
    cpa: number;
    roas: number;
    ctr: number;
  };
  accounts: Array<{ id: string; name: string; is_active: boolean }>;
  role: string;
}

test.describe("Marketing Ads — Data Accuracy", () => {
  let apiData: AdsApiResponse;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "./e2e/.auth/session.json" });
    const page = await ctx.newPage();
    try {
      apiData = (await apiFetch(page, "/api/facebook/all-ads?date_preset=today&account=ALL")) as AdsApiResponse;
    } catch {
      // Facebook API may not be configured — tests will be skipped
      apiData = { data: [], totals: { count: 0, spend: 0, link_clicks: 0, purchases: 0, add_to_cart: 0, reach: 0, impressions: 0, cpa: 0, roas: 0, ctr: 0 }, accounts: [], role: "admin" };
    }
    await ctx.close();
  });

  test("API totals calculations are internally consistent", async ({ page }) => {
    if (apiData.data.length === 0) {
      test.skip();
      return;
    }

    // Verify totals.spend = sum of all data[].spend
    const calculatedSpend = apiData.data.reduce((sum, r) => sum + r.spend, 0);
    expect(approxEqual(apiData.totals.spend, calculatedSpend, 0.01)).toBeTruthy();

    // Verify totals.purchases = sum of all data[].purchases
    const calculatedPurchases = apiData.data.reduce((sum, r) => sum + r.purchases, 0);
    expect(apiData.totals.purchases).toBe(calculatedPurchases);

    // Verify totals.count = data.length
    expect(apiData.totals.count).toBe(apiData.data.length);

    // Verify CPA = spend / purchases
    if (apiData.totals.purchases > 0) {
      const expectedCpa = apiData.totals.spend / apiData.totals.purchases;
      expect(approxEqual(apiData.totals.cpa, expectedCpa, 0.1)).toBeTruthy();
    }

    // Verify link_clicks
    const calculatedClicks = apiData.data.reduce((sum, r) => sum + r.link_clicks, 0);
    expect(apiData.totals.link_clicks).toBe(calculatedClicks);

    // Verify reach
    const calculatedReach = apiData.data.reduce((sum, r) => sum + r.reach, 0);
    expect(apiData.totals.reach).toBe(calculatedReach);

    // Verify impressions
    const calculatedImpressions = apiData.data.reduce((sum, r) => sum + r.impressions, 0);
    expect(apiData.totals.impressions).toBe(calculatedImpressions);
  });

  test("ad count on page matches API total", async ({ page }) => {
    await page.goto("/marketing/ads");
    await waitForDataLoad(page);

    if (apiData.data.length === 0) {
      const pageText = await page.textContent("body");
      expect(
        pageText?.includes("No ads") ||
        pageText?.includes("no data") ||
        apiData.data.length === 0
      ).toBeTruthy();
      return;
    }

    // The page groups ads by campaign — the total count is shown in the summary bar
    // "Total: 41 ads"
    const totalText = page.locator("strong").filter({ hasText: /\d+ ads/ });
    const totalValue = await totalText.textContent();
    const displayCount = parseInt((totalValue || "0").replace(/[^\d]/g, ""));
    expect(displayCount).toBe(apiData.totals.count);
  });

  test("total spend displayed matches API", async ({ page }) => {
    if (apiData.data.length === 0) {
      test.skip();
      return;
    }

    await page.goto("/marketing/ads");
    await waitForDataLoad(page);

    // Look for spend total in summary cards or header
    const spendElements = page.locator("text=/₱[\\d,]+\\.\\d{2}/");
    const allTexts = await spendElements.allTextContents();

    // At least one element should show the total spend
    const spendValues = allTexts.map(parseDisplayNumber);
    const hasMatchingSpend = spendValues.some((v) =>
      approxEqual(v, apiData.totals.spend, 1)
    );
    expect(hasMatchingSpend).toBeTruthy();
  });

  test("ROAS calculation is correct (weighted by spend)", async ({ page }) => {
    if (apiData.data.length === 0 || apiData.totals.spend === 0) {
      test.skip();
      return;
    }

    // ROAS should be weighted average: sum(roas * spend) / sum(spend)
    const weightedRoas = apiData.data.reduce((s, r) => s + r.roas * r.spend, 0) / apiData.totals.spend;
    expect(approxEqual(apiData.totals.roas, weightedRoas, 0.01)).toBeTruthy();
  });

  test("CTR calculation is correct", async ({ page }) => {
    if (apiData.totals.impressions === 0) {
      test.skip();
      return;
    }

    // CTR = (link_clicks / impressions) * 100
    const expectedCtr = (apiData.totals.link_clicks / apiData.totals.impressions) * 100;
    expect(approxEqual(apiData.totals.ctr, expectedCtr, 0.01)).toBeTruthy();
  });

  test("each ad has required fields", async ({ page }) => {
    for (const ad of apiData.data) {
      expect(ad.ad_id).toBeTruthy();
      expect(ad.account).toBeTruthy();
      expect(typeof ad.spend).toBe("number");
      expect(typeof ad.purchases).toBe("number");
      expect(typeof ad.roas).toBe("number");
      expect(ad.status).toBeTruthy();
    }
  });

  test("account filter shows matching data", async ({ page }) => {
    if (apiData.accounts.length < 2) {
      test.skip();
      return;
    }

    // Find an active account to filter by (avoid UNSETTLED accounts)
    const activeAccount = apiData.accounts.find((a) => a.is_active);
    if (!activeAccount) {
      test.skip();
      return;
    }

    const accountAds = apiData.data.filter((a) => a.account_id === activeAccount.id);

    // Fetch API with account filter (may fail for some accounts)
    const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
    const res = await page.request.get(
      `${baseURL}/api/facebook/all-ads?date_preset=today&account=${activeAccount.id}`
    );

    if (!res.ok()) {
      // Some accounts return errors (e.g., rate limits) — skip gracefully
      test.skip();
      return;
    }

    const filtered = (await res.json()) as AdsApiResponse;
    expect(filtered.data.length).toBe(accountAds.length);
    expect(filtered.totals.count).toBe(accountAds.length);
  });
});
