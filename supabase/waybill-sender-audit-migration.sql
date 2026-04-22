-- ============================================
-- Waybill Sender Audit — catch wrong sender names at pack-verify time
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Logs every pack verification with the sender name the packer saw
-- on the J&T label, so we can spot mismatches (e.g. order is CAPSULED
-- but label says I LOVE PATCHES) without waiting for the J&T upload.
-- ============================================

create table if not exists waybill_sender_audits (
  id uuid primary key default gen_random_uuid(),

  -- Order reference
  order_id text not null,
  order_number text,
  waybill text,

  -- Sender check
  expected_store text not null,    -- from Shopify (store_name)
  actual_sender text not null,     -- what the packer selected/saw on label
  is_mismatch boolean not null,

  -- Audit trail
  packed_by uuid references employees(id) on delete set null,
  packed_at timestamptz not null default now()
);

create index if not exists waybill_sender_audits_mismatch_idx
  on waybill_sender_audits (packed_at desc)
  where is_mismatch = true;

create index if not exists waybill_sender_audits_order_idx
  on waybill_sender_audits (order_id);

alter table waybill_sender_audits enable row level security;

drop policy if exists "waybill_sender_audits_admin_read" on waybill_sender_audits;
create policy "waybill_sender_audits_admin_read"
  on waybill_sender_audits for select
  using (
    exists (
      select 1 from employees
      where employees.id = auth.uid()
        and employees.role = 'admin'
    )
  );

drop policy if exists "waybill_sender_audits_fulfillment_insert" on waybill_sender_audits;
create policy "waybill_sender_audits_fulfillment_insert"
  on waybill_sender_audits for insert
  with check (
    exists (
      select 1 from employees
      where employees.id = auth.uid()
        and employees.role in ('admin', 'fulfillment')
    )
  );
