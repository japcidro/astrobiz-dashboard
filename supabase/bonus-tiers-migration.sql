-- ============================================
-- Bonus Tiers - Migration
-- Run this in your Supabase SQL Editor
-- ============================================
--
-- Company-wide parcel-volume bonus. One shared target (average parcels
-- shipped per day within a semi-monthly cutoff period); when the period's
-- average clears a tier, the whole team has hit that tier.
--
-- Payout amounts are NOT decided yet, so the dashboard shows the ladder as
-- plain hit / not-yet markers. bonus_amount is kept nullable for when the
-- CEO settles on the figures — null means "not announced", which is a
-- different thing from zero.
--
-- Tiers are stored (not hardcoded) so the CEO can retune thresholds from
-- the dashboard without a deploy.
--
-- Safe to re-run: every statement is guarded, so a half-applied paste can be
-- fixed by simply running the whole file again.

create table if not exists bonus_tiers (
  id uuid primary key default uuid_generate_v4(),
  -- Average parcels/day the company must average across the cutoff
  -- period for this tier to pay out.
  parcel_threshold integer not null,
  -- Peso amount each employee receives at this tier. Same for everyone.
  -- Null until the amounts are announced; the UI shows markers only.
  bonus_amount numeric(10,2),
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(parcel_threshold)
);

create index if not exists idx_bonus_tiers_threshold on bonus_tiers(parcel_threshold);

alter table bonus_tiers enable row level security;

-- Every signed-in employee can READ the tiers — the whole point of the
-- dashboard is that the team sees what they are working toward.
drop policy if exists "bonus_tiers_read_all" on bonus_tiers;
create policy "bonus_tiers_read_all" on bonus_tiers
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid())
  );

-- Only admin can change thresholds / payouts.
drop policy if exists "bonus_tiers_write_admin" on bonus_tiers;
create policy "bonus_tiers_write_admin" on bonus_tiers
  for insert with check (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "bonus_tiers_update_admin" on bonus_tiers;
create policy "bonus_tiers_update_admin" on bonus_tiers
  for update using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "bonus_tiers_delete_admin" on bonus_tiers;
create policy "bonus_tiers_delete_admin" on bonus_tiers
  for delete using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

drop trigger if exists bonus_tiers_updated_at on bonus_tiers;
create trigger bonus_tiers_updated_at
  before update on bonus_tiers
  for each row execute function update_updated_at();

-- Seed the thresholds the CEO described. Amounts stay unset on purpose —
-- thresholds can be retuned from the Bonus dashboard (admin only).
insert into bonus_tiers (parcel_threshold, label) values
  (70,  'Tier 1'),
  (100, 'Tier 2'),
  (130, 'Tier 3')
on conflict (parcel_threshold) do nothing;

-- PostgREST caches the schema; without this the API keeps answering
-- "Could not find the table 'public.bonus_tiers' in the schema cache".
notify pgrst, 'reload schema';
