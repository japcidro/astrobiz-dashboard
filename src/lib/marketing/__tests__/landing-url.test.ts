import { describe, expect, it } from "vitest";
import { normalizeLandingUrl } from "../landing-url";

describe("normalizeLandingUrl", () => {
  it("adds https:// to a bare domain or path", () => {
    expect(normalizeLandingUrl("www.tryhalorinna.shop")).toBe("https://www.tryhalorinna.shop");
    expect(normalizeLandingUrl("  tryfoliq.shop/products/x?a=1 ")).toBe("https://tryfoliq.shop/products/x?a=1");
  });

  it("upgrades http:// and leaves https:// alone", () => {
    expect(normalizeLandingUrl("http://www.wearyumo.shop/")).toBe("https://www.wearyumo.shop/");
    expect(normalizeLandingUrl("https://trynurtelle.shop/")).toBe("https://trynurtelle.shop/");
  });

  it("returns blank and empty values as they are", () => {
    expect(normalizeLandingUrl("")).toBe("");
    expect(normalizeLandingUrl(null)).toBe("");
    expect(normalizeLandingUrl(undefined)).toBe("");
  });
});
