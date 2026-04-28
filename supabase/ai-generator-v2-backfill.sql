-- ============================================
-- AI Generator v2.0 — One-Time Backfill
-- Run this in Supabase SQL Editor AFTER ai-generator-v2-migration.sql.
-- Idempotent — safe to re-run.
--
-- Hydrates approved_scripts.{awareness_level, funnel_stage, hook_framework,
-- strategic_format, video_format, source_winner_ad_id, source_winner_analysis_id}
-- from existing ad_creative_analyses rows that already classify the live
-- ad linked to that script via ad_drafts.source_script_id → ad_drafts.fb_ad_id.
--
-- Does NOT touch performance_status — only the auto-deconstruct-winners cron
-- promotes scripts to validated_winner. Scripts whose linked ads have a
-- v2.0 deconstruction will be ready for the cron to promote on its next run.
-- ============================================

with linked as (
  select
    s.id              as script_id,
    d.fb_ad_id,
    a.id              as analysis_id,
    a.analysis        as analysis
  from approved_scripts s
  join ad_drafts d
    on d.source_script_id = s.id
   and d.fb_ad_id is not null
  join ad_creative_analyses a
    on a.ad_id = d.fb_ad_id
  where (a.analysis ? 'classification')
    and (a.analysis ? 'viral_mechanism')
    -- Only fill scripts that don't already have classification
    and s.hook_framework is null
)
update approved_scripts s
   set awareness_level         = (l.analysis -> 'classification' ->> 'awareness_level'),
       funnel_stage             = (l.analysis -> 'classification' ->> 'funnel_stage'),
       hook_framework           = (l.analysis -> 'classification' ->> 'hook_framework'),
       strategic_format         = (l.analysis -> 'classification' ->> 'strategic_format'),
       video_format             = (l.analysis -> 'classification' ->> 'video_format'),
       source_winner_ad_id      = l.fb_ad_id,
       source_winner_analysis_id = l.analysis_id
  from linked l
 where s.id = l.script_id;

-- Report counts after backfill so the operator can verify.
select
  count(*) filter (where hook_framework is not null) as classified_scripts,
  count(*) filter (where performance_status = 'validated_winner') as validated_winners,
  count(*) as total_scripts
from approved_scripts;
