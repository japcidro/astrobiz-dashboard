-- ============================================
-- KPI Dashboard — admin-only weekly KPI tracking
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Tracks measurable weekly KPIs across Marketing, Sales/VA, and
-- Fulfillment teams. Computed nightly via cron, stored as snapshots.
--
-- Bands:
--   higher_better → value >= green_threshold = green
--                   value <  red_threshold   = red
--                   else                     = yellow
--   lower_better  → value <= green_threshold = green
--                   value >  red_threshold   = red
--                   else                     = yellow
-- ============================================

-- ============================================
-- KPI targets — admin-editable thresholds (traffic light)
-- ============================================
create table if not exists kpi_targets (
  id uuid primary key default gen_random_uuid(),
  kpi_key text not null,
  scope text not null
    check (scope in ('individual', 'team', 'watch')),
  segment text not null
    check (segment in ('marketing', 'sales_va', 'fulfillment', 'watch')),
  display_name text not null,
  unit text,                                -- '%', 'x', 'hours', 'count'
  direction text not null
    check (direction in ('higher_better', 'lower_better')),
  red_threshold numeric not null,
  green_threshold numeric not null,
  effective_from date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kpi_key, scope, effective_from)
);

create index if not exists kpi_targets_active_idx
  on kpi_targets (is_active, segment, kpi_key);

-- ============================================
-- KPI daily snapshots — precomputed values per day
-- Read by dashboard. Written by /api/cron/compute-kpis.
-- ============================================
create table if not exists kpi_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  kpi_key text not null,
  scope text not null
    check (scope in ('individual', 'team', 'watch')),
  employee_id uuid references employees(id) on delete cascade,  -- null when scope='team' or 'watch'
  value numeric not null,
  status text not null
    check (status in ('green', 'yellow', 'red')),
  raw_data jsonb,                           -- numerator/denominator/breakdowns for drilldown
  computed_at timestamptz not null default now()
);

-- nulls not distinct (PG15+) treats null employee_id as equal so one unique
-- index covers both individual and team-scope upserts.
drop index if exists kpi_daily_snapshots_individual_unq;
drop index if exists kpi_daily_snapshots_team_unq;
create unique index if not exists kpi_daily_snapshots_unq
  on kpi_daily_snapshots (snapshot_date, kpi_key, scope, employee_id)
  nulls not distinct;

create index if not exists kpi_daily_snapshots_lookup_idx
  on kpi_daily_snapshots (snapshot_date desc, kpi_key, scope);
create index if not exists kpi_daily_snapshots_employee_idx
  on kpi_daily_snapshots (employee_id, snapshot_date desc)
  where employee_id is not null;

-- ============================================
-- Extend call_attempts for VA-handled calls (browser softphone)
-- Reuses the same table the AI Call Confirmer writes to so all calls
-- (AI + VA) live in one log.
-- ============================================
alter table call_attempts
  add column if not exists va_id uuid references employees(id) on delete set null;

alter table call_attempts
  add column if not exists call_source text not null default 'ai'
    check (call_source in ('ai', 'va_browser', 'manual_log'));

-- Drop existing outcome CHECK and recreate with extra outcomes (no_answer, cancelled)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'call_attempts'::regclass
      and contype = 'c'
      and conname = 'call_attempts_outcome_check'
  ) then
    alter table call_attempts drop constraint call_attempts_outcome_check;
  end if;
end $$;

alter table call_attempts
  add constraint call_attempts_outcome_check
  check (outcome is null or outcome in (
    'confirmed', 'declined', 'needs_callback',
    'escalated_to_human', 'unreachable', 'invalid_number',
    'no_answer', 'cancelled'
  ));

create index if not exists call_attempts_va_idx
  on call_attempts (va_id, started_at desc)
  where va_id is not null;

create index if not exists call_attempts_source_idx
  on call_attempts (call_source, created_at desc);

-- VAs need write access to call_attempts when source='va_browser' (their own calls)
drop policy if exists "call_attempts_va_browser_write" on call_attempts;
create policy "call_attempts_va_browser_write" on call_attempts
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'va'
    )
    and call_source = 'va_browser'
  )
  with check (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'va'
    )
    and call_source = 'va_browser'
  );

-- ============================================
-- Packing errors — fulfillment lead logs at EOD
-- Distinct from pack_verifications (which tracks the in-process scan).
-- This captures post-shipment QA issues found in review.
-- "late_ship" treated as a packing error so perfect-pack rate folds in <24h SLA.
-- ============================================
create table if not exists packing_errors (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id text not null,
  shopify_order_name text,
  error_type text not null
    check (error_type in (
      'wrong_item', 'missing_item', 'wrong_quantity',
      'damaged', 'missing_freebie', 'late_ship', 'other'
    )),
  packed_by uuid references employees(id) on delete set null,
  logged_by uuid not null references employees(id) on delete restrict,
  notes text,
  occurred_on date not null,                -- the day the order shipped
  created_at timestamptz not null default now()
);

create index if not exists packing_errors_occurred_idx
  on packing_errors (occurred_on desc);
create index if not exists packing_errors_packed_by_idx
  on packing_errors (packed_by, occurred_on desc)
  where packed_by is not null;
create index if not exists packing_errors_order_idx
  on packing_errors (shopify_order_id);

-- ============================================
-- Stock count watchlist — top SKUs counted weekly
-- ============================================
create table if not exists stock_count_watchlist (
  sku text primary key,
  product_name text,
  added_at timestamptz not null default now(),
  is_active boolean not null default true
);

