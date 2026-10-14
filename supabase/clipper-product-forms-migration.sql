-- Clipper: product forms. Each brand kit photo is labelled with what it
-- shows (bottle, gummies, capsules, box…) and each clip with what the
-- person holds, so the still swap puts in the matching product: a bottle
-- for a bottle, our gummies for their gummies.
--
-- Run with:  npm run db:run -- supabase/clipper-product-forms-migration.sql

alter table remake_brand_images
  add column if not exists kind text,            -- bottle | gummies | capsules | box | sachet | tube | jar | other
  add column if not exists description text;     -- one line from the vision pass, editable

alter table remake_shots
  add column if not exists holds text;           -- what the person holds in the frame, same vocabulary, or 'none'
