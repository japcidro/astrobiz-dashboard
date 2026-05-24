-- ============================================
-- winner_pool_ads — admin-curated bucket of ads to include in the next
-- generated "Winning & Losing Ads Log" document.
--
-- Replaces the old approved_scripts winner-tagging surface that was
-- dropped 2026-05-23. Lightweight by design: one row per ad-in-pool,
-- removal is a hard delete (not soft).
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

create table if not exists public.winner_pool_ads (
  ad_id text primary key,
  store_name text,
  tagged_at timestamptz not null default now(),
  tagged_by uuid references public.employees(id) on delete set null
);

create index if not exists winner_pool_ads_store_tagged_idx
  on public.winner_pool_ads (store_name, tagged_at desc);

alter table public.winner_pool_ads enable row level security;

drop policy if exists "winner_pool_ads_manage" on public.winner_pool_ads;
create policy "winner_pool_ads_manage"
  on public.winner_pool_ads for all
  using (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  )
  with check (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );
