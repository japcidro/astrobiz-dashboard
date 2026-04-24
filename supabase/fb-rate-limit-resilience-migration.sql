-- ============================================
-- FB Rate-Limit Resilience — Migration
--
-- Three tables that let the dashboard run without hammering Facebook:
--
-- 1. scaling_detection_cache — precomputed per-ad "is this creative
--    scaled?" map, refreshed every 30 min by a cron. Replaces the
--    per-request FB walk that /api/marketing/scaling/detect used to do.
--
-- 2. fb_rate_limit_state — last known usage % from FB's
--    x-business-use-case-usage header. Used to decide whether to make
--    more FB calls or serve strictly from cache.
--
-- 3. fb_refresh_state — per-scope last-refresh timestamp so the
--    dashboard's manual refresh button can be throttled to 1x / 5 min.
--
-- Run in Supabase SQL Editor.
-- ============================================

-- 1. Scaling detection cache --------------------------------------------------
create table scaling_detection_cache (
  fb_ad_id text primary key,

  -- FB creative id this ad uses. When another ad in a scaling campaign
  -- shares this creative_id, the live ad is "in scaling".
  creative_id text,
  campaign_id text,
  account_id text,

  -- Precomputed result fields — what the client needs to render badges.
  in_scaling boolean not null default false,
  scaled_ad_id text,
  scaled_in_campaign text,
  scaled_in_store text,
  self_is_scaling boolean not null default false,

  refreshed_at timestamptz not null default now()
);

create index idx_scaling_detection_cache_refreshed
  on scaling_detection_cache(refreshed_at);

alter table scaling_detection_cache enable row level security;

create policy "scaling_detection_cache_select" on scaling_detection_cache
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid()
        and e.role in ('admin', 'marketing', 'va', 'fulfillment')
    )
  );

-- Service role (cron) writes. No direct-user write policy — dashboard
-- pages only read.


-- 2. FB rate-limit state ------------------------------------------------------
create table fb_rate_limit_state (
  id int primary key default 1 check (id = 1),

  -- Highest observed usage % across all accounts in the last window.
  -- FB's x-business-use-case-usage returns several numbers per account
  -- (call_count, total_cputime, total_time, ads_management_hourly_rate
  --  etc.). We track the worst one.
  usage_pct numeric,

  -- Timestamp FB told us to wait until. Nullable — only set when a 429
  -- comes back with estimated_time_to_regain_access.
  blocked_until timestamptz,

  -- Last time fbFetch observed a 429 or usage > 90%.
  last_429_at timestamptz,

  -- Free-form latest error message from FB (for the UI banner).
  last_message text,

  updated_at timestamptz not null default now()
);

insert into fb_rate_limit_state (id) values (1)
  on conflict (id) do nothing;

alter table fb_rate_limit_state enable row level security;

create policy "fb_rate_limit_state_select" on fb_rate_limit_state
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid()
        and e.role in ('admin', 'marketing', 'va', 'fulfillment')
    )
  );


-- 3. FB refresh throttle ------------------------------------------------------
-- Keyed by a logical scope string (e.g. "ads:today:ALL"). Writers are the
-- cron + the manual-refresh handler. The dashboard's Refresh button only
-- actually hits FB if the last refresh for this scope is > 5 min old.
create table fb_refresh_state (
  scope text primary key,
  refreshed_at timestamptz not null default now(),
  triggered_by text,  -- 'cron' or 'manual:<employee_id>'
  status text,        -- 'ok' | 'rate_limited' | 'error'
  message text
);

alter table fb_refresh_state enable row level security;

create policy "fb_refresh_state_select" on fb_refresh_state
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid()
        and e.role in ('admin', 'marketing', 'va', 'fulfillment')
    )
  );
