-- ============================================
-- Fix Rejections — auto-pause watchlist for SCALING campaigns.
--
-- For a rejected ad inside a configured scaling campaign
-- (store_scaling_campaigns), we must NOT touch the ad set / campaign
-- budget (it's the shared scaling budget). Instead we swap the creative +
-- re-submit, then watch the ad's post-fix spend; once it reaches the
-- threshold (default ₱70) a cron auto-pauses it so the cat creative grabs
-- a little engagement without eating the scaling budget.
--
-- One row per ad (re-fix upserts). The cron at
-- /api/cron/fix-rejection-autopause flips status watching → paused.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

create table if not exists public.fix_rejection_autopause (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null unique,
  ad_account_id text,
  campaign_id text,
  spend_threshold numeric not null default 70,
  -- PHT date the fix happened; insights spend is measured from this date.
  since_date date not null,
  status text not null default 'watching',  -- watching | paused | cancelled
  last_spend numeric,
  paused_at timestamptz,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fix_rejection_autopause_watching_idx
  on public.fix_rejection_autopause (status);

alter table public.fix_rejection_autopause enable row level security;

drop policy if exists "fix_rejection_autopause_manage"
  on public.fix_rejection_autopause;
create policy "fix_rejection_autopause_manage"
  on public.fix_rejection_autopause for all
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
