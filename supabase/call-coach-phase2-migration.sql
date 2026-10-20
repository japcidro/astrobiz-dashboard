-- Call Coach, Phase 2: transcripts and scores on top of the Phase 1 audio.
-- Gemini writes one transcript per stored segment; Claude reads a whole day,
-- splits it into calls, scores each against the rubric and writes the day's
-- review with coaching notes.
--
-- Run with:  npm run db:run -- supabase/call-coach-phase2-migration.sql

-- ─── Transcription bookkeeping on the segment itself ───
alter table call_coach_segments add column if not exists transcribe_attempts int not null default 0;
alter table call_coach_segments add column if not exists transcribe_error text;

-- ─── One transcript per segment ───
create table if not exists call_coach_transcripts (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null unique references call_coach_segments(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  model text not null,
  language text,                         -- what Gemini heard: taglish, tagalog, english, ...
  text text not null,                    -- "[0:04] VA: ..." lines, for the owner page
  turns jsonb not null default '[]',     -- [{t: seconds into the segment, speaker, text}]
  tokens int,
  created_at timestamptz not null default now()
);

create index if not exists call_coach_transcripts_employee_date_idx
  on call_coach_transcripts (employee_id, date);

-- ─── One review per employee per day ───
create table if not exists call_coach_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  model text,
  segments_count int not null default 0,
  voice_seconds numeric(8,1) not null default 0,
  reviewed_through timestamptz,          -- the last segment this review covers
  calls_count int not null default 0,
  reached_count int not null default 0,
  confirmed_count int not null default 0,
  upsell_attempted int not null default 0,
  upsell_converted int not null default 0,
  score numeric(3,1),                    -- day average over scored calls, 1 to 5
  scores jsonb not null default '{}',    -- per rubric item average
  summary text,
  coaching jsonb not null default '[]',  -- ["Upsell every happy customer", ...]
  non_call_notes text,
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, date)
);

create index if not exists call_coach_reviews_date_idx on call_coach_reviews (date desc);

-- ─── One row per call Claude found in the day ───
create table if not exists call_coach_calls (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references call_coach_reviews(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  position int not null,                 -- order within the day
  started_at timestamptz not null,
  ended_at timestamptz not null,
  outcome text not null
    check (outcome in ('confirmed', 'cancelled', 'callback', 'no_answer', 'wrong_number', 'not_sales', 'unclear')),
  customer_audible boolean not null default false,
  scores jsonb not null default '{}',    -- {greeting, confirmation, upsell, objection, tone, closing} each 1-5 or null
  overall numeric(3,1),
  summary text not null,
  upsell_attempted boolean not null default false,
  upsell_converted boolean not null default false,
  flags text[] not null default '{}',
  moments jsonb not null default '[]',   -- [{at, tag, note, quote}]
  created_at timestamptz not null default now()
);

create index if not exists call_coach_calls_review_idx on call_coach_calls (review_id, position);
create index if not exists call_coach_calls_employee_date_idx on call_coach_calls (employee_id, date);

alter table call_coach_transcripts enable row level security;
alter table call_coach_reviews enable row level security;
alter table call_coach_calls enable row level security;

notify pgrst, 'reload schema';
