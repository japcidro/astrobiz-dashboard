-- Clipper (was Remake Studio) — the reference is cut into real clips you can
-- keep as they are; any clip can instead be redone from OUR still (new
-- person, our product) and animated by Veo (speaking the script), Genjutsu
-- or Kling. B-roll voiceovers come from ElevenLabs v4 and are mixed onto the
-- clip. Tables keep their remake_* names.
--
-- Run with:  npm run db:run -- supabase/clipper-migration.sql

alter table remake_projects
  add column if not exists strip_path text,          -- one frame per second, tiled into one JPEG
  add column if not exists strip_count int;          -- tiles in the strip

alter table remake_shots
  add column if not exists mode text not null default 'swap' check (mode in ('keep', 'swap')),
  add column if not exists person text,              -- "A", "B"… from the labelling pass
  add column if not exists ref_path text,            -- the real clip, cut from the reference
  add column if not exists clip_seconds int,         -- Veo length: 4, 6 or 8
  add column if not exists voice_direction text not null default '',
  add column if not exists mixed_path text,          -- clip with the voiceover mixed in
  add column if not exists mixed_key text,           -- "<clip_path>|<audio_path>" the mix was made from
  add column if not exists mixed_status text not null default 'none'
    check (mixed_status in ('none', 'queued', 'running', 'done', 'failed'));

-- The lipsync engines are gone; Veo 3.1 is the default.
alter table remake_shots alter column clip_engine set default 'veo3_1';
update remake_shots set clip_engine = 'veo3_1' where clip_engine in ('wan_lipsync', 'seedance_lipsync');

alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch',
                  'remake_split', 'remake_frames', 'remake_still', 'remake_tts', 'remake_clip', 'remake_mix'));
