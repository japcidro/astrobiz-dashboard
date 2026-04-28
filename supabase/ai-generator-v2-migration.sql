-- ============================================
-- AI Generator v2.0 Migration
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Wires the Angle Generator + Script Creator + Format Expansion to share
-- the Winning DNA vocabulary already used by the Creative Deconstructor v2.0.
-- Adds typed classification on approved_scripts, performance feedback,
-- expand-from-winner provenance, and an auto-managed-doc metadata column.
-- ============================================

-- 1. approved_scripts — v2.0 classification + performance feedback loop
alter table approved_scripts
  add column if not exists awareness_level text
    check (awareness_level is null or awareness_level in ('L1','L2','L3','L4','L5')),
  add column if not exists funnel_stage text
    check (funnel_stage is null or funnel_stage in ('TOFU','MOFU','BOFU')),
  add column if not exists hook_framework text,
  add column if not exists strategic_format text,
  add column if not exists video_format text,
  add column if not exists big_idea text,
  add column if not exists variable_shifts jsonb not null default '[]'::jsonb,
  add column if not exists source_winner_ad_id text,
  add column if not exists source_winner_analysis_id uuid
    references ad_creative_analyses(id) on delete set null,
  add column if not exists performance_status text not null default 'pending'
    check (performance_status in ('pending','testing','validated_winner','validated_loser')),
  add column if not exists performance_validated_at timestamptz,
  add column if not exists performance_metrics jsonb;

create index if not exists idx_approved_scripts_perf
  on approved_scripts(performance_status);
create index if not exists idx_approved_scripts_hook_fw
  on approved_scripts(hook_framework);
create index if not exists idx_approved_scripts_source_winner
  on approved_scripts(source_winner_analysis_id);

-- 2. ai_generations — track threads seeded from a winner deconstruction
alter table ai_generations
  add column if not exists source_winner_analysis_id uuid
    references ad_creative_analyses(id) on delete set null,
  add column if not exists structured_output jsonb;

create index if not exists idx_ai_generations_source_winner
  on ai_generations(source_winner_analysis_id);

-- 3. ai_store_docs — metadata for distinguishing user-edited from auto-managed docs
alter table ai_store_docs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- 4. RLS — auto-managed docs (validated_winners_dna) can be written by service-role
--    only via the cron, but admins can override (clear auto_managed flag and edit).
--    Existing ai_store_docs policies cover SELECT for admin+marketing and
--    INSERT/UPDATE/DELETE for admin only — those policies remain in force.
--    No new policies required; the cron uses createServiceClient() which
--    bypasses RLS by design.

-- 5. Sanity: backfill performance_status for any rows that somehow have NULL
--    (shouldn't happen with the not null default above, but defensive).
update approved_scripts
   set performance_status = 'pending'
 where performance_status is null;
