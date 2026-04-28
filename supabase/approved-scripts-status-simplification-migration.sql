-- ============================================
-- Approved Scripts — Status Simplification
-- Collapses 5 statuses → 4: approved | in_progress | submitted | archived
--
-- Mapping:
--   approved       → approved
--   in_production  → in_progress  (combined with 'shot')
--   shot           → in_progress
--   live           → submitted
--   archived       → archived
--
-- Also retargets the auto-flip trigger so that linking a live FB ad to a
-- script flips it straight to 'submitted' (was 'in_production').
--
-- Run in Supabase SQL Editor on an existing database.
-- ============================================

-- 1. Tear down trigger + function that reference the old enum values.
--    (Function body holds enum oids at parse time, so it must be dropped
--    before the enum is replaced.)
drop trigger if exists trg_auto_flip_script_status on ad_approved_script_links;
drop function if exists auto_flip_script_to_in_production();

-- 2. Build the new enum alongside the old one.
create type approved_script_status_v2 as enum (
  'approved',
  'in_progress',
  'submitted',
  'archived'
);

-- 3. Swap the column over, mapping legacy values into the new shape.
alter table approved_scripts alter column status drop default;

alter table approved_scripts
  alter column status type approved_script_status_v2
  using (
    case status::text
      when 'approved'      then 'approved'
      when 'in_production' then 'in_progress'
      when 'shot'          then 'in_progress'
      when 'live'          then 'submitted'
      when 'archived'      then 'archived'
      else 'approved'
    end
  )::approved_script_status_v2;

alter table approved_scripts alter column status set default 'approved';

-- 4. Drop the old enum and rename the new one back to the canonical name.
drop type approved_script_status;
alter type approved_script_status_v2 rename to approved_script_status;

-- 5. Recreate the auto-flip trigger pointing at 'submitted'.
--    Flips from either 'approved' or 'in_progress' — i.e. anything that
--    hasn't been marked submitted/archived yet. Linking a live ad means
--    by definition the script has shipped on Meta.
create or replace function auto_flip_script_to_submitted()
returns trigger as $$
begin
  update approved_scripts
     set status = 'submitted',
         updated_at = now()
   where id = new.approved_script_id
     and status in ('approved', 'in_progress');
  return new;
end;
$$ language plpgsql;

create trigger trg_auto_flip_script_status
  after insert on ad_approved_script_links
  for each row execute function auto_flip_script_to_submitted();
