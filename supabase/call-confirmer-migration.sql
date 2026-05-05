-- ============================================
-- AI Call Confirmer — admin-only order confirmation calls via Vapi
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Stack: Vapi (orchestration) + ElevenLabs (voice "Maria") + GPT-4o-mini
-- + Twilio PH virtual number. Manual lead select v1, admin only.
-- ============================================

-- ============================================
-- Per-store agent configuration
-- ============================================
create table if not exists call_confirmer_configs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references shopify_stores(id) on delete cascade,

  -- Toggle + persona
  enabled boolean not null default false,
  agent_name text not null default 'Maria',
  voice_id text,                                  -- ElevenLabs voice id
  language text not null default 'taglish'        -- 'taglish' | 'tagalog' | 'english'
    check (language in ('taglish', 'tagalog', 'english')),
  greeting_template text,                         -- {customer_name}, {order_name}, {agent_name}, {store_name}

  -- Operating window (PH local time)
  business_hours_start time not null default '09:00',
  business_hours_end time not null default '18:00',

  -- Retry behavior
  max_attempts int not null default 3,
  retry_interval_minutes int not null default 90,

  -- Handoff
  support_phone text,                             -- E.164 format, e.g. +639171234567

  -- Cost guardrails (CRITICAL — see feedback_call_confirmer_budget_reminder)
  daily_budget_usd numeric(10,2) not null default 5.00,
  per_call_max_seconds int not null default 120,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id)
);

-- ============================================
-- Call attempts — one row per dial
-- ============================================
create table if not exists call_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references shopify_stores(id) on delete cascade,

  -- Order context (denormalized snapshot — orders live in Shopify, not Supabase)
  shopify_order_id text not null,
  shopify_order_name text,
  customer_name text,
  customer_phone text not null,
  order_snapshot jsonb,                           -- items, total, address, payment at time of call

  -- Attempt metadata
  attempt_number int not null default 1,
  is_test_call boolean not null default false,
  initiated_by uuid references employees(id) on delete set null,

  -- Lifecycle
  status text not null default 'queued'
    check (status in (
      'queued', 'ringing', 'in_progress', 'completed',
      'failed', 'no_answer', 'voicemail', 'busy', 'escalated'
    )),
  outcome text
    check (outcome is null or outcome in (
      'confirmed', 'declined', 'needs_callback',
      'escalated_to_human', 'unreachable', 'invalid_number'
    )),

  -- Provider tracking
  provider text not null default 'vapi',
  provider_call_id text,

  -- Results
  duration_seconds int,
  cost_usd numeric(10,4),
  recording_url text,
  transcript jsonb,                               -- raw turns from Vapi
  ai_summary text,                                -- 1-2 sentence summary
  questions_asked jsonb,                          -- ["May COD ba?", ...]
  customer_sentiment text                         -- 'positive' | 'neutral' | 'negative'
    check (customer_sentiment is null or customer_sentiment in ('positive', 'neutral', 'negative')),
  handoff_reason text,                            -- why VA needs to follow up
  needs_va_followup boolean not null default false,

  -- Timestamps
  scheduled_for timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists call_attempts_store_status_idx
  on call_attempts (store_id, status);
create index if not exists call_attempts_order_idx
  on call_attempts (shopify_order_id);
create index if not exists call_attempts_created_idx
  on call_attempts (created_at desc);
create index if not exists call_attempts_va_queue_idx
  on call_attempts (store_id, created_at desc)
  where needs_va_followup = true;
create index if not exists call_attempts_provider_call_idx
  on call_attempts (provider_call_id)
  where provider_call_id is not null;

-- ============================================
-- Daily spend rollup — cheap budget check
-- Updated by webhook on each call end.
-- ============================================
create table if not exists call_spend_daily (
  store_id uuid not null references shopify_stores(id) on delete cascade,
  date date not null,
  total_calls int not null default 0,
  total_seconds int not null default 0,
  total_cost_usd numeric(10,4) not null default 0,
  test_calls int not null default 0,
  test_cost_usd numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, date)
);

create index if not exists call_spend_daily_date_idx
  on call_spend_daily (date desc);

-- ============================================
-- RLS: admin-only
-- ============================================
alter table call_confirmer_configs enable row level security;
alter table call_attempts enable row level security;
alter table call_spend_daily enable row level security;

drop policy if exists "call_confirmer_configs_admin_all" on call_confirmer_configs;
create policy "call_confirmer_configs_admin_all" on call_confirmer_configs
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

-- VAs can READ call_attempts (for their callback queue) but only admin can write
drop policy if exists "call_attempts_admin_all" on call_attempts;
create policy "call_attempts_admin_all" on call_attempts
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

drop policy if exists "call_attempts_va_read" on call_attempts;
create policy "call_attempts_va_read" on call_attempts
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('va', 'fulfillment')
    )
    and needs_va_followup = true
  );

drop policy if exists "call_spend_daily_admin_all" on call_spend_daily;
create policy "call_spend_daily_admin_all" on call_spend_daily
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

-- ============================================
-- Helper: increment daily spend atomically
-- Called from webhook handler.
-- ============================================
create or replace function increment_call_spend(
  p_store_id uuid,
  p_seconds int,
  p_cost_usd numeric,
  p_is_test boolean default false
) returns void
language plpgsql
security definer
as $$
begin
  insert into call_spend_daily (
    store_id, date, total_calls, total_seconds, total_cost_usd,
    test_calls, test_cost_usd
  ) values (
    p_store_id, current_date,
    case when p_is_test then 0 else 1 end,
    case when p_is_test then 0 else coalesce(p_seconds, 0) end,
    case when p_is_test then 0 else coalesce(p_cost_usd, 0) end,
    case when p_is_test then 1 else 0 end,
    case when p_is_test then coalesce(p_cost_usd, 0) else 0 end
  )
  on conflict (store_id, date) do update set
    total_calls    = call_spend_daily.total_calls + (case when p_is_test then 0 else 1 end),
    total_seconds  = call_spend_daily.total_seconds + (case when p_is_test then 0 else coalesce(p_seconds, 0) end),
    total_cost_usd = call_spend_daily.total_cost_usd + (case when p_is_test then 0 else coalesce(p_cost_usd, 0) end),
    test_calls     = call_spend_daily.test_calls + (case when p_is_test then 1 else 0 end),
    test_cost_usd  = call_spend_daily.test_cost_usd + (case when p_is_test then coalesce(p_cost_usd, 0) else 0 end),
    updated_at     = now();
end;
$$;

-- ============================================
-- Helper: budget check before initiating
-- Returns true if store has remaining budget today.
-- ============================================
create or replace function call_confirmer_has_budget(p_store_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(s.total_cost_usd, 0) < c.daily_budget_usd
  from call_confirmer_configs c
  left join call_spend_daily s
    on s.store_id = c.store_id and s.date = current_date
  where c.store_id = p_store_id;
$$;

-- ============================================
-- updated_at trigger for configs
-- ============================================
create or replace function call_confirmer_configs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists call_confirmer_configs_updated_at on call_confirmer_configs;
create trigger call_confirmer_configs_updated_at
  before update on call_confirmer_configs
  for each row
  execute function call_confirmer_configs_set_updated_at();
