-- HALORINNA COGS: the product's real SKU.
--
-- The store is connected now, and its Glow Boosting Ampoule has one variant,
-- SKU GLWAMP, instead of the four bundle variants the seed assumed (GBA-1/2/3/5
-- never existed in Shopify). One row at ₱150 a box; bundles come through as
-- quantity. Idempotent.

delete from public.cogs_items
 where store_name = 'HALORINNA' and sku in ('GBA-1', 'GBA-2', 'GBA-3', 'GBA-5');

insert into public.cogs_items (store_name, sku, product_name, cogs_per_unit, vat_rate)
values ('HALORINNA', 'GLWAMP', 'Glow Boosting Ampoule (box of 20)', 150.00, 0)
on conflict (store_name, sku) do nothing;
