-- ============================================
-- Shopify Stores RLS — Marketing SELECT fix
-- ============================================
-- Problem: shopify-stores-migration.sql added SELECT policies for admin,
-- va, and fulfillment — but NOT for marketing. The API route allows
-- marketing to call /api/shopify/stores, but RLS silently filters out
-- every row, so the marketing team sees an empty store list. This breaks
-- AI Generator (store dropdown empty → Approved Library spins forever),
-- Deconstruction Panel, and Knowledge Manager for marketing users.
--
-- Run in Supabase SQL Editor.
-- ============================================

drop policy if exists "shopify_stores_marketing_select" on shopify_stores;

create policy "shopify_stores_marketing_select" on shopify_stores
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'marketing'
    )
  );
