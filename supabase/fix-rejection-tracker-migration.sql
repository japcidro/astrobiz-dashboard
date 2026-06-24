-- ============================================
-- Fix Rejections — turn the auto-pause table into a unified "Fixed ads"
-- tracker for BOTH normal and scaling fixes.
--
-- Two changes ship together (see route.ts):
--   1. LIFETIME BUDGET: every fix (not just scaling ones) is now registered
--      here, so the cron pauses the ad once its TOTAL post-fix spend reaches
--      the ₱ threshold. The old behaviour set a *daily* budget that reset
--      each day and kept spending — this makes the ₱ value a true lifetime cap.
--   2. TRACKING: we store the ORIGINAL ad name / account / campaign / image at
--      fix time. After the creative is swapped to a safe (animal) image the ad
--      no longer looks like itself and drops off the DISAPPROVED list — these
--      columns let the page show a persistent "Fixed ads" tracker so nothing
--      gets lost.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================

alter table public.fix_rejection_autopause
  add column if not exists ad_name text,
  add column if not exists account_name text,
  add column if not exists campaign_name text,
  add column if not exists adset_name text,
  add column if not exists safe_image_name text,
  add column if not exists is_scaling boolean not null default false,
  add column if not exists engagement_applied boolean not null default false,
  add column if not exists engagement_days integer;
