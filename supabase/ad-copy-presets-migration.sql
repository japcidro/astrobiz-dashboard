-- ============================================
-- Ad Copy Presets — Migration
-- Per-store reusable snippets for Bulk Create fields
-- (ad name, primary text, headline, description).
-- One preset targets ONE field (`kind`). Admin + marketing manage them.
-- Run in Supabase SQL Editor.
-- ============================================

create type ad_copy_preset_kind as enum (
  'ad_name',
  'primary_text',
  'headline',
  'description'
);

create table ad_copy_presets (
  id uuid primary key default uuid_generate_v4(),
  shopify_store_id uuid not null references shopify_stores(id) on delete cascade,
  kind ad_copy_preset_kind not null,
  label text not null,
  content text not null,

  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A label must be unique within (store, kind). Different kinds can share
  -- labels — e.g. "Default" for headline and "Default" for primary text.
  unique (shopify_store_id, kind, label)
);

create index idx_ad_copy_presets_store_kind
  on ad_copy_presets(shopify_store_id, kind);

-- RLS — admin + marketing read/write/delete
alter table ad_copy_presets enable row level security;

create policy "ad_copy_presets_select" on ad_copy_presets
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "ad_copy_presets_insert" on ad_copy_presets
  for insert with check (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "ad_copy_presets_update" on ad_copy_presets
  for update using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "ad_copy_presets_delete" on ad_copy_presets
  for delete using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create trigger ad_copy_presets_updated_at
  before update on ad_copy_presets
  for each row execute function update_updated_at();
