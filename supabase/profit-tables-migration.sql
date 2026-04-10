-- ============================================
-- Profit Tables - Migration
-- Run this in your Supabase SQL Editor
-- ============================================

-- COGS (Cost of Goods Sold) per SKU
create table cogs_items (
  id uuid primary key default uuid_generate_v4(),
  store_name text not null,
  sku text not null,
  product_name text,
  cogs_per_unit numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_name, sku)
);

create index idx_cogs_items_store on cogs_items(store_name);
create index idx_cogs_items_sku on cogs_items(sku);

alter table cogs_items enable row level security;

create policy "cogs_items_admin" on cogs_items
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create trigger cogs_items_updated_at
  before update on cogs_items
  for each row execute function update_updated_at();

-- J&T Express Deliveries
create table jt_deliveries (
  id uuid primary key default uuid_generate_v4(),
  waybill text unique not null,
  order_status text not null,
  classification text not null,
  submission_date timestamptz,
  signing_time timestamptz,
  receiver text,
  province text,
  city text,
  cod_amount numeric(10,2) default 0,
  shipping_cost numeric(10,2) default 0,
  item_name text,
  num_items integer default 0,
  item_value numeric(10,2) default 0,
  store_name text,
  payment_method text,
  rts_reason text,
  days_since_submit integer,
  tier_cutoff integer,
  is_delivered boolean not null default false,
  is_returned boolean not null default false,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_jt_deliveries_store on jt_deliveries(store_name);
create index idx_jt_deliveries_date on jt_deliveries(submission_date);
create index idx_jt_deliveries_class on jt_deliveries(classification);

alter table jt_deliveries enable row level security;

create policy "jt_deliveries_admin" on jt_deliveries
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create trigger jt_deliveries_updated_at
  before update on jt_deliveries
  for each row execute function update_updated_at();
