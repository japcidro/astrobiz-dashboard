-- Hook Generator (Marketing Tools): reference images (expert, client,
-- setting, product) plus the marketer's direction. Claude plans one beat per
-- head-tap move asked for (pat the crown, part the hair, …) and splits the
-- spoken line across them; the Mac worker draws one starting image per beat
-- (Seedream 5.0 Flash or Nano Banana Pro, from the references). The marketer
-- approves each image or types a fix and redoes it. Once every beat is
-- approved the worker takes over: animates each beat (Veo 3.1 Fast speaking
-- its part of the line, or silent Seedance 2.0 Mini), has Claude check that a
-- hand really touches the head (one automatic re-roll when it doesn't), and
-- joins the beats into one 9:16 hook. No captions; those are added in CapCut.
--
-- Like Cartoon Hooks, the app plans and resets steps and the worker is the
-- orchestrator (worker/hook-worker.mjs, hookgenAdvance): a null step status
-- means "not started". Starting images are made while a hook is 'stills' or
-- 'working'; clips, checks and the join only while it is 'working', which the
-- app sets when every beat is approved.
--
-- A hook is one take; variants are several hooks from the same inputs
-- (batch_id). Files live in the marketing-board bucket under
-- hook-generator/<hook id>/ (uploaded references under hook-generator/refs/).
--
-- Service-role only (RLS on, no policies), like the rest of the tools.
--
-- Run with:  npm run db:run -- supabase/hook-generator-migration.sql

create table if not exists hookgen_hooks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  variant int not null default 1,
  title text not null default '',
  direction text not null default '',          -- the marketer's words: who, where, what happens
  line text not null default '',               -- the spoken line as typed; '' = Claude writes one
  beat_kinds text[] not null default '{}',     -- head-tap moves asked for, in order (one beat each)
  refs jsonb not null default '[]',            -- [{ bucket, path, role, name }], sent to the image model in this order
  image_model text not null default 'seedream_5_0_flash' check (image_model in ('seedream_5_0_flash', 'nano_banana_pro')),
  video_model text not null default 'veo3_1' check (video_model in ('veo3_1', 'seedance_2_0_mini')),
  voice text not null default '',              -- who the voice is (Claude's words), for Veo
  status text not null default 'planning' check (status in ('planning', 'stills', 'working', 'done', 'failed')),
  error text,
  final_status text check (final_status in ('queued', 'running', 'done', 'failed')),
  final_path text,
  final_seconds numeric,
  final_error text,
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hookgen_hooks_created_idx on hookgen_hooks (created_at desc);
create index if not exists hookgen_hooks_batch_idx on hookgen_hooks (batch_id);

create table if not exists hookgen_beats (
  id uuid primary key default gen_random_uuid(),
  hook_id uuid not null references hookgen_hooks (id) on delete cascade,
  idx int not null,
  kind text not null,                          -- the head-tap move (src/lib/hook-generator/engines.ts)
  line text not null default '',               -- the words spoken in this beat
  seconds numeric not null default 2,          -- planned length; a speaking clip is cut where the line ends
  clip_seconds int not null default 4,         -- what the video model is asked for
  scene text not null default '',              -- the starting image (Claude's words)
  motion text not null default '',             -- what happens in the clip (Claude's words)
  fix text not null default '',                -- the marketer's latest "fix in words" for the image
  still_prompt text not null default '',       -- the full prompts the worker sends, built by the app
  motion_prompt text not null default '',
  approved boolean not null default false,
  still_status text check (still_status in ('queued', 'running', 'done', 'failed')),
  still_path text,
  still_preview_path text,
  still_error text,
  still_credits numeric,
  clip_status text check (clip_status in ('queued', 'running', 'done', 'failed')),
  clip_path text,
  clip_error text,
  clip_credits numeric,
  check_status text check (check_status in ('queued', 'running', 'done', 'failed')),
  check_ok boolean,                            -- Claude saw a hand touch the head
  check_notes text,
  check_error text,
  rerolls int not null default 0,              -- automatic clip re-rolls after a failed check
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hook_id, idx)
);

alter table hookgen_hooks enable row level security;
alter table hookgen_beats enable row level security;

drop trigger if exists hookgen_hooks_touch on hookgen_hooks;
create trigger hookgen_hooks_touch before update on hookgen_hooks
  for each row execute function hook_studio_touch();
drop trigger if exists hookgen_beats_touch on hookgen_beats;
create trigger hookgen_beats_touch before update on hookgen_beats
  for each row execute function hook_studio_touch();

-- Worker job kinds.
alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch',
                  'remake_split', 'remake_frames', 'remake_still', 'remake_tts', 'remake_clip', 'remake_mix',
                  'talking_head', 'image_gen',
                  'cartoon_character', 'cartoon_still', 'cartoon_clip', 'cartoon_voice', 'cartoon_join',
                  'hookgen_still', 'hookgen_clip', 'hookgen_check', 'hookgen_join'));
