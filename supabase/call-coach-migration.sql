-- Call Coach, Phase 1: record the VA's voice from the PC microphone while
-- they are clocked in. The browser keeps only the minutes with voice in them
-- and uploads each as its own small file; silence is dropped before it ever
-- leaves the laptop. Phase 2 adds transcripts and scores on top of these rows.
--
-- Run with:  npm run db:run -- supabase/call-coach-migration.sql

-- ─── Consent: signed once on the dashboard before the first recorded IN ───
create table if not exists call_coach_consents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  signed_name text not null,
  consent_text text not null,            -- the exact wording they agreed to
  ip text,
  user_agent text,
  signed_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists call_coach_consents_active_idx
  on call_coach_consents (employee_id)
  where revoked_at is null;

-- ─── Segments: one voiced minute (or less) of audio in the bucket ───
create table if not exists call_coach_segments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  time_entry_id uuid references time_entries(id) on delete set null,
  date date not null,                    -- the shift's Philippine date
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds numeric(7,1) not null,
  voice_seconds numeric(7,1) not null,   -- how much of it the browser heard as speech
  storage_path text not null,
  bytes integer not null,
  mime text not null default 'audio/webm',
  status text not null default 'stored'
    check (status in ('stored', 'transcribed', 'scored', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists call_coach_segments_employee_date_idx
  on call_coach_segments (employee_id, date, started_at);
create index if not exists call_coach_segments_status_idx
  on call_coach_segments (status, started_at);
create index if not exists call_coach_segments_started_idx
  on call_coach_segments (started_at);

-- ─── Mic events: what the recorder did, so gaps in a day are explainable ───
create table if not exists call_coach_mic_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  time_entry_id uuid references time_entries(id) on delete set null,
  date date not null,
  kind text not null
    check (kind in ('started', 'paused', 'resumed', 'lost', 'blocked', 'stopped', 'silent')),
  at timestamptz not null default now(),
  detail text
);

create index if not exists call_coach_mic_events_employee_date_idx
  on call_coach_mic_events (employee_id, date, at);

-- Only the service role (API routes, crons) touches these tables.
alter table call_coach_consents enable row level security;
alter table call_coach_segments enable row level security;
alter table call_coach_mic_events enable row level security;

-- ─── Storage bucket (private; the app signs URLs for playback) ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-coach', 'call-coach', false, 20971520,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
