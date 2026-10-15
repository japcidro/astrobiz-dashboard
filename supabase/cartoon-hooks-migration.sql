-- Cartoon Hooks (Marketing Tools): paste a script, Claude splits it into
-- 2-3 second beats, and the Mac worker makes the whole hook on its own:
-- a character image (so the same cartoon appears in every beat), one
-- starting image per beat (Seedream 5.0 Flash), one clip per beat
-- (Seedance 2.0 Mini), an optional voiceover line per beat (ElevenLabs via
-- Higgsfield), then joins the beats into one 9:16 MP4. No captions; those
-- are added in CapCut.
--
-- The app only plans (Claude) and resets steps for a redo; the worker is
-- the orchestrator: for every hook in status 'working' it queues whatever
-- step is ready (a null status means "not started"), so a redo is just
-- setting a status back to null.
--
-- A hook is one take of a script; "variants" are several hooks made from
-- the same script in one go (batch_id). Files live in the marketing-board
-- bucket under cartoon-hooks/<hook id>/.
--
-- Service-role only (RLS on, no policies), like the rest of the tools.
--
-- Run with:  npm run db:run -- supabase/cartoon-hooks-migration.sql

create table if not exists cartoon_hooks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  variant int not null default 1,
  title text not null default '',
  script text not null,
  style text not null default 'pixar3d' check (style in ('pixar3d', 'flat2d', 'medical', 'mixed')),
  direction text not null default '',          -- the marketer's notes: who the character is, what to show
  resolution text not null default '480p' check (resolution in ('480p', '720p')),
  voice_on boolean not null default false,
  voice_id text,
  voice_type text,
  voice_name text,
  status text not null default 'planning' check (status in ('planning', 'working', 'done', 'failed')),
  error text,
  -- Character lock: null status = no beat needs the main character.
  character_desc text not null default '',
  character_prompt text,
  character_status text check (character_status in ('queued', 'running', 'done', 'failed')),
  character_path text,
  character_preview_path text,
  character_error text,
  character_credits numeric,
  -- The joined hook.
  final_status text check (final_status in ('queued', 'running', 'done', 'failed')),
  final_path text,
  final_seconds numeric,
  final_error text,
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cartoon_hooks_created_idx on cartoon_hooks (created_at desc);
create index if not exists cartoon_hooks_batch_idx on cartoon_hooks (batch_id);

create table if not exists cartoon_beats (
  id uuid primary key default gen_random_uuid(),
  hook_id uuid not null references cartoon_hooks (id) on delete cascade,
  idx int not null,
  line text not null default '',               -- the voiceover words this beat covers
  seconds numeric not null default 2.5,        -- planned length; the voiceover's length wins when there is one
  style text not null default 'pixar3d' check (style in ('pixar3d', 'flat2d', 'medical')),
  uses_character boolean not null default true,
  scene text not null default '',              -- what the starting image shows (Claude's words, editable)
  motion text not null default '',             -- what moves in the clip (editable)
  still_prompt text not null default '',       -- the full prompts the worker sends, built by the app from style + scene / motion
  motion_prompt text not null default '',
  still_status text check (still_status in ('queued', 'running', 'done', 'failed')),
  still_path text,
  still_preview_path text,
  still_error text,
  still_credits numeric,
  clip_status text check (clip_status in ('queued', 'running', 'done', 'failed')),
  clip_path text,
  clip_error text,
  clip_credits numeric,
  voice_status text check (voice_status in ('queued', 'running', 'done', 'failed')),
  voice_path text,
  voice_seconds numeric,
  voice_error text,
  voice_credits numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hook_id, idx)
);

alter table cartoon_hooks enable row level security;
alter table cartoon_beats enable row level security;

drop trigger if exists cartoon_hooks_touch on cartoon_hooks;
create trigger cartoon_hooks_touch before update on cartoon_hooks
  for each row execute function hook_studio_touch();
drop trigger if exists cartoon_beats_touch on cartoon_beats;
create trigger cartoon_beats_touch before update on cartoon_beats
  for each row execute function hook_studio_touch();

-- Worker job kinds.
alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch',
                  'remake_split', 'remake_frames', 'remake_still', 'remake_tts', 'remake_clip', 'remake_mix',
                  'talking_head',
                  'cartoon_character', 'cartoon_still', 'cartoon_clip', 'cartoon_voice', 'cartoon_join'));
