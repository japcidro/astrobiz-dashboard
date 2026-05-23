-- ============================================
-- Creative Generator v2 ROLLBACK — removes the brand_*  surface
--
-- Drops the per-brand reference files + system prompts feature entirely.
-- The user opted to keep using Claude Max for actual script generation
-- and use the dashboard only for the Approved Library + creative linking
-- + performance tracking (those tables are NOT touched here).
--
-- Run this in your Supabase SQL Editor if reproducing the rollback on a
-- fresh environment. Idempotent.
--
-- Storage: the `brand-files` bucket must be emptied + deleted via the
-- Storage REST API (Supabase blocks direct deletion from storage.buckets
-- via SQL). See Settings → Storage in the dashboard if reproducing.
-- ============================================

drop policy if exists "brand_system_prompts_manage" on public.brand_system_prompts;
drop policy if exists "brand_reference_files_manage" on public.brand_reference_files;

drop policy if exists "brand_files_storage_insert" on storage.objects;
drop policy if exists "brand_files_storage_read" on storage.objects;
drop policy if exists "brand_files_storage_delete" on storage.objects;

drop table if exists public.brand_reference_files;
drop table if exists public.brand_system_prompts;
