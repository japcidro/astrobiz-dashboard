-- ============================================
-- Briefings — resilience columns
--
-- Stops the silent-zero problem: whenever a cron fired during an FB
-- rate-limit or Shopify cold-start window, safeFetch returned null
-- and we happily saved revenue=0/orders=0/ad_spend=0. The dashboard
-- and the morning email then showed "tubol" data, indistinguishable
-- from a genuine zero-activity day.
--
-- After this migration:
--   - Every safeFetch failure is logged into fetch_errors
--   - retry_count + last_retry_at let a 30-min cron rebuild any row
--     where fetch_errors is non-empty OR data looks dead-zero, until
--     it succeeds or hits max attempts
--   - Email is gated on a clean (errors-empty) success, so admins
--     don't get a wrong-zero email at 6 AM and the corrected one
--     30 min later
--
-- Idempotent. Run in Supabase SQL Editor.
-- ============================================

alter table briefings
  add column if not exists fetch_errors jsonb not null default '[]'::jsonb,
  add column if not exists retry_count int not null default 0,
  add column if not exists last_retry_at timestamptz;

-- Speeds up the retry cron's candidate scan.
create index if not exists briefings_retry_candidate_idx
  on briefings (created_at desc)
  where retry_count < 5;
