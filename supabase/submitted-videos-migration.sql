-- ============================================
-- Submitted Ad Videos Review - Migration
-- Run this in your Supabase SQL Editor.
--
-- Adds a lightweight "reviewed" marker to ad_drafts so the CEO can flag
-- which submitted ads they've already watched, plus indexes to keep the
-- Submitted Ad Videos review screen fast. Purely additive — no existing
-- columns or behavior change.
-- ============================================

-- Reviewed marker (admin marks a submission as reviewed)
alter table ad_drafts
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references employees(id) on delete set null;

-- Speeds up the review screen queries:
--   "submitted ads, newest first" and "submitted ads by a given marketer"
create index if not exists idx_ad_drafts_status_submitted_at
  on ad_drafts (status, submitted_at desc);

create index if not exists idx_ad_drafts_employee_status
  on ad_drafts (employee_id, status);
