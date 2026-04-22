-- ============================================
-- Store Ad Defaults - Migration
-- Per-store autofill for the FB ad create wizards.
-- One row per shopify_store. Admin/marketing read+write.
-- ============================================

create table store_ad_defaults (
  id uuid primary key default uuid_generate_v4(),
  shopify_store_id uuid not null unique references shopify_stores(id) on delete cascade,

  -- FB identifiers — picked up when a store is selected in the wizard
  ad_account_id text,
  page_id text,
  page_name text,
  pixel_id text,

  -- Shared ad settings
  website_url text,
  url_parameters text default 'utm_source=facebook&utm_medium=paid',
  default_cta text,
  default_daily_budget int,

  -- Targeting
  default_countries text[] not null default '{"PH"}',
  default_age_min int default 18,
  default_age_max int default 65,

  -- Naming patterns. Tokens: {store} {date} {angle} {script_number} {creative_type}
  campaign_name_pattern text,
  adset_name_pattern text,
  ad_name_pattern text,

  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_store_ad_defaults_store on store_ad_defaults(shopify_store_id);

alter table store_ad_defaults enable row level security;

-- Admin + marketing can read
create policy "store_ad_defaults_select" on store_ad_defaults
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

-- Admin + marketing can insert
create policy "store_ad_defaults_insert" on store_ad_defaults
  for insert with check (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

-- Admin + marketing can update
create policy "store_ad_defaults_update" on store_ad_defaults
  for update using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

-- Admin only delete (defaults are rarely destroyed)
create policy "store_ad_defaults_delete" on store_ad_defaults
  for delete using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

create trigger store_ad_defaults_updated_at
  before update on store_ad_defaults
  for each row execute function update_updated_at();

-- ============================================
-- Link column on ad_drafts → shopify_stores
-- Traces every ad back to the store it ran for.
-- Nullable: existing drafts pre-migration keep NULL.
-- ============================================

alter table ad_drafts
  add column shopify_store_id uuid references shopify_stores(id) on delete set null;

create index idx_ad_drafts_shopify_store on ad_drafts(shopify_store_id);
