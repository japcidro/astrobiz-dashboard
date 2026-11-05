-- Launched Creatives (owner space): every ad launched in a window, at ad
-- level, with its first 3 and 7 days of results and Meta's rejection
-- history. Three small tables, all keyed by the Facebook ad id.
--
-- fb_ad_daily_insights  one row per ad per PHT day, written from Facebook's
--                       time_increment=1 insights. Past days are final;
--                       the last 7 days are re-read on each refresh so late
--                       attributed purchases catch up.
-- fb_ad_insight_sync    how far each ad has been read, so a refresh only
--                       asks Facebook for the days it does not have.
-- fb_ad_rejections      Meta's review feedback the first time an ad is seen
--                       DISAPPROVED / WITH_ISSUES. Kept after the Fix
--                       Rejections swap clears the status, so the reason is
--                       still readable once the safe image is running.

create table if not exists fb_ad_daily_insights (
  ad_id text not null,
  account_id text not null,
  date date not null,
  spend numeric not null default 0,
  purchases integer not null default 0,
  purchase_value numeric not null default 0,
  add_to_cart integer not null default 0,
  link_clicks integer not null default 0,
  landing_page_views integer not null default 0,
  impressions integer not null default 0,
  reach integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (ad_id, date)
);

create index if not exists fb_ad_daily_insights_date_idx
  on fb_ad_daily_insights (date);

create table if not exists fb_ad_insight_sync (
  ad_id text primary key,
  account_id text not null,
  synced_through date not null,
  refreshed_at timestamptz not null default now()
);

create table if not exists fb_ad_rejections (
  ad_id text primary key,
  account_id text,
  -- DISAPPROVED or WITH_ISSUES, as last seen.
  status text not null,
  -- [{ scope, policy, description }] flattened from ad_review_feedback.
  policies jsonb not null default '[]'::jsonb,
  -- [{ level, type, summary, message, code }] from issues_info.
  issues jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set once the ad is no longer rejected (fixed, re-approved, or paused away).
  cleared_at timestamptz
);

alter table fb_ad_daily_insights enable row level security;
alter table fb_ad_insight_sync enable row level security;
alter table fb_ad_rejections enable row level security;

-- Admin and marketing read; only the service role (the API route) writes.
drop policy if exists "fb_ad_daily_insights_select" on fb_ad_daily_insights;
create policy "fb_ad_daily_insights_select" on fb_ad_daily_insights
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
drop policy if exists "fb_ad_daily_insights_service" on fb_ad_daily_insights;
create policy "fb_ad_daily_insights_service" on fb_ad_daily_insights
  for all using (auth.role() = 'service_role');

drop policy if exists "fb_ad_insight_sync_select" on fb_ad_insight_sync;
create policy "fb_ad_insight_sync_select" on fb_ad_insight_sync
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
drop policy if exists "fb_ad_insight_sync_service" on fb_ad_insight_sync;
create policy "fb_ad_insight_sync_service" on fb_ad_insight_sync
  for all using (auth.role() = 'service_role');

drop policy if exists "fb_ad_rejections_select" on fb_ad_rejections;
create policy "fb_ad_rejections_select" on fb_ad_rejections
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
drop policy if exists "fb_ad_rejections_service" on fb_ad_rejections;
create policy "fb_ad_rejections_service" on fb_ad_rejections
  for all using (auth.role() = 'service_role');

-- Per-ad daily rows as one JSON array each, oldest day first. One row per
-- ad keeps the result well under PostgREST's 1000-row cap even for a
-- 90-day window of launches.
create or replace function fb_ad_daily_series(p_ad_ids text[])
returns table (ad_id text, daily jsonb)
language sql
stable
as $$
  select ad_id,
         jsonb_agg(
           jsonb_build_object(
             'date', to_char(date, 'YYYY-MM-DD'),
             'spend', spend,
             'purchases', purchases,
             'purchase_value', purchase_value,
             'add_to_cart', add_to_cart,
             'link_clicks', link_clicks,
             'landing_page_views', landing_page_views,
             'impressions', impressions,
             'reach', reach
           )
           order by date
         )
  from fb_ad_daily_insights
  where ad_id = any (p_ad_ids)
  group by ad_id
$$;

notify pgrst, 'reload schema';
