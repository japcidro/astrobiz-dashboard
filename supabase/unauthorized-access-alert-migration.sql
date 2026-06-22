-- ============================================
-- Unauthorized-access email alerts — dedupe ledger.
--
-- Anyone with a Google account can AUTHENTICATE via the login page, but only
-- emails pre-registered in `employees` are AUTHORIZED to see the dashboard.
-- When an authenticated user has no employee record, the dashboard layout
-- bounces them to the "Account Not Set Up" screen (zero data access).
--
-- This table records each such bounced account so the admin is emailed exactly
-- ONCE per unknown account (not on every page load). Inserted via the service
-- role from src/lib/alerts/unauthorized-access.ts.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

create table if not exists public.unauthorized_access_attempts (
  auth_id uuid primary key,
  email text,
  first_seen_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists unauthorized_access_attempts_seen_idx
  on public.unauthorized_access_attempts (first_seen_at desc);

alter table public.unauthorized_access_attempts enable row level security;

-- Admins can read the log from the dashboard (service role bypasses RLS on write).
drop policy if exists "unauthorized_access_attempts_admin_read"
  on public.unauthorized_access_attempts;
create policy "unauthorized_access_attempts_admin_read"
  on public.unauthorized_access_attempts for select
  using (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role = 'admin'
    )
  );
