-- ============================================
-- AI Comparative Analyses Migration
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Adds:
--   ad_comparative_analyses — cached Claude Opus strategic reports across
--   multiple selected ads. Consumes existing ad_creative_analyses rows +
--   per-day FB metrics + per-store ai_store_docs to produce a single
--   structured strategy doc (consistency tiers, winner/loser DNA,
--   avatar-level diagnosis, next-creative test matrix).
-- ============================================

create table if not exists ad_comparative_analyses (
  id uuid primary key default gen_random_uuid(),

  -- Selection scope. ad_ids is sorted + joined to produce ad_ids_hash
  -- (sha256 hex) so the same selection + same date_preset dedupes.
  ad_ids text[] not null,
  ad_ids_hash text not null,
  account_ids text[] not null,
  store_name text,
  date_preset text not null,

  -- Shape of analysis jsonb:
  --   {
  --     summary: string,                      -- 1-2 sentence headline
  --     tiers: {
  --       stable_winner: [{ ad_id, reason }],
  --       spike:         [{ ad_id, reason }],
  --       stable_loser:  [{ ad_id, reason }],
  --       dead:          [{ ad_id, reason }]
  --     },
  --     winner_dna: {
  --       hook_patterns: string[],
  --       scene_beats: string[],
  --       tone: string,
  --       cta_patterns: string[],
  --       visual_style: string,
  --       pacing_notes: string
  --     },
  --     loser_dna: { ... same shape ... },
  --     avatar_diagnosis: {
  --       avatar_fit_score: number,           -- 0-100
  --       misses: string[],                   -- which avatar truths weren't hit
  --       mechanism_gaps: string[],           -- market-sophistication misalignments
  --       evidence: [{ ad_id, timestamp, note }]
  --     },
  --     next_creatives: [
  --       {
  --         title: string,
  --         hook: string,                     -- 0-3s hook copy
  --         scene_beats: string[],            -- scene-by-scene plan
  --         cta: string,
  --         hypothesis: string,               -- why this should convert
  --         replaces_ad_id: string | null,
  --         angle: string                     -- one of the 6 classic angles
  --       }
  --     ],
  --     avoid_list: string[]
  --   }
  analysis jsonb not null,

  -- Raw inputs snapshot so we can re-render without re-fetching
  --   { ads: [{ ad_id, ad_name, metrics_total, daily: [{date, spend, purchases, cpp, atc, clicks, impressions}], deconstruction: {...} }], store_docs_snapshot: {...} }
  inputs_snapshot jsonb,

  analyzed_by uuid references employees(id) on delete set null,
  model text,
  tokens_used int,
  cost_usd numeric(8,4),
  created_at timestamptz not null default now()
);

create index if not exists ad_comparative_analyses_hash_idx
  on ad_comparative_analyses (ad_ids_hash, date_preset, created_at desc);
create index if not exists ad_comparative_analyses_store_idx
  on ad_comparative_analyses (store_name, created_at desc);
create index if not exists ad_comparative_analyses_analyzed_by_idx
  on ad_comparative_analyses (analyzed_by, created_at desc);

alter table ad_comparative_analyses enable row level security;

drop policy if exists "ad_comparative_analyses_marketing_all" on ad_comparative_analyses;
create policy "ad_comparative_analyses_marketing_all" on ad_comparative_analyses
  for all using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
