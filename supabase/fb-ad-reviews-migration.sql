-- ============================================
-- Facebook Ad Reviews - Migration
-- Run this in your Supabase SQL Editor.
--
-- The Submitted Ad Videos screen now pulls ads directly from the Facebook
-- ad account (so it shows EVERY ad a marketer submits, including scheduled
-- ones and ads not tracked in ad_drafts). Those FB ads aren't rows in our
-- DB, so the CEO's "reviewed" marker is stored here, keyed by the Facebook
-- ad id. Purely additive — nothing else changes.
-- ============================================

create table if not exists fb_ad_reviews (
  fb_ad_id text primary key,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table fb_ad_reviews enable row level security;

-- Admin + marketing can read review state.
create policy "fb_ad_reviews_select" on fb_ad_reviews
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

-- Only admin can write review state (the CEO's "reviewed" signal).
create policy "fb_ad_reviews_admin_write" on fb_ad_reviews
  for all using (
    exists (
      select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

create trigger fb_ad_reviews_updated_at
  before update on fb_ad_reviews
  for each row execute function update_updated_at();
