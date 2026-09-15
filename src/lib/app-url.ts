// Resolves the public origin this deployment is reachable at — the one we can
// hand to an outside service (Shopify OAuth) or self-fetch through.
//
// Never derive it from the `origin` request header: browsers omit `Origin` on
// top-level GET navigations, so a route entered via `window.location.href`
// sees it as null.
//
// Resolution order:
//   1. NEXT_PUBLIC_APP_URL  — user-set, points at the production alias.
//   2. VERCEL_PROJECT_PRODUCTION_URL  — Vercel-provided in production
//      (e.g. "astrobiz.live"); always public regardless of
//      Deployment Protection settings.
//   3. request.url host  — last-resort fallback for local dev / unknown envs.
export function resolvePublicAppUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd.replace(/\/$/, "")}`;

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
