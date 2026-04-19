-- ============================================
-- AI Chat Sessions — persistence for AI Analytics chat
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Stores per-employee chat transcripts so a user can come back later
-- and recall the last thing they asked about. No cross-user visibility.
-- ============================================

create table if not exists ai_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade not null,
  title text,
  account_id text,
  date_preset text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_chat_sessions_employee_updated_idx
  on ai_chat_sessions (employee_id, updated_at desc);

alter table ai_chat_sessions enable row level security;

-- Employee can see/manage their own sessions. Admin sees all.
drop policy if exists "ai_chat_sessions_own_or_admin" on ai_chat_sessions;
create policy "ai_chat_sessions_own_or_admin" on ai_chat_sessions
  for all using (
    employee_id in (select id from employees where auth_id = auth.uid())
    or exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  ) with check (
    employee_id in (select id from employees where auth_id = auth.uid())
  );

create or replace function update_ai_chat_sessions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ai_chat_sessions_updated_at on ai_chat_sessions;
create trigger ai_chat_sessions_updated_at
  before update on ai_chat_sessions
  for each row execute function update_ai_chat_sessions_updated_at();
