/**
 * A landing URL as Meta should get it. Typed as "www.brand.shop" it reaches
 * Meta without a scheme, Meta sends shoppers to http://, and every click pays
 * an extra redirect before the page starts loading. Adds https:// when no
 * scheme is given and upgrades http:// to https://; anything else, and blank,
 * is returned as typed.
 */
export function normalizeLandingUrl(input: string | null | undefined): string {
  const value = (input ?? "").trim();
  if (!value) return value;
  if (/^http:\/\//i.test(value)) return `https://${value.slice(7)}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}
