-- ============================================
-- Fulfillment Module Tables
-- Run this in your Supabase SQL Editor
-- ============================================

-- Bin/shelf locations for products
create table bin_locations (
  id uuid default gen_random_uuid() primary key,
  store_id text not null,
  sku text not null,
  variant_id text,
  product_title text,
  bin_code text not null,
  zone text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(store_id, sku)
);

-- Inventory adjustment audit log
create table inventory_adjustments (
  id uuid default gen_random_uuid() primary key,
  store_id text not null,
  sku text not null,
  product_title text,
  adjustment_type text not null,
  previous_qty int,
  new_qty int,
  change_qty int,
  reason text,
  performed_by uuid references employees(id),
  created_at timestamptz default now()
);

-- Cycle count session history
create table cycle_counts (
  id uuid default gen_random_uuid() primary key,
  store_id text not null,
  zone text,
  total_skus_counted int,
  discrepancies_found int,
  corrections_applied boolean default false,
  summary jsonb,
  performed_by uuid references employees(id),
  created_at timestamptz default now()
);

-- Low-stock alert thresholds
create table stock_alert_thresholds (
  id uuid default gen_random_uuid() primary key,
  store_id text not null,
  sku text not null,
  low_stock_threshold int default 5,
  unique(store_id, sku)
);

-- Pack verification log
create table pack_verifications (
  id uuid default gen_random_uuid() primary key,
  store_id text not null,
  order_id text not null,
  order_number text not null,
  status text not null,
  items_expected int,
  items_scanned int,
  mismatches jsonb,
  verified_by uuid references employees(id),
  started_at timestamptz,
  completed_at timestamptz default now()
);

-- RLS
alter table bin_locations enable row level security;
alter table inventory_adjustments enable row level security;
alter table cycle_counts enable row level security;
alter table stock_alert_thresholds enable row level security;
alter table pack_verifications enable row level security;

create policy "fulfillment_bin" on bin_locations for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'fulfillment'))
);
create policy "fulfillment_adj" on inventory_adjustments for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'fulfillment'))
);
create policy "fulfillment_cc" on cycle_counts for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'fulfillment'))
);
create policy "fulfillment_thresholds" on stock_alert_thresholds for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'fulfillment'))
);
create policy "fulfillment_verify" on pack_verifications for all using (
  exists (select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'fulfillment'))
);

-- Triggers
create trigger bin_locations_updated_at before update on bin_locations
  for each row execute function update_updated_at();
