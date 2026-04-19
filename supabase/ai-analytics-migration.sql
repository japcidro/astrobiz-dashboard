-- ============================================
-- AI Analytics — Phase 1 Migration
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Adds:
--   1) ad_creative_analyses  — cached Gemini video deconstructions (Phase 2)
--   2) RLS allowance for marketing role to read AI API keys in app_settings
--      (needed for chat + deconstruct endpoints to work for marketing users)
-- ============================================

-- 1. Cached video deconstructions (used in Phase 2, but schema lives here).
create table if not exists ad_creative_analyses (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,
  account_id text not null,
  creative_id text,
  video_id text,
  video_url text,
  thumbnail_url text,
  -- Shape of analysis jsonb:
  --   { transcript: string, hook: string, scenes: [{ t: "0:03", description: "..." }],
  --     visual_style: string, tone: string, cta: string }
  analysis jsonb not null,
  analyzed_by uuid references employees(id) on delete set null,
  trigger_source text not null default 'on_demand',
  model text,
  tokens_used int,
  cost_usd numeric(8,4),
  created_at timestamptz not null default now(),
  constraint ad_creative_analyses_trigger_chk
    check (trigger_source in ('on_demand', 'auto_daily'))
);

create unique index if not exists ad_creative_analyses_ad_id_idx
  on ad_creative_analyses (ad_id);
create index if not exists ad_creative_analyses_account_created_idx
  on ad_creative_analyses (account_id, created_at desc);

alter table ad_creative_analyses enable row level security;

drop policy if exists "ad_creative_analyses_marketing_all" on ad_creative_analyses;
create policy "ad_creative_analyses_marketing_all" on ad_creative_analyses
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

-- 2. Allow marketing role to read AI API keys in app_settings.
--    Previously marketing could only read fb_access_token + fb_selected_accounts,
--    which blocked the chat / generator endpoints from loading the Claude key
--    when a marketing user called them. Safe expansion — scoped to specific keys.
drop policy if exists "app_settings_marketing_select" on app_settings;
create policy "app_settings_marketing_select" on app_settings
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'marketing')
    and key in (
      'fb_access_token',
      'fb_selected_accounts',
      'anthropic_api_key',
      'gemini_api_key'
    )
  );
