-- ============================================
-- Autopilot Module — FB Ads auto-pause + auto-resume
-- Run this in your Supabase SQL Editor
-- ============================================

-- ---------- Singleton config ----------
create table if not exists autopilot_config (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,

  -- Rule 1: No-purchase spender. Pause if spend >= X AND purchases = 0.
  kill_no_purchase_spend_min numeric(10,2) not null default 330,

  -- Rule 2: High CPA. Pause if purchases >= 1 AND CPA > X.
  kill_high_cpa_max numeric(10,2) not null default 380,

  updated_by uuid references employees(id),
  updated_at timestamptz not null default now()
);

-- Drop legacy safety-rail / auto-resume columns on existing installations.
alter table autopilot_config drop column if exists min_age_hours;
alter table autopilot_config drop column if exists max_pauses_per_run;
alter table autopilot_config drop column if exists auto_resume;
alter table autopilot_config drop column if exists resume_lookback_hours;

-- Only one row allowed (singleton)
create unique index if not exists autopilot_config_singleton
  on autopilot_config ((true));

-- Seed default row if empty
insert into autopilot_config (enabled)
select false
where not exists (select 1 from autopilot_config);

-- ---------- Watchlist (manual opt-in) ----------
create table if not exists autopilot_watched_campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  campaign_id text not null,
  campaign_name text,
  added_by uuid references employees(id),
  added_at timestamptz not null default now(),
  unique (account_id, campaign_id)
);

create index if not exists autopilot_watched_campaign_lookup
  on autopilot_watched_campaigns (campaign_id);

-- ---------- Audit log ----------
create table if not exists autopilot_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  action text not null check (action in ('paused', 'resumed', 'skipped', 'error')),

  ad_id text not null,
  ad_name text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  account_id text,

  rule_matched text,         -- 'no_purchase' | 'high_cpa' | 'recovered'
  spend numeric(10,2),
  purchases int,
  cpa numeric(10,2),

  status text not null default 'ok' check (status in ('ok', 'error', 'skipped')),
  error_message text,

  -- For 'resumed' rows: link back to the 'paused' row being undone.
  paused_action_id uuid references autopilot_actions(id),

  -- Set when user manually resumes via Activity tab (prevents re-resume).
  undone_at timestamptz,
  undone_by uuid references employees(id),

  created_at timestamptz not null default now()
);

create index if not exists autopilot_actions_created
  on autopilot_actions (created_at desc);
create index if not exists autopilot_actions_ad
  on autopilot_actions (ad_id, created_at desc);
create index if not exists autopilot_actions_run
  on autopilot_actions (run_id);

-- ---------- RLS: admin-only ----------
alter table autopilot_config enable row level security;
alter table autopilot_watched_campaigns enable row level security;
alter table autopilot_actions enable row level security;

drop policy if exists "autopilot_config_admin" on autopilot_config;
create policy "autopilot_config_admin" on autopilot_config for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
);

drop policy if exists "autopilot_watchlist_admin" on autopilot_watched_campaigns;
create policy "autopilot_watchlist_admin" on autopilot_watched_campaigns for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
);

drop policy if exists "autopilot_actions_admin" on autopilot_actions;
create policy "autopilot_actions_admin" on autopilot_actions for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'marketing'))
);
