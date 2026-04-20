-- ============================================
-- Scaling campaigns mapping
-- Run in Supabase SQL Editor. Idempotent.
--
-- Maps each Shopify store to its single "scaling" FB campaign.
-- Used by the AI Analytics + Ad Performance pages to (a) mark
-- testing-campaign ads that already have a creative live in
-- scaling, and (b) promote selected testing ads into scaling.
-- ============================================

create table if not exists store_scaling_campaigns (
  id uuid primary key default gen_random_uuid(),
  store_name text unique not null,
  account_id text not null,          -- e.g. "act_123456789"
  campaign_id text not null,
  campaign_name text not null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_scaling_campaigns_account_idx
  on store_scaling_campaigns (account_id);

alter table store_scaling_campaigns enable row level security;

drop policy if exists "ssc_admin_all" on store_scaling_campaigns;
create policy "ssc_admin_all" on store_scaling_campaigns
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "ssc_marketing_select" on store_scaling_campaigns;
create policy "ssc_marketing_select" on store_scaling_campaigns
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create or replace function update_store_scaling_campaigns_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists store_scaling_campaigns_updated_at on store_scaling_campaigns;
create trigger store_scaling_campaigns_updated_at
  before update on store_scaling_campaigns
  for each row execute function update_store_scaling_campaigns_updated_at();
