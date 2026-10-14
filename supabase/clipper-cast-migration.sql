-- Clipper: a picked image (UGC library or upload) is the CAST — the person
-- to put into every clip's real frame — not the still itself. The still is
-- always generated from the frame + cast + product photos.
--
-- Run with:  npm run db:run -- supabase/clipper-cast-migration.sql

alter table remake_projects
  add column if not exists cast_path text;   -- remake/<project>/cast/<uuid>.<ext> in the marketing-board bucket
