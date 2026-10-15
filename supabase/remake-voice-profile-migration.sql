-- Clipper: one voice description per project, put into every Veo talking
-- head prompt so the clips sound like the same person (accent, age, tone).
--
-- Run with:  npm run db:run -- supabase/remake-voice-profile-migration.sql

alter table remake_projects
  add column if not exists voice_profile text not null default '';
