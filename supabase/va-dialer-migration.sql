-- ============================================
-- VA Dialer (Phase 2) — browser softphone for VAs via Twilio
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Reuses the same `call_attempts` table the AI Call Confirmer writes to so
-- all calls (AI + VA) share one log. Phase 1 already added `va_id` + `call_source`.
-- This migration adds queue locking, daily spend tracking (separate from
-- AI call_spend_daily), and singleton dialer config (budget + retention).
-- ============================================

-- ============================================
-- VA dialer config — singleton-style (id='default')
-- Admin-editable budget + recording retention
-- ============================================
create table if not exists va_dialer_config (
  id text primary key default 'default',
  daily_budget_usd numeric(10,2) not null default 15.00,
  recording_retention_days int not null default 60,
  enabled boolean not null default true,
  recording_disclosure_text text not null default
    'This call may be recorded for quality and training purposes.',
  per_call_max_seconds int not null default 300,
  updated_at timestamptz not null default now(),
  check (id = 'default')
);

-- ============================================
-- VA call spend daily — separate from call_spend_daily
-- (AI calls are scoped per-store; VA budget is a single team-wide pool)
-- Updated by /api/twilio/voice-status webhook on call end.
-- ============================================
create table if not exists va_call_spend_daily (
  date date primary key,
  total_calls int not null default 0,
  total_seconds int not null default 0,
  total_cost_usd numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists va_call_spend_daily_date_desc_idx
  on va_call_spend_daily (date desc);

-- ============================================
-- Queue locking on call_attempts
-- "Take Call" button sets locked_by + locked_until (now() + 30s) so other VAs
-- don't see/grab the same row. Lock auto-expires.
-- ============================================
alter table call_attempts
  add column if not exists locked_by uuid references employees(id) on delete set null;
alter table call_attempts
  add column if not exists locked_until timestamptz;

create index if not exists call_attempts_locked_until_idx
  on call_attempts (locked_until)
  where locked_until is not null;

-- VA queue index: orders needing followup, ordered by oldest-first
create index if not exists call_attempts_va_queue_open_idx
  on call_attempts (created_at asc)
  where needs_va_followup = true and call_source = 'ai';

-- ============================================
-- Helper: increment VA spend atomically (called by webhook)
-- ============================================
create or replace function increment_va_call_spend(
  p_seconds int,
  p_cost_usd numeric
) returns void
language plpgsql
security definer
as $$
begin
  insert into va_call_spend_daily (date, total_calls, total_seconds, total_cost_usd)
  values (
    current_date,
    1,
    coalesce(p_seconds, 0),
    coalesce(p_cost_usd, 0)
  )
  on conflict (date) do update set
    total_calls    = va_call_spend_daily.total_calls + 1,
    total_seconds  = va_call_spend_daily.total_seconds + coalesce(p_seconds, 0),
    total_cost_usd = va_call_spend_daily.total_cost_usd + coalesce(p_cost_usd, 0),
    updated_at     = now();
end;
$$;

-- ============================================
-- Helper: budget check before minting voice token
-- Returns true if dialer is enabled AND today's spend < daily_budget.
-- ============================================
create or replace function va_dialer_has_budget()
returns boolean
language sql
stable
as $$
  select c.enabled
    and coalesce(s.total_cost_usd, 0) < c.daily_budget_usd
  from va_dialer_config c
  left join va_call_spend_daily s on s.date = current_date
  where c.id = 'default';
$$;

-- ============================================
-- Helper: claim a queue row (atomic lock)
-- Returns true if row was successfully locked to p_va_id; false if already locked or not eligible.
-- ============================================
create or replace function va_queue_claim(
  p_call_attempt_id uuid,
  p_va_id uuid,
  p_lock_seconds int default 30
) returns boolean
language plpgsql
security definer
as $$
declare
  v_updated int;
begin
  update call_attempts
     set locked_by    = p_va_id,
         locked_until = now() + (p_lock_seconds || ' seconds')::interval
   where id = p_call_attempt_id
     and needs_va_followup = true
     and (locked_until is null or locked_until < now() or locked_by = p_va_id);
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- ============================================
-- RLS
-- ============================================
alter table va_dialer_config enable row level security;
alter table va_call_spend_daily enable row level security;

drop policy if exists "va_dialer_config_admin_all" on va_dialer_config;
create policy "va_dialer_config_admin_all" on va_dialer_config
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "va_dialer_config_va_read" on va_dialer_config;
create policy "va_dialer_config_va_read" on va_dialer_config
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'va')
  );

drop policy if exists "va_call_spend_daily_admin_all" on va_call_spend_daily;
create policy "va_call_spend_daily_admin_all" on va_call_spend_daily
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

-- ============================================
-- updated_at trigger for config
-- ============================================
drop trigger if exists va_dialer_config_updated_at on va_dialer_config;
create trigger va_dialer_config_updated_at
  before update on va_dialer_config
  for each row execute function update_updated_at();

-- ============================================
-- Seed default config — $15/day cap, 60-day recording retention
-- ============================================
insert into va_dialer_config (id, daily_budget_usd, recording_retention_days, enabled)
values ('default', 15.00, 60, true)
on conflict (id) do nothing;
