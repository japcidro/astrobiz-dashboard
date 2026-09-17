-- ============================================
-- Ads cache v2 -> v3 — Migration
--
-- /api/facebook/all-ads used to key its cache on include_zero_spend, so it
-- kept two entries per window: `zero=1` (what every dashboard reads) and
-- `zero=0` (what the warm-cache cron wrote). They cost identical Facebook
-- calls and differed only in whether zero-activity ads were trimmed from the
-- response, so the split bought nothing and guaranteed the cron warmed a key
-- no page ever read. v3 keeps one entry holding the superset and trims it per
-- caller in code.
--
-- Without this seed the first load after deploy finds an empty v3 namespace
-- and goes to Facebook cold — which is exactly the state we are digging out
-- of. Copy the `zero=1` payloads (already the superset) onto their v3 keys so
-- the dashboard has something to serve while the cron rebuilds.
--
-- Safe to re-run. Run in Supabase SQL Editor.
-- ============================================

-- 1. Seed v3 from the superset entries -----------------------------------------
-- buildCacheKey sorts params alphabetically, so `zero` is always the suffix:
--   ads_v2:account=ALL&date_preset=today&zero=1  ->  ads_v3:account=ALL&date_preset=today
--
-- zero=1 goes first because it holds every ad. `on conflict do nothing` here
-- also protects any v3 entry the deployed code has already written — those are
-- newer and correctly flagged, so they must win over anything seeded.
insert into cached_api_data (cache_type, cache_key, response_data, refreshed_at)
select
  'ads',
  replace(replace(cache_key, 'ads_v2:', 'ads_v3:'), '&zero=1', ''),
  response_data,
  refreshed_at
from cached_api_data
where cache_key like 'ads\_v2:%zero=1'
on conflict (cache_key) do nothing;

-- Then the zero=0 entries, for windows the pass above did not cover. Almost all
-- of these are the briefings' historical `range:` backfills — one per past day,
-- built from windows Facebook would charge a full walk to rebuild. Dropping
-- them unseeded would have handed that bill straight back to us the next time a
-- briefing looked at an old date.
insert into cached_api_data (cache_type, cache_key, response_data, refreshed_at)
select
  'ads',
  replace(replace(cache_key, 'ads_v2:', 'ads_v3:'), '&zero=0', ''),
  response_data,
  refreshed_at
from cached_api_data
where cache_key like 'ads\_v2:%zero=0'
on conflict (cache_key) do nothing;

-- Seeded rows predate the `zero_activity` flag, and an unflagged row is treated
-- as real activity. For the briefings' range entries that is exactly right —
-- they were built without zero-spend ads in the first place. For a preset
-- entry seeded from zero=0 the dashboard sees spenders only until the cron
-- rewrites it, which is within the hour.

-- 2. Drop the superseded entries ------------------------------------------------
-- Safe now: every v2 key was copied to its v3 name above (or lost to a conflict
-- with a newer v3 entry, which is the outcome we want).
delete from cached_api_data where cache_key like 'ads\_v2:%';

-- The old refresh-data cron re-cached each response under a second key that no
-- reader ever used — a multi-megabyte row per preset. The cron no longer
-- writes these; clear what it left behind.
delete from cached_api_data where cache_key like 'ads:%';

-- 3. Clear any lingering backoff ------------------------------------------------
-- blocked_until is only honoured while it is in the future, so this matters
-- only if Facebook's last 429 named a long wait. If we are genuinely still
-- blocked the next call re-records it.
update fb_rate_limit_state set blocked_until = null where id = 1;

-- 4. What got seeded ------------------------------------------------------------
select
  case when cache_key like '%date\_preset=range:%' then 'range (briefings)'
       else 'preset (dashboard)' end as kind,
  count(*) as entries,
  pg_size_pretty(sum(pg_column_size(response_data))::bigint) as total_size,
  min(refreshed_at) as oldest,
  max(refreshed_at) as newest
from cached_api_data
where cache_key like 'ads\_v3:%'
group by 1 order by 1;
