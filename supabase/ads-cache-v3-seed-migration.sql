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
insert into cached_api_data (cache_type, cache_key, response_data, refreshed_at)
select
  'ads',
  replace(replace(cache_key, 'ads_v2:', 'ads_v3:'), '&zero=1', ''),
  response_data,
  refreshed_at
from cached_api_data
where cache_key like 'ads\_v2:%zero=1'
on conflict (cache_key) do nothing;

-- Rows seeded this way predate the `zero_activity` flag, so a caller that asks
-- for spenders only (the AI agent, briefings) sees the full list until the
-- cron next rewrites the entry. Self-corrects within the hour.

-- 2. Drop the superseded entries ------------------------------------------------
-- v2 keys are no longer read by anything.
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
select cache_key, refreshed_at, jsonb_array_length(response_data -> 'data') as rows
from cached_api_data
where cache_key like 'ads\_v3:%'
order by cache_key;
