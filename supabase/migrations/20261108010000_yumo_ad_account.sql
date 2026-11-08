-- YUMO runs in the Chinkee account (act_114982814939195), the account FOLIQ
-- already runs in, so that account now carries two stores. Spend splits by
-- campaign name (FOLIQ-… / YUMO-…), never by account, and the account's own
-- name carries neither brand, so a campaign that names no store stays
-- unattributed rather than landing on the other brand. The campaign name
-- the wizards prefill for YUMO starts with the brand for the same reason.
-- The account is already in fb_selected_accounts. Idempotent.

update public.store_ad_defaults d
   set ad_account_id = 'act_114982814939195',
       campaign_name_pattern = coalesce(d.campaign_name_pattern, 'YUMO-NURSERY'),
       updated_at = now()
  from public.shopify_stores s
 where s.id = d.shopify_store_id
   and upper(s.name) = 'YUMO'
   and d.ad_account_id is distinct from 'act_114982814939195';
