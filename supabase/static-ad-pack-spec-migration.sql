-- Static Ad Generator: an exact description of each product packshot
-- (container, every colour, every label line), read once by Claude from the
-- brand image and reused by the planner, the image prompt and the review,
-- so the generated bottle keeps its real colours and label.
--
-- Run with:  npm run db:run -- supabase/static-ad-pack-spec-migration.sql

alter table remake_brand_images add column if not exists pack_spec text;
