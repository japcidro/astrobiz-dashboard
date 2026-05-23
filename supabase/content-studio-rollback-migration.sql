-- ============================================
-- Content Studio ROLLBACK — drop all Content Studio resources
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Removes:
--   * Tables: moodboard_images, product_photos, generated_images, saved_images
--   * Storage bucket: content-studio (including all objects)
--   * RLS policies on those tables and storage.objects
--   * Column: shopify_stores.prompt_modifier (added by content-studio-migration.sql)
-- ============================================

-- ============================================================
-- DROP STORAGE POLICIES
-- (The `content-studio` bucket itself must be deleted via the Storage
--  REST API or the Supabase dashboard — Supabase blocks direct DELETE
--  from storage.buckets via SQL by design.)
-- ============================================================
drop policy if exists "content_studio_storage_insert" on storage.objects;
drop policy if exists "content_studio_storage_read" on storage.objects;
drop policy if exists "content_studio_storage_update" on storage.objects;
drop policy if exists "content_studio_storage_delete" on storage.objects;

-- ============================================================
-- DROP TABLE POLICIES (defensive — table drop also removes them)
-- ============================================================
drop policy if exists "content_studio_moodboard_manage" on public.moodboard_images;
drop policy if exists "content_studio_product_photos_manage" on public.product_photos;
drop policy if exists "content_studio_generated_manage" on public.generated_images;
drop policy if exists "content_studio_saved_manage" on public.saved_images;

-- ============================================================
-- DROP TABLES (cascades indexes and constraints)
-- ============================================================
drop table if exists public.moodboard_images;
drop table if exists public.product_photos;
drop table if exists public.generated_images;
drop table if exists public.saved_images;

-- ============================================================
-- DROP shopify_stores.prompt_modifier column
-- (Was added exclusively for Content Studio per-store prompt prefixing)
-- ============================================================
alter table public.shopify_stores
  drop column if exists prompt_modifier;
