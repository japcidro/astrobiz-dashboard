#!/usr/bin/env node
/**
 * Captures auth session by connecting to your real Chrome via CDP.
 *
 * Usage:
 *   1. Make sure Chrome is open with the dashboard logged in
 *   2. Close Chrome, then reopen with:
 *      open -a "Google Chrome" --args --remote-debugging-port=9222
 *   3. Log into the dashboard in that Chrome
 *   4. Run: node e2e/capture-session.mjs
 */

import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.resolve(__dirname, ".auth/session.json");
const APP_URL = "http://localhost:3000";

async function captureViaBookmarklet() {
  // Create a simple local HTML page that reads cookies from localhost:3000
  // by being served from the same origin
  console.log("\n  Creating session capture endpoint on your app...\n");

  // We'll inject a temporary API route by making a direct fetch to the app
  // and reading the Set-Cookie headers... but that won't work either.

  // Simplest approach: create a temp HTML file served by Next.js
  const publicDir = path.resolve(__dirname, "../public");
  const captureFile = path.join(publicDir, "_capture.html");

  const html = `<!DOCTYPE html>
<html><head><title>Capture</title></head>
<body style="background:#111;color:#fff;font-family:system-ui;padding:40px">
<h2>Capturing session...</h2>
<pre id="out">Working...</pre>
<script>
(async()=>{
  const out = document.getElementById('out');
  try {
    const cookies = document.cookie;
    if(!cookies) { out.textContent = 'No cookies found! Make sure you are logged in.'; return; }

    const parsed = cookies.split(';').map(c => {
      const [n,...v] = c.trim().split('=');
      return { name:n.trim(), value:v.join('='), domain:'localhost', path:'/', expires:-1, httpOnly:false, secure:false, sameSite:'Lax' };
    }).filter(c => c.name && c.value);

    const state = { cookies: parsed, origins: [{ origin: '${APP_URL}', localStorage: [] }] };

    // Save via API
    const res = await fetch('/_capture-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });

    if(res.ok) {
      out.textContent = '✓ Session saved! (' + parsed.length + ' cookies)\\nYou can close this tab.';
      out.style.color = '#4ade80';
    } else {
      // Fallback: show cookies for manual copy
      out.textContent = JSON.stringify(state, null, 2);
      out.style.fontSize = '10px';
    }
  } catch(e) {
    out.textContent = 'Error: ' + e.message;
    out.style.color = '#f87171';
  }
})();
</script>
</body></html>`;

  fs.writeFileSync(captureFile, html);

  // Also create a tiny API handler... but we can't easily inject into Next.js
  // So let's just have the HTML output the cookies and we'll read them

  const html2 = `<!DOCTYPE html>
<html><head><title>Capture</title></head>
<body style="background:#111;color:#fff;font-family:system-ui;padding:40px">
<h2 id="title">Capturing session...</h2>
<textarea id="out" rows="10" style="width:100%;background:#1e293b;color:#4ade80;border:none;padding:12px;font-family:monospace;font-size:11px">Working...</textarea>
<script>
const cookies = document.cookie;
const parsed = cookies.split(';').map(c => {
  const [n,...v] = c.trim().split('=');
  return { name:n.trim(), value:v.join('='), domain:'localhost', path:'/', expires:-1, httpOnly:false, secure:false, sameSite:'Lax' };
}).filter(c => c.name && c.value);
const state = JSON.stringify({ cookies: parsed, origins: [{ origin: '${APP_URL}', localStorage: [] }] });
document.getElementById('out').value = state;
document.getElementById('title').textContent = '✓ Copy ALL text below, then paste in terminal';
document.getElementById('out').select();
</script>
</body></html>`;

  fs.writeFileSync(captureFile, html2);

  console.log("  ✓ Capture page created!");
  console.log("\n  Open this in your browser:\n");
  console.log("    http://localhost:3000/_capture.html\n");
  console.log("  Then copy ALL the text and paste it when prompted below.\n");

  // Open it
  execSync(`open "http://localhost:3000/_capture.html"`);

  // Wait for user input
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question("  Paste the JSON here and press Enter:\n  > ", (answer) => {
      rl.close();
      try {
        const state = JSON.parse(answer.trim());
        const dir = path.dirname(SESSION_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SESSION_PATH, JSON.stringify(state, null, 2));
        console.log(`\n  ✓ Session saved! (${state.cookies.length} cookies)`);
        console.log("  You can now run: npm run test:e2e\n");
      } catch (e) {
        console.error("\n  ✗ Invalid JSON. Try again.\n", e.message);
      }

      // Cleanup
      try { fs.unlinkSync(captureFile); } catch {}
      resolve();
    });
  });
}

captureViaBookmarklet();
