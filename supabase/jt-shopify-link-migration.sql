-- ============================================
-- J&T → Shopify order link — Migration
--
-- Adds shopify_* columns to jt_deliveries so each parcel can be tied
-- back to the Shopify order it came from. Match key is
-- shopify.fulfillments[].tracking_number = jt_deliveries.waybill, which
-- the pick-pack VAs already populate when fulfilling orders.
--
-- Why: revenue is grouped by Shopify order created_at, but returns are
-- grouped by J&T submission_date. Pick-pack lag (1-2 days normal, up
-- to 3) means an order placed Apr 19 may not appear in the J&T file
-- until Apr 20-22. The dashboard's per-date "Returns" column was
-- counting parcels submitted on that date, NOT parcels from orders
-- placed on that date — different cohorts. After this migration,
-- profit/daily can group returns by shopify_order_date so each date's
-- row reflects the true cohort profitability of orders placed that day.
--
-- Run in Supabase SQL Editor.
-- ============================================

alter table jt_deliveries
  add column if not exists shopify_order_id text,
  add column if not exists shopify_order_name text,
  add column if not exists shopify_order_date date,
  add column if not exists shopify_customer_email text;

create index if not exists idx_jt_deliveries_shopify_order_date
  on jt_deliveries(shopify_order_date);

create index if not exists idx_jt_deliveries_shopify_order_id
  on jt_deliveries(shopify_order_id);

-- Partial index for the backfill endpoint to quickly find unmatched rows.
create index if not exists idx_jt_deliveries_unmatched
  on jt_deliveries(submission_date)
  where shopify_order_id is null;
