-- ============================================
-- Approved Script Creatives — Migration
-- Per-script uploaded creatives (image or video variants).
-- Uploaded once from the Approved Library → FB ad account. Bulk Create
-- "Import from Library" reuses these so launches are fast (no re-upload).
-- Run in Supabase SQL Editor.
-- ============================================

create table approved_script_creatives (
  id uuid primary key default uuid_generate_v4(),
  approved_script_id uuid not null
    references approved_scripts(id) on delete cascade,

  -- FB ad account where the hash/video_id is valid. image_hash & video_id
  -- are ad-account-scoped — if the store ever switches ad accounts, the
  -- old creative rows become dead (re-upload required).
  fb_ad_account_id text not null,

  creative_type text not null check (creative_type in ('image', 'video')),
  fb_image_hash text,
  fb_video_id text,
  file_name text,

  -- Optional thumbnail URL (FB returns one for videos via /thumbnails; UI
  -- may also store a data URL it derived client-side).
  thumbnail_url text,

  -- Optional human label so editors can tag variants (e.g. "v2 — faster cut").
  label text,

  uploaded_by uuid references employees(id) on delete set null,
  uploaded_at timestamptz not null default now(),

  -- Enforce: image rows carry image_hash only; video rows carry video_id only.
  constraint approved_script_creatives_type_consistency check (
    (creative_type = 'image' and fb_image_hash is not null and fb_video_id is null)
    or
    (creative_type = 'video' and fb_video_id is not null and fb_image_hash is null)
  )
);

create index idx_approved_script_creatives_script
  on approved_script_creatives(approved_script_id);

-- RLS — admin + marketing manage creatives
alter table approved_script_creatives enable row level security;

create policy "approved_script_creatives_select" on approved_script_creatives
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "approved_script_creatives_insert" on approved_script_creatives
  for insert with check (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "approved_script_creatives_update" on approved_script_creatives
  for update using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "approved_script_creatives_delete" on approved_script_creatives
  for delete using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
