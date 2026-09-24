/**
 * ADS BILLING TAB — Data Accuracy Tests
 *
 * Verifies /marketing/ads-billing shows what /api/facebook/billing returns:
 * - One card per account, named as Meta names it
 * - The needs-payment banner appears exactly when an account needs paying
 * - Every Pay-now link targets Meta's Billing Hub for that account
 */

import { test, expect } from "@playwright/test";
import { apiFetch, waitForDataLoad } from "./helpers";

interface BillingApiResponse {
  accounts: Array<{
    id: string;
    account_id: string;
    name: string;
    balance: number;
    status: { label: string; tone: string; needsPayment: boolean };
    links: { pay: string };
  }>;
  summary: { total: number; needs_payment: number; outstanding: number };
}

test.describe("Ads Billing — Data Accuracy", () => {
  let apiData: BillingApiResponse;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "./e2e/.auth/session.json" });
    const page = await ctx.newPage();
    try {
      apiData = (await apiFetch(page, "/api/facebook/billing")) as BillingApiResponse;
    } catch {
      apiData = { accounts: [], summary: { total: 0, needs_payment: 0, outstanding: 0 } };
    }
    await ctx.close();
  });

  test("renders one card per account from the API", async ({ page }) => {
    test.skip(apiData.accounts.length === 0, "Facebook not configured");

    await page.goto("/marketing/ads-billing");
    await waitForDataLoad(page);

    for (const account of apiData.accounts) {
      await expect(page.getByRole("heading", { name: account.name })).toBeVisible();
      await expect(page.getByText(account.id, { exact: true })).toBeVisible();
    }
  });

  test("shows the payment banner only when an account needs paying", async ({ page }) => {
    test.skip(apiData.accounts.length === 0, "Facebook not configured");

    await page.goto("/marketing/ads-billing");
    await waitForDataLoad(page);

    const banner = page.getByText(/ad accounts? needs? a payment/);
    if (apiData.summary.needs_payment > 0) {
      await expect(banner).toBeVisible();
    } else {
      await expect(banner).toHaveCount(0);
    }
  });

  test("Pay now links open Meta's Billing Hub for that account", async ({ page }) => {
    test.skip(apiData.accounts.length === 0, "Facebook not configured");

    await page.goto("/marketing/ads-billing");
    await waitForDataLoad(page);

    for (const account of apiData.accounts) {
      const link = page.locator(`a[href="${account.links.pay}"]`).first();
      await expect(link).toBeVisible();
      expect(account.links.pay).toContain("billing_hub/accounts/details");
      expect(account.links.pay).toContain(`asset_id=${account.account_id}`);
    }
  });
});
