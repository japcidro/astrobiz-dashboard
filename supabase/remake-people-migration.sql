-- Clipper person library — the people who can be put into every clip, kept
-- in folders (FOLIQ, Momentum, …). A person is either a finished UGC
-- Generator image (hook-studio bucket) or an uploaded photo (marketing-board
-- bucket under people/). Picking one copies it into the project's cast slot,
-- so the library file is never touched by a project.
--
-- Service-role only (RLS on, no policies), like the rest of Remake Studio.
--
-- Run with:  npm run db:run -- supabase/remake-people-migration.sql

create table if not exists remake_people_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists remake_people_folders_name_key
  on remake_people_folders (lower(name));

create table if not exists remake_people (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references remake_people_folders (id) on delete set null,  -- null = Unsorted
  name text not null default '',
  bucket text not null check (bucket in ('marketing-board', 'hook-studio')),
  path text not null,
  ugc_job_id uuid unique references hook_studio_jobs (id) on delete cascade,  -- set for UGC Generator images
  created_at timestamptz not null default now()
);

create index if not exists remake_people_folder_idx on remake_people (folder_id, created_at desc);

alter table remake_people_folders enable row level security;
alter table remake_people enable row level security;

-- Every finished UGC Generator image is a person already; they start Unsorted.
insert into remake_people (bucket, path, ugc_job_id, name, created_at)
select 'hook-studio', result_path, id, coalesce(params->>'note', ''), created_at
  from hook_studio_jobs
 where kind = 'ugc_image' and status = 'done' and result_path is not null
on conflict (ugc_job_id) do nothing;
