-- Hook Studio v2 — UGC Generator (image → image) and the simplified video
-- flow: a hook is anchored on a generated UGC image, not on lanes/faces.
--
-- Run with:  npm run db:run -- supabase/hook-studio-v2-migration.sql

-- Jobs: new kinds. 'ugc_image' = person swap on a still (Nano Banana Pro).
alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image'));

-- Hooks: anchored on a UGC image; skill picks how the video is made.
alter table hook_studio_hooks
  alter column lane drop not null,
  alter column lane set default null;
alter table hook_studio_hooks drop constraint if exists hook_studio_hooks_lane_check;

alter table hook_studio_hooks
  add column if not exists ugc_job_id uuid references hook_studio_jobs (id) on delete set null,
  add column if not exists skill text not null default 'motion'
    check (skill in ('motion', 'arcads')),
  add column if not exists engine text,
  add column if not exists quality text not null default 'standard'
    check (quality in ('standard', 'high')),
  add column if not exists duration int not null default 5;

create index if not exists hook_studio_hooks_ugc_idx on hook_studio_hooks (ugc_job_id);
