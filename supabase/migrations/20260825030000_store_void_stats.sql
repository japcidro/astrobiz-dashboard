-- Per-store cancellation statistics, used to correct young dates in the P&L.
--
-- Orders are not cancelled when they are placed. The team calls each customer
-- to confirm; a lead that never answers is deleted after 3+ days. Measured
-- across 6,804 orders May-Aug 2026:
--
--   * by the end of an order's own day, essentially NONE of its cohort's
--     cancellations have happened yet
--   * about half land by day 4
--   * they are complete by day 10-14
--
-- So the dashboard was booking revenue, COGS and shipping for orders that were
-- going to disappear, overstating net profit on the freshest date by 14%
-- (I LOVE PATCHES, CAPSULED) to 41% (FOLIQ) — the exact date everyone reads.
--
-- Refreshed daily by /api/cron/refresh-void-stats from a trailing window of
-- fully-settled cohorts, so each store carries its own rate and the numbers
-- track reality instead of a hardcoded constant.

create table if not exists public.store_void_stats (
  store_name text primary key,
  -- Share of GROSS revenue on a date that is eventually voided (0..1).
  void_rate numeric not null default 0,
  -- settlement_curve[i+1] = share of that voided value already settled by age
  -- i days. Postgres arrays are 1-indexed; index 1 is age 0.
  settlement_curve numeric[] not null default '{}',
  sample_orders integer not null default 0,
  sample_from date,
  sample_to date,
  refreshed_at timestamptz not null default now()
);

comment on table public.store_void_stats is
  'Cancellation rate and settlement curve per store. Drives the void adjustment on young dates in /api/profit/daily.';
comment on column public.store_void_stats.void_rate is
  'Share of gross revenue eventually voided. Measured from fully-settled cohorts only.';
comment on column public.store_void_stats.settlement_curve is
  'settlement_curve[i+1] = fraction of eventual void VALUE already cancelled by age i days.';

alter table public.store_void_stats enable row level security;

drop policy if exists "store_void_stats_read" on public.store_void_stats;
create policy "store_void_stats_read" on public.store_void_stats
  for select using (
    exists (select 1 from public.employees e where e.auth_id = auth.uid())
  );
