-- Remake Studio — turn a real reference video into AI clips for our brand:
-- the video is cut into shots, each shot's frame is redone with a new person
-- and OUR product (Nano Banana Pro), stills are approved, then each still is
-- animated (motion transfer from the real shot, Kling from a prompt, or a
-- lipsync model speaking the marketer's script).
--
-- Service-role only (RLS on, no policies), like Hook Studio. Files live in
-- the marketing-board bucket under remake/ and brand/.
--
-- Run with:  npm run db:run -- supabase/remake-studio-migration.sql

create table if not exists remake_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  store text,
  board_item_id uuid references marketing_board_items (id) on delete set null,
  source_path text not null,                 -- video in the marketing-board bucket
  source_duration numeric,
  status text not null default 'splitting'
    check (status in ('splitting', 'classifying', 'ready', 'failed')),
  error text,
  -- Cast: one person for every shot
  cast_look text not null default 'varied',
  cast_note text not null default '',
  cast_shot_id uuid,                         -- the approved still whose person is reused
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists remake_shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references remake_projects (id) on delete cascade,
  idx int not null,
  start_s numeric not null,
  end_s numeric not null,
  kind text not null default 'broll' check (kind in ('talking_head', 'broll')),
  selected boolean not null default true,
  brand_heavy boolean not null default false,  -- mostly competitor packaging / app screen
  description text,                            -- what happens in the shot (vision pass)
  frame_path text,                             -- real frame from the reference
  -- Still: same shot, new person, our product
  still_job_id uuid,
  still_path text,
  still_status text not null default 'none'
    check (still_status in ('none', 'queued', 'running', 'done', 'failed')),
  still_error text,
  brand_check jsonb,                           -- {ok, notes} from the vision pass
  approved boolean not null default false,
  -- Talking head: the marketer's script, spoken by a chosen voice
  script text not null default '',
  voice_id text,
  voice_type text,
  voice_name text,
  tts_job_id uuid,
  audio_path text,
  audio_seconds numeric,
  audio_status text not null default 'none'
    check (audio_status in ('none', 'queued', 'running', 'done', 'failed')),
  audio_error text,
  -- Clip
  clip_engine text not null default 'genjutsu',
  clip_quality text not null default 'standard' check (clip_quality in ('standard', 'high')),
  clip_prompt text,
  clip_job_id uuid,
  clip_path text,
  clip_status text not null default 'none'
    check (clip_status in ('none', 'queued', 'running', 'done', 'failed')),
  clip_error text,
  clip_credits numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists remake_shots_project_idx on remake_shots (project_id, idx);

alter table remake_projects
  drop constraint if exists remake_projects_cast_shot_fkey,
  add constraint remake_projects_cast_shot_fkey
    foreign key (cast_shot_id) references remake_shots (id) on delete set null;

-- Brand kit: our product photos and rules, per store.
create table if not exists remake_brand_kits (
  store text primary key,
  rules text not null default '',
  updated_by uuid references employees (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists remake_brand_images (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  path text not null,                          -- brand/<store>/<uuid>.<ext> in the marketing-board bucket
  label text,
  created_at timestamptz not null default now()
);

create index if not exists remake_brand_images_store_idx on remake_brand_images (store, created_at);

alter table remake_projects enable row level security;
alter table remake_shots enable row level security;
alter table remake_brand_kits enable row level security;
alter table remake_brand_images enable row level security;

drop trigger if exists remake_projects_touch on remake_projects;
create trigger remake_projects_touch before update on remake_projects
  for each row execute function hook_studio_touch();
drop trigger if exists remake_shots_touch on remake_shots;
create trigger remake_shots_touch before update on remake_shots
  for each row execute function hook_studio_touch();

-- Worker job kinds.
alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch',
                  'remake_split', 'remake_still', 'remake_tts', 'remake_clip'));

-- Audio files join the bucket.
update storage.buckets
   set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm',
                                  'image/jpeg', 'image/png', 'image/webp',
                                  'audio/mpeg', 'audio/mp4', 'audio/wav']
 where id = 'marketing-board';
