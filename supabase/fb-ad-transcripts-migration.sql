-- ============================================
-- Facebook Ad Transcripts - Migration
-- Run this in your Supabase SQL Editor.
--
-- Caches the plain transcript of a submitted ad video (Gemini Flash,
-- transcript-only — no deconstruction) keyed by the Facebook ad id, so the
-- "Get transcript" button on the Submitted Ad Videos screen only pays the
-- AI cost once per ad. Purely additive.
-- ============================================

create table if not exists fb_ad_transcripts (
  fb_ad_id text primary key,
  video_id text,
  transcript text not null,
  model text,
  tokens_used int,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table fb_ad_transcripts enable row level security;

-- Admin + marketing can read and create transcripts.
create policy "fb_ad_transcripts_select" on fb_ad_transcripts
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "fb_ad_transcripts_insert" on fb_ad_transcripts
  for insert with check (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
