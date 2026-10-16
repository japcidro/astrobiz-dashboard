-- Clipper: the frame strip's tiles now spread evenly over the whole
-- reference instead of one per second for the first 60 s, so Re-detect sees
-- past 1:00. Tile i covers [i·span/n, (i+1)·span/n] seconds, n = strip_count.
-- New strips are numbered and laid out in rows of strip_cols tiles (up to 10)
-- so Claude can read them. Both are null on older strips: one row, one tile
-- per second (span = strip_count).
--
-- Run with:  npm run db:run -- supabase/clipper-strip-span-migration.sql

alter table remake_projects
  add column if not exists strip_span numeric,       -- seconds the strip's tiles spread over
  add column if not exists strip_cols int;           -- tiles per row
