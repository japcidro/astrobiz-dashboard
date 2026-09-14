// Normalizes whatever an admin pastes into the Store URL field down to the
// `<handle>.myshopify.com` host every Shopify API call is built from.
//
// The field is filled by copying from a browser, so it arrives in every shape
// the Shopify admin hands out: the new admin URL
// ("admin.shopify.com/store/edug3u-pk"), the legacy admin URL with a path
// ("edug3u-pk.myshopify.com/admin/products"), a scheme, a trailing slash, or
// the bare handle. Each of those silently produced a broken API host before.
export function normalizeStoreUrl(input: string): string {
  let value = input.trim().toLowerCase();
  if (!value) return "";

  value = value.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  // New admin: admin.shopify.com/store/<handle>[/...]
  const newAdmin = value.match(/^admin\.shopify\.com\/store\/([a-z0-9-]+)/);
  if (newAdmin) return `${newAdmin[1]}.myshopify.com`;

  // Legacy admin or storefront host, with or without a path.
  const host = value.split("/")[0];
  if (host.endsWith(".myshopify.com")) return host;

  // Bare handle.
  if (/^[a-z0-9-]+$/.test(host)) return `${host}.myshopify.com`;

  // A custom domain (shop.example.com) — the Admin API is not served there,
  // so hand it back untouched and let verification report the failure.
  return host;
}
