-- Brand Kit: a brand can sell more than one product.
--
-- YUMO now sells two bags (The Lettered Tote and The YUMO Tote) that look
-- alike but carry different lettering, and the Static Ad Generator attached
-- "the brand's main photo" as if a brand had one product. Each photo can now
-- be filed under a product name; when a brand's photos carry more than one,
-- the generator asks which product the ad sells and uses only that product's
-- photos (plus any filed under none). Null = the brand's one product, which
-- is every existing photo. Idempotent.

alter table public.remake_brand_images
  add column if not exists product text;
