-- ============================================
-- Fix Rejections — AI-generated copy on safe images.
--
-- When a safe image is uploaded, Claude (vision) reads it and writes
-- engagement-focused, benign copy once. The copy is cached on the row
-- and reused for every fix that uses this image, so we pay the vision
-- call once per image, not once per fixed ad.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

alter table public.fix_rejection_safe_images
  add column if not exists ai_headline text,
  add column if not exists ai_primary_text text,
  add column if not exists ai_description text,
  add column if not exists ai_cta text,
  add column if not exists ai_model text,
  add column if not exists ai_generated_at timestamptz;
