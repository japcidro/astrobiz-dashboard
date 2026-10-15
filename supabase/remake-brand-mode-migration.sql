-- Clipper: per clip, the still either puts OUR product into the frame
-- ('product', the default) or copies the reference scene as it is and only
-- swaps the person ('copy': no brand kit photos attached).
--
-- Run with:  npm run db:run -- supabase/remake-brand-mode-migration.sql

alter table remake_shots
  add column if not exists brand_mode text not null default 'product'
    check (brand_mode in ('product', 'copy'));
