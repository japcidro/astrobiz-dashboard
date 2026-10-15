-- Talking Head (Marketing Tools): pick any still the Clipper generated as
-- the starting image, write a script, and Veo speaks it. Each render is a
-- row here; the still is copied under talking-heads/ so it outlives the
-- project it came from.
--
-- Service-role only (RLS on, no policies), like the rest of the tools.
--
-- Run with:  npm run db:run -- supabase/talking-head-migration.sql

create table if not exists talking_heads (
  id uuid primary key default gen_random_uuid(),
  still_path text not null,                   -- talking-heads/<id>/still.<ext> in the marketing-board bucket
  still_preview_path text,
  source_shot_id uuid references remake_shots (id) on delete set null,
  source_project_id uuid references remake_projects (id) on delete set null,
  title text not null default '',             -- "RELAX GOODIES · clip 7"
  script text not null default '',
  voice_direction text not null default '',
  voice_gender text check (voice_gender in ('male', 'female')),
  voice_profile text not null default '',
  engine text not null default 'veo3_1' check (engine in ('veo3_1', 'veo3')),
  quality text not null default 'standard' check (quality in ('standard', 'high')),
  seconds int not null default 8 check (seconds in (4, 6, 8)),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  job_id uuid,
  clip_path text,
  credits numeric,
  error text,
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists talking_heads_created_idx on talking_heads (created_at desc);

alter table talking_heads enable row level security;

drop trigger if exists talking_heads_touch on talking_heads;
create trigger talking_heads_touch before update on talking_heads
  for each row execute function hook_studio_touch();

-- Worker job kind.
alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch',
                  'remake_split', 'remake_frames', 'remake_still', 'remake_tts', 'remake_clip', 'remake_mix',
                  'talking_head'));
