-- ============================================
-- ilp_deconstructions — ILP-native ad deconstruction reports
--
-- Separate from ad_creative_analyses (which is video-driven via the
-- existing Gemini cron). This table holds paste-text deconstructions
-- produced by the ILP v2.0 engine (8-zone output, judgment + compliance
-- audits). The two pipelines do not overlap.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

create table if not exists public.ilp_deconstructions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  source_text text not null,
  source_text_hash text not null,
  ad_origin text,           -- ILP_REFERENCE / ILP_DRAFT / COMPETITOR / OTHER
  ad_title text,            -- extracted from Zone A
  zones jsonb not null,     -- { A, B, C, D, E, F, G, H } with structured fields
  compliance_flags_count integer not null default 0,
  model text,
  tokens_used jsonb,
  cost_usd numeric,
  created_at timestamptz not null default now()
);

create index if not exists ilp_deconstructions_created_idx
  on public.ilp_deconstructions (created_at desc);

create index if not exists ilp_deconstructions_employee_idx
  on public.ilp_deconstructions (employee_id, created_at desc);

create index if not exists ilp_deconstructions_hash_idx
  on public.ilp_deconstructions (source_text_hash);

alter table public.ilp_deconstructions enable row level security;

drop policy if exists "ilp_deconstructions_manage" on public.ilp_deconstructions;
create policy "ilp_deconstructions_manage"
  on public.ilp_deconstructions for all
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
