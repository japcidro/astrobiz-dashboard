-- Clipper: how many times the current still was generated, so the brand
-- check can regenerate once by itself when the picked person did not make
-- it into the frame, without looping forever.
--
-- Run with:  npm run db:run -- supabase/remake-still-attempts-migration.sql

alter table remake_shots
  add column if not exists still_attempts int not null default 0;
