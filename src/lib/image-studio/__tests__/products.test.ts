import { describe, expect, it } from "vitest";
import { photosForProduct, pickStaticAdPhotosByProduct, productsOf } from "../types";

const img = (id: string, product: string | null, ad_use: string | null = null, kind = "bag") => ({ id, product, ad_use, kind, description: "front of a bag" });

describe("brand photos filed under products", () => {
  const photos = [img("a", "The Lettered Tote", "main"), img("b", "The YUMO Tote", "main"), img("c", "the lettered tote"), img("d", null), img("e", "The YUMO Tote")];

  it("lists each product once, in upload order", () => {
    expect(productsOf(photos)).toEqual(["The Lettered Tote", "The YUMO Tote"]);
    expect(productsOf([img("x", null), img("y", "  ")])).toEqual([]);
  });

  it("keeps one product's photos plus the unfiled ones", () => {
    expect(photosForProduct(photos, "The YUMO Tote").map((p) => p.id)).toEqual(["b", "d", "e"]);
    expect(photosForProduct(photos, null)).toHaveLength(5);
  });

  it("marks a main photo for every product", () => {
    expect(pickStaticAdPhotosByProduct(photos).packs.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("is the plain pick for a one-product brand", () => {
    expect(pickStaticAdPhotosByProduct([img("x", null, "main"), img("y", null)]).packs.map((p) => p.id)).toEqual(["x"]);
  });
});
