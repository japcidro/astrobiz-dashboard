-- ============================================
-- autopilot_actions: track manual ad pauses too
--
-- Adds actor_id so manual toggles from /api/facebook/manage can be logged
-- in the same table alongside autopilot actions. NULL for autopilot rows
-- (rule_matched is the source of truth there).
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

alter table public.autopilot_actions
  add column if not exists actor_id uuid references public.employees(id) on delete set null;

create index if not exists autopilot_actions_ad_id_created_idx
  on public.autopilot_actions (ad_id, created_at desc);
