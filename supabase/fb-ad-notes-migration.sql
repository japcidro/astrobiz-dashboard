-- ============================================
-- Facebook Ad Notes - Migration
-- Run this in your Supabase SQL Editor.
--
-- One note/comment per submitted ad (keyed by the Facebook ad id) so the CEO
-- can leave feedback on a marketer's creative. Admin writes; admin + the
-- marketing team can read (so marketers see feedback on their ads). Purely
-- additive.
-- ============================================

create table if not exists fb_ad_notes (
  fb_ad_id text primary key,
  note text not null default '',
  updated_by uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table fb_ad_notes enable row level security;

create policy "fb_ad_notes_select" on fb_ad_notes
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

-- Only admin can write notes (the CEO's feedback on a creative).
create policy "fb_ad_notes_admin_write" on fb_ad_notes
  for all using (
    exists (
      select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin'
    )
  );

create trigger fb_ad_notes_updated_at
  before update on fb_ad_notes
  for each row execute function update_updated_at();
