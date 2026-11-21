-- NURTELLE runs in act_592752926395010 ("TBM1 - MONEY CATCHER RING - AD ACC1"),
-- the account I Love Patches runs in: NURTELLE-NURSERY lives there. The default
-- pointed at act_888347852462027, which Meta marks UNSETTLED and refuses new
-- creatives in (code 200, subcode 1487194), so Bulk Create's "Apply store
-- defaults" sent Nurtelle launches to an account that cannot run them
-- (2026-11-21). The account carries several stores, and spend splits by
-- campaign name, so the prefilled campaign name starts with the brand, as
-- YUMO's does. The account is already in fb_selected_accounts. Idempotent.

update public.store_ad_defaults d
   set ad_account_id = 'act_592752926395010',
       campaign_name_pattern = coalesce(d.campaign_name_pattern, 'NURTELLE-NURSERY'),
       updated_at = now()
  from public.shopify_stores s
 where s.id = d.shopify_store_id
   and upper(s.name) = 'NURTELLE'
   and d.ad_account_id is distinct from 'act_592752926395010';
