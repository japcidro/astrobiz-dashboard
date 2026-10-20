-- Call Coach, Phase 3: the Monday coaching digest per VA.
-- Alerts reuse admin_alerts (owner) and employee_notifications (the VA);
-- only the digest needs a table of its own.
--
-- Run with:  npm run db:run -- supabase/call-coach-phase3-migration.sql

create table if not exists call_coach_digests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  week_start date not null,              -- the Monday (Manila) the digest covers
  week_end date not null,                -- that Sunday
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  model text,
  days_reviewed int not null default 0,
  calls_count int not null default 0,
  reached_count int not null default 0,
  confirmed_count int not null default 0,
  upsell_attempted int not null default 0,
  upsell_converted int not null default 0,
  score numeric(3,1),                    -- week average of day scores
  prev_score numeric(3,1),               -- the week before, for the trend
  scores jsonb not null default '{}',    -- rubric averages for the week
  summary text,                          -- for the owner
  wins jsonb not null default '[]',      -- ["Confirmation read-backs are now consistent", ...]
  coaching jsonb not null default '[]',  -- the 2-3 things to coach this week
  training_clips jsonb not null default '[]', -- [{date, at, note}] moments worth replaying with the VA
  va_message text,                       -- the short note the VA sees
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, week_start)
);

create index if not exists call_coach_digests_week_idx on call_coach_digests (week_start desc);

alter table call_coach_digests enable row level security;

notify pgrst, 'reload schema';
