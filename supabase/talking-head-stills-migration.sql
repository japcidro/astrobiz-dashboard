-- Talking Head: the starting-image library. Clipper stills are mirrored in
-- here (one row per shot, refreshed on every load) and photos can be added
-- by upload. Deleting a Clipper-sourced row only hides it here (deleted_at);
-- the Clipper keeps its still.
--
-- Run with:  npm run db:run -- supabase/talking-head-stills-migration.sql

create table if not exists talking_head_stills (
  id uuid primary key default gen_random_uuid(),
  path text not null,                         -- marketing-board bucket
  preview_path text,
  title text not null default '',
  source_shot_id uuid unique references remake_shots (id) on delete set null,
  source_project_id uuid references remake_projects (id) on delete set null,
  clip_idx int,
  voice_gender text check (voice_gender in ('male', 'female')),
  voice_profile text not null default '',
  deleted_at timestamptz,
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists talking_head_stills_live_idx on talking_head_stills (created_at desc) where deleted_at is null;

alter table talking_head_stills enable row level security;

drop trigger if exists talking_head_stills_touch on talking_head_stills;
create trigger talking_head_stills_touch before update on talking_head_stills
  for each row execute function hook_studio_touch();

-- A render remembers which library image it started from, for "Reuse".
alter table talking_heads
  add column if not exists source_still_id uuid references talking_head_stills (id) on delete set null;
