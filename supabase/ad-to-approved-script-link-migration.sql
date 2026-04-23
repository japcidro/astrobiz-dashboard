-- ============================================
-- Live Ad ↔ Approved Script Link — Migration
-- Lets marketers manually tag a live Facebook ad as sourced from an
-- approved script, even when the ad wasn't created via the bulk-create
-- draft system. Backward-compat path for ads that already exist on FB.
--
-- One ad → one script. A script can be linked to many ads (split tests,
-- variant hooks all sharing one source script).
--
-- INSERT auto-flips the script's status from 'approved' → 'in_production'
-- (but doesn't downgrade 'shot' or 'live').
--
-- Run in Supabase SQL Editor.
-- ============================================

create table ad_approved_script_links (
  id uuid primary key default uuid_generate_v4(),

  -- Facebook native ad id (string, e.g. "120214567890123456").
  -- One link row per fb_ad_id — re-linking replaces the existing row.
  fb_ad_id text not null unique,

  -- Ad account this ad belongs to. Stored for filtering / display.
  fb_ad_account_id text not null,

  approved_script_id uuid not null
    references approved_scripts(id) on delete cascade,

  linked_by uuid references employees(id) on delete set null,
  linked_at timestamptz not null default now()
);

create index idx_ad_approved_script_links_script
  on ad_approved_script_links(approved_script_id);

create index idx_ad_approved_script_links_account
  on ad_approved_script_links(fb_ad_account_id);

-- Auto-flip script status to 'in_production' on first link.
-- Won't clobber later workflow states ('shot', 'live', 'archived').
create or replace function auto_flip_script_to_in_production()
returns trigger as $$
begin
  update approved_scripts
     set status = 'in_production',
         updated_at = now()
   where id = new.approved_script_id
     and status = 'approved';
  return new;
end;
$$ language plpgsql;

create trigger trg_auto_flip_script_status
  after insert on ad_approved_script_links
  for each row execute function auto_flip_script_to_in_production();

-- RLS — admin + marketing manage links; VA/fulfillment read-only.
alter table ad_approved_script_links enable row level security;

create policy "ad_approved_script_links_select" on ad_approved_script_links
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid()
        and e.role in ('admin', 'marketing', 'va', 'fulfillment')
    )
  );

create policy "ad_approved_script_links_insert" on ad_approved_script_links
  for insert with check (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "ad_approved_script_links_update" on ad_approved_script_links
  for update using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );

create policy "ad_approved_script_links_delete" on ad_approved_script_links
  for delete using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role in ('admin', 'marketing')
    )
  );
