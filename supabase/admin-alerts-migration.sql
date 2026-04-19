-- ============================================
-- Admin Alerts — Decision Cockpit notifications
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Proactive alerts for admin/CEO to surface decisions
-- (stock restocks, winners, RTS spikes, autopilot actions, etc.).
-- ============================================

create table if not exists admin_alerts (
  id uuid primary key default gen_random_uuid(),

  -- Rule identity
  type text not null,                  -- 'stock_restocked_winner' | 'stock_depleting_winner' | etc.
  severity text not null               -- 'urgent' | 'action' | 'info'
    check (severity in ('urgent', 'action', 'info')),

  title text not null,                 -- Short headline ("I Love Patches restocked 150 units")
  body text,                           -- Optional longer explanation

  -- Resource link (for dedup + navigation)
  resource_type text,                  -- 'product' | 'ad' | 'sku' | 'store' | 'autopilot_run'
  resource_id text,                    -- free-form id
  action_url text,                     -- where the 1-click action points

  -- Rule payload (whatever the rule wants to persist — snapshot metrics, etc.)
  payload jsonb,

  -- Lifecycle
  created_at timestamptz not null default now(),
  read_at timestamptz,                 -- user opened bell / inbox and saw this
  dismissed_at timestamptz,            -- user dismissed without action
  acted_on_at timestamptz,             -- user clicked the action button
  acted_by uuid references employees(id) on delete set null,

  -- Email delivery tracking (for idempotency: don't email twice)
  emailed_at timestamptz,
  digest_included_at timestamptz
);

-- Fast lookup: unread alerts by severity for the bell badge
create index if not exists admin_alerts_unread_severity_idx
  on admin_alerts (severity, created_at desc)
  where read_at is null and dismissed_at is null;

-- Dedup window lookup: "has this resource been alerted for this type in last N hours?"
create index if not exists admin_alerts_type_resource_idx
  on admin_alerts (type, resource_id, created_at desc);

-- Inbox list ordering
create index if not exists admin_alerts_created_idx
  on admin_alerts (created_at desc);

-- Email outbox: urgent alerts not yet emailed
create index if not exists admin_alerts_email_pending_idx
  on admin_alerts (severity, created_at)
  where emailed_at is null and severity = 'urgent';

alter table admin_alerts enable row level security;

drop policy if exists "admin_alerts_admin_all" on admin_alerts;
create policy "admin_alerts_admin_all" on admin_alerts
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

-- ============================================
-- Inventory snapshots — daily stock per SKU per store
-- Used by rule engine to detect restocks + calculate velocity.
-- ============================================
create table if not exists inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  store_name text not null,
  store_id text,
  product_id text,
  product_title text,
  sku text,
  variant_id text,
  variant_title text,
  stock int not null default 0,
  created_at timestamptz not null default now(),
  unique (snapshot_date, store_name, sku, variant_id)
);

create index if not exists inventory_snapshots_sku_date_idx
  on inventory_snapshots (sku, snapshot_date desc);
create index if not exists inventory_snapshots_date_idx
  on inventory_snapshots (snapshot_date desc);

alter table inventory_snapshots enable row level security;

drop policy if exists "inventory_snapshots_admin" on inventory_snapshots;
create policy "inventory_snapshots_admin" on inventory_snapshots
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'fulfillment')
    )
  );

-- ============================================
-- Helper: dedup insert
-- Prevents re-alerting on the same (type, resource_id) within a window.
-- Returns the inserted row's id, or null if suppressed by dedup.
-- ============================================
create or replace function insert_admin_alert(
  p_type text,
  p_severity text,
  p_title text,
  p_body text,
  p_resource_type text,
  p_resource_id text,
  p_action_url text,
  p_payload jsonb,
  p_dedup_hours int default 24
) returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  -- Suppress duplicates within window.
  if p_resource_id is not null then
    select id into v_existing
    from admin_alerts
    where type = p_type
      and resource_id = p_resource_id
      and created_at > now() - (p_dedup_hours || ' hours')::interval
    limit 1;

    if v_existing is not null then
      return null;
    end if;
  end if;

  insert into admin_alerts (
    type, severity, title, body,
    resource_type, resource_id, action_url, payload
  ) values (
    p_type, p_severity, p_title, p_body,
    p_resource_type, p_resource_id, p_action_url, p_payload
  )
  returning id into v_id;

  return v_id;
end;
$$;
