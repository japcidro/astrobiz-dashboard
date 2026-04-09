-- ============================================
-- Astrobiz Dashboard - Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- ENUM TYPES
-- ============================================

create type user_role as enum ('admin', 'va', 'fulfillment', 'marketing');
create type time_entry_status as enum ('running', 'paused', 'completed');

-- ============================================
-- EMPLOYEES TABLE
-- ============================================

create table employees (
  id uuid primary key default uuid_generate_v4(),
  auth_id uuid unique references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  role user_role not null default 'va',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- TIME ENTRIES TABLE
-- Stores each work session (start/pause/resume/stop)
-- ============================================

create table time_entries (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null default current_date,
  status time_entry_status not null default 'running',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  total_seconds integer not null default 0,
  is_manual boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- TIME PAUSES TABLE
-- Tracks individual pause/resume within a session
-- ============================================

create table time_pauses (
  id uuid primary key default uuid_generate_v4(),
  time_entry_id uuid not null references time_entries(id) on delete cascade,
  paused_at timestamptz not null default now(),
  resumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================
-- INDEXES
-- ============================================

create index idx_employees_auth_id on employees(auth_id);
create index idx_employees_role on employees(role);
create index idx_time_entries_employee_date on time_entries(employee_id, date);
create index idx_time_entries_status on time_entries(status);
create index idx_time_pauses_entry on time_pauses(time_entry_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table employees enable row level security;
alter table time_entries enable row level security;
alter table time_pauses enable row level security;

-- Employees can read their own profile; admins can read all
create policy "employees_select_own" on employees
  for select using (
    auth.uid() = auth_id
    or exists (
      select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

-- Allow self-registration (via trigger) or admin insert
create policy "employees_insert" on employees
  for insert with check (
    auth.uid() = auth_id
    or exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "employees_admin_update" on employees
  for update using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

-- Time entries: employees can manage their own; admins can read all
create policy "time_entries_select" on time_entries
  for select using (
    employee_id in (select id from employees where auth_id = auth.uid())
    or exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "time_entries_insert" on time_entries
  for insert with check (
    employee_id in (select id from employees where auth_id = auth.uid())
  );

create policy "time_entries_update" on time_entries
  for update using (
    employee_id in (select id from employees where auth_id = auth.uid())
  );

-- Time pauses: same as time entries
create policy "time_pauses_select" on time_pauses
  for select using (
    time_entry_id in (
      select te.id from time_entries te
      join employees e on e.id = te.employee_id
      where e.auth_id = auth.uid()
    )
    or exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "time_pauses_insert" on time_pauses
  for insert with check (
    time_entry_id in (
      select te.id from time_entries te
      join employees e on e.id = te.employee_id
      where e.auth_id = auth.uid()
    )
  );

create policy "time_pauses_update" on time_pauses
  for update using (
    time_entry_id in (
      select te.id from time_entries te
      join employees e on e.id = te.employee_id
      where e.auth_id = auth.uid()
    )
  );

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger employees_updated_at
  before update on employees
  for each row execute function update_updated_at();

create trigger time_entries_updated_at
  before update on time_entries
  for each row execute function update_updated_at();

-- ============================================
-- HELPER FUNCTION: Get or create employee on first login
-- ============================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into employees (auth_id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'va' -- default role, admin changes later
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger: auto-create employee record when a new user signs up
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================
-- APP SETTINGS TABLE
-- Key-value store for global config (FB token, selected accounts, etc.)
-- ============================================

create table app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Admins can read and write all settings
create policy "app_settings_select" on app_settings
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "app_settings_insert" on app_settings
  for insert with check (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "app_settings_update" on app_settings
  for update using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "app_settings_delete" on app_settings
  for delete using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

-- Marketing role needs read access to token for API calls
create policy "app_settings_marketing_select" on app_settings
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'marketing')
    and key in ('fb_access_token', 'fb_selected_accounts')
  );

create trigger app_settings_updated_at
  before update on app_settings
  for each row execute function update_updated_at();
