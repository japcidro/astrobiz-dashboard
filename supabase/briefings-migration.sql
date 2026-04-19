-- ============================================
-- Briefings — scheduled digest reports for admin
-- Run this in Supabase SQL Editor. Idempotent.
--
-- Types:
--   morning  — yesterday recap at 6 AM PHT
--   evening  — today recap at 10 PM PHT
--   weekly   — last week at Mon 9 AM PHT
--   monthly  — last month at 1st 9 AM PHT
-- ============================================

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('morning', 'evening', 'weekly', 'monthly')),

  -- Human-readable labels
  period_label text not null,        -- "April 18, 2026" | "Week of Apr 14-20" | "March 2026"
  period_start date,
  period_end date,

  headline text not null,            -- One-line summary for inbox/email subject
  ai_summary text,                   -- Claude-generated narrative (may be null if AI failed)
  data jsonb not null,               -- Full structured payload for rendering

  -- Email tracking
  email_sent_at timestamptz,
  email_recipients int,
  email_id text,
  email_error text,

  created_at timestamptz not null default now()
);

create index if not exists briefings_type_created_idx
  on briefings (type, created_at desc);
create index if not exists briefings_created_idx
  on briefings (created_at desc);

-- Dedup: one briefing per type per day
create unique index if not exists briefings_type_period_uniq
  on briefings (type, period_start, period_end);

alter table briefings enable row level security;

drop policy if exists "briefings_admin_all" on briefings;
create policy "briefings_admin_all" on briefings
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );
