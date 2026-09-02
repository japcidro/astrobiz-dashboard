-- ============================================
-- Bonus Tiers - Migration
-- Run this in your Supabase SQL Editor
-- ============================================
--
-- Company-wide parcel-volume bonus. One shared target (average parcels
-- shipped per day within a semi-monthly cutoff period); when the period's
-- average clears a tier, every employee receives that tier's amount.
--
-- Tiers are stored (not hardcoded) so the CEO can retune thresholds and
-- payouts from the dashboard without a deploy.

create table bonus_tiers (
  id uuid primary key default uuid_generate_v4(),
  -- Average parcels/day the company must average across the cutoff
  -- period for this tier to pay out.
  parcel_threshold integer not null,
  -- Peso amount each employee receives at this tier. Same for everyone.
  bonus_amount numeric(10,2) not null default 0,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(parcel_threshold)
);

create index idx_bonus_tiers_threshold on bonus_tiers(parcel_threshold);

alter table bonus_tiers enable row level security;

-- Every signed-in employee can READ the tiers — the whole point of the
-- dashboard is that the team sees what they are working toward.
create policy "bonus_tiers_read_all" on bonus_tiers
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid())
  );

-- Only admin can change thresholds / payouts.
create policy "bonus_tiers_write_admin" on bonus_tiers
  for insert with check (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "bonus_tiers_update_admin" on bonus_tiers
  for update using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "bonus_tiers_delete_admin" on bonus_tiers
  for delete using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create trigger bonus_tiers_updated_at
  before update on bonus_tiers
  for each row execute function update_updated_at();

-- Seed the tiers the CEO described. Amounts are placeholders — edit them
-- from the Bonus dashboard (admin only).
insert into bonus_tiers (parcel_threshold, bonus_amount, label) values
  (70,  500.00,  'Tier 1'),
  (100, 1000.00, 'Tier 2'),
  (130, 1500.00, 'Tier 3')
on conflict (parcel_threshold) do nothing;