-- ============================================
-- Stock counts — Sunday physical counts vs. system inventory
-- ============================================
create table if not exists stock_counts (
  id uuid primary key default gen_random_uuid(),
  week_starting date not null,              -- Monday of the week being counted
  sku text not null,
  expected_qty integer not null,            -- snapshot from inventory_snapshots
  actual_qty integer not null,              -- physical count
  counted_by uuid not null references employees(id) on delete restrict,
  counted_at timestamptz not null default now(),
  notes text,
  unique (week_starting, sku)
);

create index if not exists stock_counts_week_idx
  on stock_counts (week_starting desc);

-- ============================================
-- FB ad attribution — map an FB ad to the marketer who created it
-- (FB API created_by isn't reliable when team shares a Business Manager user)
-- ============================================
create table if not exists fb_ad_attribution (
  fb_ad_id text primary key,
  ad_name text,
  campaign_id text,
  created_by uuid references employees(id) on delete set null,
  is_test boolean not null default true,    -- false = duplicate/scaling/iteration
  tagged_at timestamptz not null default now(),
  fb_created_time timestamptz               -- from FB API
);

create index if not exists fb_ad_attribution_creator_idx
  on fb_ad_attribution (created_by, fb_created_time desc)
  where created_by is not null;

-- ============================================
-- RLS — admin-only writes; selective reads for relevant roles
-- ============================================

alter table kpi_targets enable row level security;
alter table kpi_daily_snapshots enable row level security;
alter table packing_errors enable row level security;
alter table stock_count_watchlist enable row level security;
alter table stock_counts enable row level security;
alter table fb_ad_attribution enable row level security;

-- KPI targets: admin only
drop policy if exists "kpi_targets_admin_all" on kpi_targets;
create policy "kpi_targets_admin_all" on kpi_targets
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

-- KPI snapshots: admin only (Phase 4 will add per-role read for own rows)
drop policy if exists "kpi_daily_snapshots_admin_all" on kpi_daily_snapshots;
create policy "kpi_daily_snapshots_admin_all" on kpi_daily_snapshots
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

-- Packing errors: admin + fulfillment
drop policy if exists "packing_errors_admin_all" on packing_errors;
create policy "packing_errors_admin_all" on packing_errors
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

drop policy if exists "packing_errors_fulfillment_all" on packing_errors;
create policy "packing_errors_fulfillment_all" on packing_errors
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'fulfillment'
    )
  );

-- Stock count watchlist: admin manages, fulfillment reads
drop policy if exists "stock_count_watchlist_admin_all" on stock_count_watchlist;
create policy "stock_count_watchlist_admin_all" on stock_count_watchlist
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

drop policy if exists "stock_count_watchlist_fulfillment_read" on stock_count_watchlist;
create policy "stock_count_watchlist_fulfillment_read" on stock_count_watchlist
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'fulfillment'
    )
  );

-- Stock counts: admin + fulfillment
drop policy if exists "stock_counts_admin_all" on stock_counts;
create policy "stock_counts_admin_all" on stock_counts
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

drop policy if exists "stock_counts_fulfillment_all" on stock_counts;
create policy "stock_counts_fulfillment_all" on stock_counts
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'fulfillment'
    )
  );

-- FB ad attribution: admin + marketing
drop policy if exists "fb_ad_attribution_admin_all" on fb_ad_attribution;
create policy "fb_ad_attribution_admin_all" on fb_ad_attribution
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

drop policy if exists "fb_ad_attribution_marketing_all" on fb_ad_attribution;
create policy "fb_ad_attribution_marketing_all" on fb_ad_attribution
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'marketing'
    )
  );

-- ============================================
-- updated_at trigger for kpi_targets (reuses existing update_updated_at fn)
-- ============================================
drop trigger if exists kpi_targets_updated_at on kpi_targets;
create trigger kpi_targets_updated_at
  before update on kpi_targets
  for each row execute function update_updated_at();

-- ============================================
-- Seed: default KPI targets (locked from planning round)
-- ============================================
insert into kpi_targets (
  kpi_key, scope, segment, display_name, unit, direction,
  red_threshold, green_threshold
) values
  -- Marketing
  ('mkt_creatives_tested_weekly', 'individual', 'marketing',
   'Creatives tested / week', 'count', 'higher_better', 3, 5),
  ('mkt_winners_found_weekly', 'team', 'marketing',
   'Winners found / week', 'count', 'higher_better', 1, 2),
  ('mkt_blended_roas_weekly', 'team', 'marketing',
   'Blended ROAS', 'x', 'higher_better', 4.0, 4.5),

  -- Sales / VA
  ('va_confirmation_rate', 'individual', 'sales_va',
   'COD confirmation rate', '%', 'higher_better', 65, 75),
  ('va_time_to_first_call', 'individual', 'sales_va',
   'Time to first call (median)', 'hours', 'lower_better', 4, 2),
  ('va_calls_per_day', 'individual', 'sales_va',
   'Calls attempted / day', 'count', 'higher_better', 30, 50),
  ('va_queue_cleared_eod', 'team', 'sales_va',
   'Queue cleared by EOD', '%', 'higher_better', 70, 90),
  ('va_cancellation_save_rate', 'team', 'sales_va',
   'Cancellation save rate', '%', 'higher_better', 10, 20),

  -- Fulfillment
  ('fulfill_perfect_pack_rate', 'individual', 'fulfillment',
   'Perfect pack rate (correct + <24h)', '%', 'higher_better', 90, 95),
  ('fulfill_stock_variance', 'team', 'fulfillment',
   'Stock count variance', '%', 'lower_better', 10, 5),

  -- CEO Watch metrics
  ('watch_rts_rate_14d', 'watch', 'watch',
   'RTS rate (rolling 14d)', '%', 'lower_better', 20, 15)
on conflict (kpi_key, scope, effective_from) do nothing;
