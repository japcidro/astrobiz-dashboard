-- Bulk Create copy suggestions learn from the store's best-selling ads
-- (src/lib/marketing/winning-copy.ts). Per ad: purchases and spend over the
-- last p_days, summed from the one-day ads caches only. The week and month
-- caches overlap them and each other, so adding those in would count the
-- same day two or three times. Ads with no spend in the window are left out,
-- which keeps the result well under PostgREST's 1000-row cap.

create or replace function ad_totals_last_days(p_days int default 90)
returns table (
  ad_id text,
  account_id text,
  ad text,
  campaign text,
  adset text,
  account text,
  purchases bigint,
  spend numeric,
  created_time text
)
language sql
stable
as $$
  with days as (
    select cache_key
    from cached_api_data
    where cache_type = 'ads'
      and cache_key like 'ads_v3:account=ALL&date_preset=range:%'
      and substring(cache_key from 'range:(\d{4}-\d{2}-\d{2}):') = substring(cache_key from ':(\d{4}-\d{2}-\d{2})$')
      and substring(cache_key from 'range:(\d{4}-\d{2}-\d{2}):')::date >= current_date - p_days
  )
  select e->>'ad_id',
         max(e->>'account_id'),
         max(e->>'ad'),
         max(e->>'campaign'),
         max(e->>'adset'),
         max(e->>'account'),
         coalesce(sum((e->>'purchases')::numeric), 0)::bigint,
         coalesce(sum((e->>'spend')::numeric), 0),
         max(e->>'created_time')
  from cached_api_data c
  join days d on d.cache_key = c.cache_key
  cross join lateral jsonb_array_elements(c.response_data->'data') e
  where e->>'ad_id' is not null
  group by e->>'ad_id'
  having coalesce(sum((e->>'spend')::numeric), 0) > 0
  order by 7 desc, 8 desc
$$;

notify pgrst, 'reload schema';
