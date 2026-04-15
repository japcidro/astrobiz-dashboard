-- ============================================
-- Shopify Stores Table - Migration
-- Run this in your Supabase SQL Editor
-- ============================================

create table shopify_stores (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  store_url text not null,
  api_token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table shopify_stores enable row level security;

-- Admin full access
create policy "shopify_stores_admin_all" on shopify_stores
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

-- Admin + VA can read (VA needs store info to view orders)
create policy "shopify_stores_va_select" on shopify_stores
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'va')
  );

-- Fulfillment can read stores (needs store info to view orders)
create policy "shopify_stores_fulfillment_select" on shopify_stores
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'fulfillment')
  );

-- Updated_at trigger
create trigger shopify_stores_updated_at
  before update on shopify_stores
  for each row execute function update_updated_at();
