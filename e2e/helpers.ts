import { Page, expect } from "@playwright/test";

/**
 * Fetch JSON from an API route using the page's auth cookies.
 */
export async function apiFetch(page: Page, path: string): Promise<unknown> {
  const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
  const res = await page.request.get(`${baseURL}${path}`);
  expect(res.ok(), `API ${path} returned ${res.status()}`).toBeTruthy();
  return res.json();
}

/**
 * Parse a formatted number from the UI (e.g., "₱12,345.67" → 12345.67, "1,234" → 1234).
 */
export function parseDisplayNumber(text: string): number {
  const cleaned = text.replace(/[₱,\s%]/g, "").trim();
  if (cleaned === "" || cleaned === "—" || cleaned === "-") return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Get all text content from elements matching a selector.
 */
export async function getTexts(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).allTextContents();
}

/**
 * Wait for API data to load (spinner gone, data visible).
 */
export async function waitForDataLoad(page: Page, timeout = 30_000) {
  // Wait for common loading indicators to disappear
  await page.waitForFunction(
    () => {
      const spinners = document.querySelectorAll(
        '[class*="animate-spin"], [class*="animate-pulse"], [role="progressbar"]'
      );
      return spinners.length === 0;
    },
    { timeout }
  );
  // Extra buffer for rendering
  await page.waitForTimeout(1000);
}

/**
 * Compare two numbers with a tolerance (for floating point / rounding differences).
 */
export function approxEqual(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}
