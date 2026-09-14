import { describe, it, expect } from "vitest";
import { normalizeStoreUrl } from "../store-url";

describe("normalizeStoreUrl", () => {
  it("keeps a plain myshopify host", () => {
    expect(normalizeStoreUrl("edug3u-pk.myshopify.com")).toBe("edug3u-pk.myshopify.com");
  });

  it("strips the scheme and trailing slash", () => {
    expect(normalizeStoreUrl("https://edug3u-pk.myshopify.com/")).toBe("edug3u-pk.myshopify.com");
  });

  it("strips a legacy admin path", () => {
    expect(normalizeStoreUrl("https://edug3u-pk.myshopify.com/admin/products")).toBe(
      "edug3u-pk.myshopify.com"
    );
  });

  it("recovers the handle from a new-admin URL", () => {
    expect(normalizeStoreUrl("https://admin.shopify.com/store/edug3u-pk")).toBe(
      "edug3u-pk.myshopify.com"
    );
  });

  it("recovers the handle from a new-admin URL with a path", () => {
    expect(normalizeStoreUrl("admin.shopify.com/store/edug3u-pk/orders/123")).toBe(
      "edug3u-pk.myshopify.com"
    );
  });

  it("expands a bare handle", () => {
    expect(normalizeStoreUrl("edug3u-pk")).toBe("edug3u-pk.myshopify.com");
  });

  it("lowercases and trims", () => {
    expect(normalizeStoreUrl("  EduG3U-PK.MyShopify.com  ")).toBe("edug3u-pk.myshopify.com");
  });

  it("leaves a custom domain alone rather than mangling it", () => {
    expect(normalizeStoreUrl("https://shop.example.com/admin")).toBe("shop.example.com");
  });

  it("returns empty for empty input", () => {
    expect(normalizeStoreUrl("   ")).toBe("");
  });
});
