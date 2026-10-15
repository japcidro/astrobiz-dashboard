-- Cartoon Hooks: voiceover from the team's own ElevenLabs account (the
-- FOLIQ voices), not only Higgsfield's ElevenLabs. ElevenLabs lines are made
-- by the app on Vercel (ELEVENLABS_API_KEY lives there, not on the Mac), so
-- the worker skips voice steps of those hooks and only waits for them.
--
-- Run with:  npm run db:run -- supabase/cartoon-hooks-elevenlabs-migration.sql

alter table cartoon_hooks
  add column if not exists voice_provider text not null default 'higgsfield'
  check (voice_provider in ('higgsfield', 'elevenlabs'));
