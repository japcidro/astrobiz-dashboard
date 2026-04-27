// Resolves the URL the briefing system should use for in-process self-fetches
// (collect.ts hitting /api/profit/daily, /api/facebook/all-ads, /api/shopify/orders).
//
// Why this exists: with Vercel Deployment Protection enabled (Standard or
// stricter), only the production alias is public. The deployment-specific
// URL — which `request.url.host` resolves to inside a Vercel cron invocation
// — is protected by Vercel's edge auth. Self-fetching the deployment URL
// gets 401'd before it reaches our app's CRON_SECRET check, so every
// briefing collected from cron context started failing all four upstream
// reads (pnl/ads/orders/prev_pnl) with HTTP 401.
//
// The admin endpoints (rerun, backfill, diagnose) didn't hit this from the
// browser because the user navigates via the production alias, so
// `request.url.host` was already the public hostname. The fix here is to
// always prefer an explicitly-configured public URL.
//
// Resolution order:
//   1. NEXT_PUBLIC_APP_URL  — user-set, points at the production alias.
//   2. VERCEL_PROJECT_PRODUCTION_URL  — Vercel-provided in production
//      (e.g. "astrobiz-dashboard.vercel.app"); always public regardless of
//      protection settings.
//   3. request.url host  — last-resort fallback for local dev / unknown envs.
export function resolveBriefingBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd.replace(/\/$/, "")}`;

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
