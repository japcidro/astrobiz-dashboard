-- ============================================
-- Approved Scripts Library - Migration
-- Phase 1: table + RLS + link column on ad_drafts
-- Run this in your Supabase SQL Editor
-- ============================================

create type approved_script_status as enum (
  'approved',
  'in_production',
  'shot',
  'live',
  'archived'
);

create table approved_scripts (
  id uuid primary key default uuid_generate_v4(),

  -- Scope
  store_name text not null,

  -- Traceback to source chat thread
  source_thread_id uuid references ai_generations(id) on delete set null,
  source_message_index int,

  -- Script identity (from AI Generator output)
  script_number int,
  angle_title text not null,

  -- Metadata carried from the Angle Generator row
  avatar text,
  angle_type text check (angle_type in ('D', 'E', 'M', 'B')),
  intensity int check (intensity between 1 and 10),
  capacity int check (capacity between 1 and 10),

  -- The content
  hook text not null,
  body_script text not null,
  variant_hooks text[] not null default '{}',

  -- Production workflow
  status approved_script_status not null default 'approved',
  production_notes text,
  final_video_url text,

  -- Audit
  approved_by uuid not null references employees(id) on delete restrict,
  approved_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index idx_approved_scripts_store on approved_scripts(store_name);
create index idx_approved_scripts_status on approved_scripts(status);
create index idx_approved_scripts_thread on approved_scripts(source_thread_id);
create index idx_approved_scripts_angle_type on approved_scripts(angle_type);

-- RLS — admin + marketing can read + write
alter table approved_scripts enable row level security;

create policy "approved_scripts_select" on approved_scripts
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "approved_scripts_insert" on approved_scripts
  for insert with check (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "approved_scripts_update" on approved_scripts
  for update using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "approved_scripts_delete" on approved_scripts
  for delete using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

create trigger approved_scripts_updated_at
  before update on approved_scripts
  for each row execute function update_updated_at();

-- ============================================
-- Link column on ad_drafts → approved_scripts
-- Traces every ad back to the script that inspired it
-- ============================================

alter table ad_drafts
  add column source_script_id uuid references approved_scripts(id) on delete set null;

create index idx_ad_drafts_source_script on ad_drafts(source_script_id);
