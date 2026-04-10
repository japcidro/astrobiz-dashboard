-- ============================================
-- Shopify Stores - Add OAuth columns
-- Run this in your Supabase SQL Editor
-- ============================================

-- Add OAuth credential columns
alter table shopify_stores add column if not exists client_id text;
alter table shopify_stores add column if not exists client_secret text;

-- Make api_token nullable (will be filled by OAuth callback)
alter table shopify_stores alter column api_token drop not null;
