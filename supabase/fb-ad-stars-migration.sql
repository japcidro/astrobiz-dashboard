-- ============================================
-- Facebook Ad Stars - Migration
-- Run this in your Supabase SQL Editor.
--
-- Lets the team "star" (tag) good creatives, keyed by the Facebook ad id.
-- Shared flag — admin + marketing can toggle and see it. Purely additive.
-- ============================================

create table if not exists fb_ad_stars (
  fb_ad_id text primary key,
  starred_by uuid references employees(id) on delete set null,
  starred_at timestamptz not null default now()
);

alter table fb_ad_stars enable row level security;

create policy "fb_ad_stars_rw" on fb_ad_stars
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
