-- ============================================
-- Fix: Add unique constraint to pack_verifications
-- Run this in your Supabase SQL Editor
--
-- Context: The Verify & Pack save endpoint uses
--   .upsert(..., { onConflict: "store_id,order_id" })
-- but the original table had no matching UNIQUE
-- constraint, so every save was failing with:
--   "there is no unique or exclusion constraint
--    matching the ON CONFLICT specification"
-- ============================================

-- 1. Collapse any duplicate rows that snuck in before the constraint.
--    Keep the most recently completed row per (store_id, order_id).
with ranked as (
  select
    id,
    row_number() over (
      partition by store_id, order_id
      order by completed_at desc nulls last, id desc
    ) as rn
  from pack_verifications
)
delete from pack_verifications
where id in (select id from ranked where rn > 1);

-- 2. Add the composite unique constraint the upsert relies on.
--    (store_id, order_id) is the correct natural key because the
--    same Shopify order id can exist across different stores.
alter table pack_verifications
  drop constraint if exists pack_verifications_store_order_key;

alter table pack_verifications
  add constraint pack_verifications_store_order_key
  unique (store_id, order_id);
