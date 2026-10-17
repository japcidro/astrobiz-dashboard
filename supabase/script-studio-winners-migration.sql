-- Script Generator, round two: the winners list comes from the ad data
-- (cached per brand, newest first, with thumbnails and transcripts), the
-- Winning DNA is anchored on the last `anchor_days`, and the marketer keeps
-- a standing brief per brand that the skill reads before every run.
--
-- Run with:  npm run db:run -- supabase/script-studio-winners-migration.sql

create table if not exists script_brand_winners (
  store text primary key,
  winners jsonb not null default '[]'::jsonb,   -- [{ad_id, account_id, ad, created_time, purchases, spend, cpa, thumbnail_url, transcript, seconds, analyzed}]
  refreshed_at timestamptz not null default now()
);
alter table script_brand_winners enable row level security;

alter table script_brand_dna alter column dna set default '';
alter table script_brand_dna add column if not exists marketer_brief text not null default '';
alter table script_brand_dna add column if not exists anchor_days int not null default 45;

-- The metrics function now also returns the ad account, which on-demand
-- deconstruction needs to find the ad's video.
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
  weekly as (select cache_key, f, t from keys where f <> t),
  daily as (select cache_key from keys where f = t and f > (select max(t) from weekly)),
  chosen as (
    select cache_key from weekly
    union all select cache_key from daily
    union all
    select cache_key from cached_api_data
    where cache_key = 'ads_v3:account=ALL&date_preset=last_30d' and not exists (select 1 from weekly)
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
