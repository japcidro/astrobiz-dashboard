/**
 * Global setup — verifies that a valid auth session exists.
 *
 * To create the session (first time only):
 *   node e2e/capture-session.mjs
 *
 * This captures cookies from your browser and saves them for tests.
 */

import { test as setup, expect, chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const SESSION_PATH = path.resolve("./e2e/.auth/session.json");
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

setup("verify auth session", async () => {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(
      "\n\n  No session found! Run this first:\n\n" +
      "    node e2e/capture-session.mjs\n\n" +
      "  This opens a page in your browser to capture auth cookies.\n"
    );
  }

  // Verify the session is still valid
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: SESSION_PATH });
  const page = await ctx.newPage();

  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const url = page.url();
  if (url.includes("/login")) {
    await ctx.close();
    await browser.close();
    throw new Error(
      "\n\n  Session expired! Re-run:\n\n" +
      "    node e2e/capture-session.mjs\n\n"
    );
  }

  console.log("  ✓ Auth session is valid");
  await ctx.close();
  await browser.close();
});
