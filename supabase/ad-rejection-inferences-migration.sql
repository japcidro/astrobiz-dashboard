-- ============================================
-- ad_rejection_inferences — cache table for the AI inference of
-- which specific lines in a disapproved ad's transcript triggered
-- Meta's rejection. Avoids re-billing Claude when the same marketer
-- (or another) reopens the Why? modal on the same ad.
--
-- Cache key: (ad_id, transcript_hash, policies_hash)
--   ad_id           — the FB ad whose disapproval is being explained
--   transcript_hash — sha256 of the Gemini transcript text. Changes
--                     when the ad is re-transcribed, so a re-deconstruct
--                     forces a fresh inference (correct behavior).
--   policies_hash   — sha256 of the policy categories returned by FB.
--                     Changes when Meta re-reviews and updates the
--                     reason, so a category change forces re-inference
--                     against the new category (correct behavior).
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

create table if not exists public.ad_rejection_inferences (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,
  transcript_hash text not null,
  policies_hash text not null,
  markdown text not null,
  model text,
  tokens_used jsonb,
  employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ad_id, transcript_hash, policies_hash)
);

create index if not exists ad_rejection_inferences_ad_idx
  on public.ad_rejection_inferences (ad_id, created_at desc);

alter table public.ad_rejection_inferences enable row level security;

drop policy if exists "ad_rejection_inferences_manage"
  on public.ad_rejection_inferences;
create policy "ad_rejection_inferences_manage"
  on public.ad_rejection_inferences for all
  using (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  )
  with check (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );
