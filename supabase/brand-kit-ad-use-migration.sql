-- Brand Kit: how each product photo is used in static ads. 'main' = the pack
-- to reproduce (its front, the side shoppers recognise); 'skip' = never
-- attached (the back of the box, a label close-up); null = decided
-- automatically (front-of-pack photos first, backs last).
--
-- Run with:  npm run db:run -- supabase/brand-kit-ad-use-migration.sql

alter table remake_brand_images
  add column if not exists ad_use text check (ad_use in ('main', 'skip'));
