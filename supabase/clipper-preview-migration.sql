-- Clipper: a small JPEG preview of each still, for the brand check (Claude
-- takes images up to 5 MB; a 2k PNG from Nano Banana Pro is bigger) and
-- for thumbnails. The full still is what the clip engines start from.
--
-- Run with:  npm run db:run -- supabase/clipper-preview-migration.sql

alter table remake_shots
  add column if not exists still_preview_path text;
