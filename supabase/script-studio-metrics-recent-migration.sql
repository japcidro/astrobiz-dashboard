-- Script Generator: the ad metrics function also reads the this_month
-- payload, which the warm-cache cron refreshes every half hour, so ads
-- launched this month (the new winners on little spend) carry their real
-- purchases even when nobody has viewed those days on the Ad Performance
-- page.
--
-- Coverage, oldest to newest: the viewed week-long and single-day ranges
-- that end before the month; the whole month to date from this_month.
-- Without a this_month payload it falls back to the ranges alone, as before.
--
-- Run with:  npm run db:run -- supabase/script-studio-metrics-recent-migration.sql

drop function if exists script_studio_ad_metrics();
create or replace function script_studio_ad_metrics()
returns table (
  ad_id text,
  account_id text,
  ad text,
  campaign text,
  adset text,
  account text,
  purchases bigint,
  spend numeric,
  revenue numeric,
  impressions bigint,
  created_time text
)
language sql
stable
as $$
  with keys as (
    select cache_key,
           substring(cache_key from 'range:(\d{4}-\d{2}-\d{2}):') as f,
           substring(cache_key from 'range:\d{4}-\d{2}-\d{2}:(\d{4}-\d{2}-\d{2})$') as t
    from cached_api_data
    where cache_type = 'ads' and cache_key like 'ads_v3:account=ALL&date_preset=range:%'
  ),
  month as (
    -- The month to date, as of the payload's refresh (Manila time).
    select cache_key,
           to_char(date_trunc('month', (refreshed_at at time zone 'Asia/Manila')::date), 'YYYY-MM-DD') as f,
           to_char((refreshed_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as t
    from cached_api_data
    where cache_type = 'ads' and cache_key = 'ads_v3:account=ALL&date_preset=this_month'
  ),
  weekly as (select cache_key, f, t from keys where f <> t),
  daily as (select cache_key, f, t from keys where f = t),
  chosen as (
    select cache_key from month
    union all
    select w.cache_key from weekly w where not exists (select 1 from month m where w.t >= m.f)
    union all
    select d.cache_key from daily d
    where not exists (select 1 from month m where d.f between m.f and m.t)
      and (exists (select 1 from month m where d.f > m.t)
           or (not exists (select 1 from month) and d.f > (select max(t) from weekly)))
  )
  select e->>'ad_id',
         max(e->>'account_id'),
         max(e->>'ad'),
         max(e->>'campaign'),
         max(e->>'adset'),
         max(e->>'account'),
         coalesce(sum((e->>'purchases')::numeric), 0)::bigint,
         coalesce(sum((e->>'spend')::numeric), 0),
         coalesce(sum((e->>'roas')::numeric * (e->>'spend')::numeric), 0),
         coalesce(sum((e->>'impressions')::numeric), 0)::bigint,
         max(e->>'created_time')
  from cached_api_data c
  join chosen u on u.cache_key = c.cache_key
  cross join lateral jsonb_array_elements(c.response_data->'data') e
  where e->>'ad_id' is not null
  group by e->>'ad_id'
$$;

notify pgrst, 'reload schema';
