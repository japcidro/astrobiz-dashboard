-- ============================================
-- Pack Verifications: Manual Clear + Unique Key
-- Run this in your Supabase SQL Editor.
--
-- Safe to run multiple times (idempotent). Combines:
--   1) The unique-constraint fix (was in pack-verifications-unique-fix.sql)
--   2) New `notes` + `source` columns for manual clears / backfills
--
-- Context:
--   Pick & Pack list excludes orders that appear in pack_verifications.
--   Fulfillment needs a way to mark orders as "already packed offline"
--   without running a scan, while preserving a full audit trail.
-- ============================================

-- 1. Collapse any duplicate rows that snuck in before the unique constraint.
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

-- 2. Ensure the composite unique constraint exists.
--    (store_id, order_id) is the correct natural key — the same Shopify
--    order id can exist across different stores.
alter table pack_verifications
  drop constraint if exists pack_verifications_store_order_key;

alter table pack_verifications
  add constraint pack_verifications_store_order_key
  unique (store_id, order_id);

-- 3. Add audit-trail columns.
--    source:  'scan'          → normal Verify & Pack scan  (default)
--             'manual_clear'  → operator marked as already packed offline
--             'backfill'      → bulk catch-up entry
--    notes:  free-text reason entered by the operator
alter table pack_verifications
  add column if not exists notes text;

alter table pack_verifications
  add column if not exists source text not null default 'scan';

-- 4. Helpful index for the audit page (filter by source + recency).
create index if not exists pack_verifications_source_completed_idx
  on pack_verifications (source, completed_at desc);
