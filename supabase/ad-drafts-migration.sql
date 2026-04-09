-- ============================================
-- Ad Drafts Table - Migration
-- Run this in your Supabase SQL Editor
-- ============================================

create type ad_draft_status as enum ('draft', 'submitting', 'submitted', 'failed');

create table ad_drafts (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id) on delete cascade,
  ad_account_id text not null,
  status ad_draft_status not null default 'draft',
  name text not null,

  -- Mode: 'new', 'existing_campaign', 'existing_adset'
  mode text not null default 'new',
  existing_campaign_id text,
  existing_adset_id text,

  -- Wizard data (null when using existing)
  campaign_data jsonb,
  adset_data jsonb,
  ad_data jsonb not null default '{}'::jsonb,

  -- FB IDs after successful submission
  fb_campaign_id text,
  fb_adset_id text,
  fb_ad_id text,

  -- Error tracking
  error_message text,
  submitted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ad_drafts_employee on ad_drafts(employee_id);
create index idx_ad_drafts_status on ad_drafts(status);

-- RLS
alter table ad_drafts enable row level security;

create policy "ad_drafts_select" on ad_drafts
  for select using (
    employee_id in (select id from employees where auth_id = auth.uid())
    or exists (
      select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "ad_drafts_insert" on ad_drafts
  for insert with check (
    employee_id in (select id from employees where auth_id = auth.uid())
  );

create policy "ad_drafts_update" on ad_drafts
  for update using (
    employee_id in (select id from employees where auth_id = auth.uid())
    or exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "ad_drafts_delete" on ad_drafts
  for delete using (
    employee_id in (select id from employees where auth_id = auth.uid())
    or exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

-- Updated_at trigger
create trigger ad_drafts_updated_at
  before update on ad_drafts
  for each row execute function update_updated_at();
