-- ============================================
-- RTS Batches — Migration
--
-- Wraps a session of RTS (Return-To-Sender) stock-in scans into a
-- single auditable batch. Each scan inside an open batch increments
-- the SKU stock by exactly +1 via /api/shopify/inventory-adjust and
-- gets tagged with rts_batch_id so the parent batch is reconstructable.
--
-- Run in Supabase SQL Editor.
-- ============================================

-- 1. rts_batches --------------------------------------------------------------
create table rts_batches (
  id uuid primary key default gen_random_uuid(),

  -- Free-form reference. Typically a J&T waybill number or a
  -- daily batch label like "RTS 2026-04-25 AM".
  batch_ref text not null,

  -- Store the returns belong to. Single-store per batch — if the VA
  -- is processing returns for two stores they open two batches.
  store_id uuid not null references shopify_stores(id),

  notes text,

  -- 'open' = scans accepted; 'closed' = sealed, no more scans.
  status text not null default 'open' check (status in ('open', 'closed')),

  opened_by uuid not null references employees(id),
  opened_at timestamptz not null default now(),

  closed_by uuid references employees(id),
  closed_at timestamptz,

  -- Cached counters refreshed on each scan + close. Avoids a join
  -- to inventory_adjustments for the common list-batches view.
  item_count int not null default 0,
  unit_count int not null default 0
);

create index idx_rts_batches_status_opened
  on rts_batches(status, opened_at desc);
create index idx_rts_batches_opened_by
  on rts_batches(opened_by, opened_at desc);
create index idx_rts_batches_store
  on rts_batches(store_id, opened_at desc);

alter table rts_batches enable row level security;

-- Admin + fulfillment can read & write their batches.
create policy "rts_batches_fulfillment" on rts_batches
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid()
        and e.role in ('admin', 'fulfillment')
    )
  );


-- 2. Link inventory_adjustments rows to a batch -------------------------------
alter table inventory_adjustments
  add column if not exists rts_batch_id uuid references rts_batches(id) on delete set null;

create index if not exists idx_inventory_adjustments_rts_batch
  on inventory_adjustments(rts_batch_id);
