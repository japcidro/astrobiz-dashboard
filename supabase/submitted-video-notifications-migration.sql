-- ============================================
-- Submitted-video email notifications — dedupe ledger.
--
-- Submitted ads are listed live from Facebook (no source table), so to email
-- the CEO only about NEW marketer submissions we record which fb_ad_ids we've
-- already notified about. The cron /api/cron/notify-submitted-videos inserts a
-- row per ad it emails; rows already present are skipped on the next run.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

create table if not exists public.submitted_video_notifications (
  fb_ad_id text primary key,
  ad_name text,
  marketer_name text,
  created_time timestamptz,
  notified_at timestamptz not null default now()
);

create index if not exists submitted_video_notifications_notified_idx
  on public.submitted_video_notifications (notified_at desc);

alter table public.submitted_video_notifications enable row level security;

drop policy if exists "submitted_video_notifications_admin_read"
  on public.submitted_video_notifications;
create policy "submitted_video_notifications_admin_read"
  on public.submitted_video_notifications for select
  using (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );
