-- ============================================
-- RTS Batches — Waybill-first redesign
--
-- Old flow: VA picks store from a dropdown, types the J&T waybill as
-- a free-text "batch_ref", then free-scans whatever SKUs are inside
-- the package. No link back to the original Shopify order, no notion
-- of "what was supposed to be in this parcel", no protection against
-- the same waybill being processed twice.
--
-- New flow: VA scans the waybill barcode → the modal resolves the
-- order from jt_deliveries / Shopify fulfillments → store + line
-- items pre-fill → VA scans each item to confirm received vs damaged
-- vs missing against the expected list.
--
-- This migration adds the data model behind that flow. It does NOT
-- delete the old free-text path: rts_batches.batch_ref stays so the
-- manual fallback (lost label, J&T sync hasn't caught up) still works
-- and existing rows keep validating.
--
-- Decisions baked in (CEO-approved 2026-04-26):
--   - One open batch per waybill at a time. A second VA scanning the
--     same waybill resumes the existing batch instead of creating a
--     duplicate. Enforced by uq_rts_batches_waybill_open.
--   - Closed batch + same waybill rescanned later: API blocks at the
--     handler layer (admin can flip status back to 'open' to reopen).
--     No DB-level block — the partial unique index allows it because
--     the closed row doesn't match the WHERE clause.
--   - Damaged units are counted + noted, not moved to a separate
--     inventory location. Only received_qty bumps Shopify stock.
--
-- Idempotent. Run in Supabase SQL Editor.
-- ============================================

-- 1. New columns on rts_batches -----------------------------------------------
-- Waybill is the canonical ID for a returned parcel. batch_ref stays as the
-- free-text fallback for manual entries; waybill is the typed, dedup-able
-- form. Always uppercase + trimmed (enforced in API, matches the convention
-- in src/lib/shopify/tracking-to-order.ts).
alter table rts_batches
  add column if not exists waybill text,
  add column if not exists shopify_order_id text,
  add column if not exists shopify_order_name text,
  add column if not exists shopify_order_date date,
  -- How the order/store were resolved at batch-open time. Useful for
  -- debugging "why did this batch open against the wrong store" and for
  -- separating clean auto-resolves from manual overrides in reporting.
  -- Allowed values: 'jt_deliveries' | 'shopify_tracking_map' | 'manual_fallback'.
  add column if not exists lookup_source text;

-- One open batch per waybill. Partial index so closed batches don't block
-- a future re-open and so legacy rows (waybill is null) are unaffected.
create unique index if not exists uq_rts_batches_waybill_open
  on rts_batches(waybill)
  where status = 'open' and waybill is not null;

-- Lookup helpers for the resolver endpoint and admin reporting.
create index if not exists idx_rts_batches_waybill
  on rts_batches(waybill) where waybill is not null;
create index if not exists idx_rts_batches_shopify_order
  on rts_batches(shopify_order_id) where shopify_order_id is not null;


-- 2. rts_batch_items ----------------------------------------------------------
-- One row per Shopify line item expected in the returned parcel, snapshotted
-- at batch-open time. Decoupled from inventory_adjustments because:
--   - "expected but never scanned" (missing) has no inventory move
--   - "expected and damaged" has no inventory move either
--   - inventory_adjustments only exists when stock actually changes
-- So the expected/received/damaged checklist lives here; the actual stock
-- bumps continue to flow through inventory_adjustments with rts_batch_id set.
create table if not exists rts_batch_items (
  id uuid primary key default gen_random_uuid(),
  rts_batch_id uuid not null references rts_batches(id) on delete cascade,

  -- Snapshot fields. Frozen at batch-open time — if the Shopify order is
  -- edited afterwards (refund-and-restore, line edits), this row keeps the
  -- version the VA was working against. shopify_line_item_id is null only
  -- on manual-fallback batches that have no order context.
  shopify_line_item_id text,
  sku text,
  barcode text,
  product_title text,
  variant_title text,
  inventory_item_id bigint,
  expected_qty int not null check (expected_qty > 0),

  -- VA's verdict. received_qty is what got scanned in & restocked; damaged
  -- is physically present but not restocked; missing is derived as
  -- greatest(expected - received - damaged, 0) at close time.
  received_qty int not null default 0 check (received_qty >= 0),
  damaged_qty int not null default 0 check (damaged_qty >= 0),

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rts_batch_items_batch
  on rts_batch_items(rts_batch_id);

-- One row per Shopify line item per batch. Manual-fallback rows skip this
-- index (shopify_line_item_id is null for those).
create unique index if not exists uq_rts_batch_items_line
  on rts_batch_items(rts_batch_id, shopify_line_item_id)
  where shopify_line_item_id is not null;

alter table rts_batch_items enable row level security;

create policy "rts_batch_items_fulfillment" on rts_batch_items
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid()
        and e.role in ('admin', 'fulfillment')
    )
  );


-- 3. Touch updated_at on rts_batch_items --------------------------------------
-- Keeps last-modified honest so admin views can sort by recent activity
-- without relying on the API to remember to bump it.
create or replace function set_rts_batch_items_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_rts_batch_items_updated_at on rts_batch_items;
create trigger trg_rts_batch_items_updated_at
  before update on rts_batch_items
  for each row execute function set_rts_batch_items_updated_at();
