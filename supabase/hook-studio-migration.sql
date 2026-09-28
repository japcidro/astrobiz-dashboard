-- Hook Studio — reference-video remakes for SoulShot, rendered by the
-- Higgsfield CLI on Julius's Mac through a job queue.
--
-- Tables are service-role only (RLS on, no policies): the owner API routes
-- and the Mac worker both use the service key. Nothing here is readable
-- with the anon key.
--
-- Run with:  npm run db:run -- supabase/hook-studio-migration.sql

create extension if not exists pgcrypto;

-- ─── Hooks: one row per reference video + brief ───
create table if not exists hook_studio_hooks (
  id uuid primary key default gen_random_uuid(),
  lane text not null check (lane in ('prayer', 'motivation', 'manifestation')),
  brief text not null default '',
  creator text not null default 'Filipina, 20s',
  screen_mode text not null default 'dark' check (screen_mode in ('dark', 'app')),
  reference_path text,                 -- storage path of the uploaded reference
  reference_name text,
  reference_duration numeric,          -- seconds, as measured in the browser
  reference_width int,
  reference_height int,
  trim_start numeric not null default 0,
  trim_end numeric,                    -- null = to the end (capped at 15 s by the worker)
  edit_prompt text,                    -- written by Claude, editable
  text_options jsonb not null default '[]'::jsonb,
  chosen_text text,
  face_id uuid,                        -- pinned face, optional
  title text,                          -- short label for the library (chosen text or brief)
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Faces: pinned creators reused across hooks ───
create table if not exists hook_studio_faces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_path text not null,            -- storage path
  source text not null check (source in ('soul', 'upload')),
  creator text,                        -- the preset it was generated from
  created_at timestamptz not null default now()
);

alter table hook_studio_hooks
  drop constraint if exists hook_studio_hooks_face_id_fkey,
  add constraint hook_studio_hooks_face_id_fkey
    foreign key (face_id) references hook_studio_faces (id) on delete set null;

-- ─── Jobs: what the Mac worker runs ───
create table if not exists hook_studio_jobs (
  id uuid primary key default gen_random_uuid(),
  hook_id uuid references hook_studio_hooks (id) on delete cascade,
  kind text not null check (kind in ('remake', 'face')),
  engine text not null,                -- engine id from src/lib/hook-studio/engines.ts
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  attempts int not null default 0,
  worker text,
  cli_job_id text,
  cli_command text,                    -- the redacted command line, for debugging
  estimate_credits numeric,            -- from `higgsfield generate cost`
  result_path text,                    -- storage path of the copied output
  result_source_url text,              -- Higgsfield CDN URL (expires)
  error text,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists hook_studio_jobs_queue_idx
  on hook_studio_jobs (status, created_at);
create index if not exists hook_studio_jobs_hook_idx
  on hook_studio_jobs (hook_id, created_at);

alter table hook_studio_hooks enable row level security;
alter table hook_studio_faces enable row level security;
alter table hook_studio_jobs enable row level security;

-- updated_at
create or replace function hook_studio_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists hook_studio_hooks_touch on hook_studio_hooks;
create trigger hook_studio_hooks_touch
  before update on hook_studio_hooks
  for each row execute function hook_studio_touch();

-- ─── Claim the next job (worker) ───
-- Atomic under concurrency: skip locked. Also frees jobs a crashed worker
-- left "running" for longer than 45 minutes.
create or replace function hook_studio_claim_job(p_worker text)
returns setof hook_studio_jobs
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  update hook_studio_jobs
     set status = 'queued', worker = null, claimed_at = null, started_at = null,
         error = coalesce(error, '') || ' [requeued: worker lost]'
   where status = 'running'
     and claimed_at < now() - interval '45 minutes';

  select id into v_id
    from hook_studio_jobs
   where status = 'queued'
   order by created_at
   for update skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  return query
    update hook_studio_jobs
       set status = 'running',
           worker = p_worker,
           claimed_at = now(),
           started_at = now(),
           attempts = attempts + 1
     where id = v_id
     returning *;
end $$;

-- ─── Storage bucket (private; the app signs URLs) ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hook-studio', 'hook-studio', false, 209715200,
  array['video/mp4', 'video/quicktime', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
