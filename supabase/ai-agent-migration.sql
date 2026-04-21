-- ============================================
-- AI Agent — tool-use audit + session cost tracking
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Adds:
--   1. ai_tool_calls — audit trail of every tool the AI invoked
--      (who/what/when/how long/result preview/error). Lets us see
--      exactly what data the AI touched per employee and catch
--      runaway loops or suspicious access patterns.
--   2. Cost tracking columns on ai_chat_sessions so we can enforce
--      the $0.50-per-session hard cap and see which sessions are
--      expensive.
-- ============================================

create table if not exists ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references ai_chat_sessions(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,

  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output_preview text,        -- first ~500 chars of JSON-serialized result
  result_rows int,            -- row count if applicable (list tools)
  duration_ms int,

  status text not null default 'ok' check (status in ('ok', 'error', 'timeout')),
  error_message text,

  created_at timestamptz not null default now()
);

create index if not exists ai_tool_calls_session_idx
  on ai_tool_calls (session_id, created_at desc);
create index if not exists ai_tool_calls_employee_idx
  on ai_tool_calls (employee_id, created_at desc);
create index if not exists ai_tool_calls_tool_idx
  on ai_tool_calls (tool_name, created_at desc);

alter table ai_tool_calls enable row level security;

drop policy if exists "ai_tool_calls_own_or_admin" on ai_tool_calls;
create policy "ai_tool_calls_own_or_admin" on ai_tool_calls
  for select using (
    employee_id in (select id from employees where auth_id = auth.uid())
    or exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

-- Writes only from the service role (agent loop runs server-side).
-- Authenticated users never insert directly.
drop policy if exists "ai_tool_calls_no_direct_write" on ai_tool_calls;
create policy "ai_tool_calls_no_direct_write" on ai_tool_calls
  for insert with check (false);

-- Cost + token tracking on sessions. Accumulated per turn so a
-- single runaway turn doesn't blow the budget.
alter table ai_chat_sessions
  add column if not exists total_input_tokens int not null default 0;
alter table ai_chat_sessions
  add column if not exists total_output_tokens int not null default 0;
alter table ai_chat_sessions
  add column if not exists total_cache_read_tokens int not null default 0;
alter table ai_chat_sessions
  add column if not exists total_cost_usd numeric(10,4) not null default 0;

-- Seed the feature flag so admins can flip back to the static-context
-- chat instantly if the agent loop misbehaves in production.
-- 'true' → agent loop, 'false' → legacy static-context chat. Flip in
-- app_settings to roll back instantly if needed.
insert into app_settings (key, value)
values ('ai_agent_mode_enabled', 'true')
on conflict (key) do nothing;
