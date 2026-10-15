-- Clipper: the voice Veo should use for a talking head, read off the still
-- by the brand-check pass (male / female), editable per clip.
--
-- Run with:  npm run db:run -- supabase/remake-voice-gender-migration.sql

alter table remake_shots
  add column if not exists voice_gender text
    check (voice_gender in ('male', 'female'));
