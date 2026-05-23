-- ============================================
-- Approved Library + script-linking ROLLBACK
--
-- Removes the entire manual script-linking surface from the database
-- after the UI + routes + libs were deleted in commits 2174b25, 2ea0127,
-- and 00bf9fe. The deconstructor pipeline (ad_creative_analyses) is
-- untouched — that table remains the engine of the closed loop.
--
-- Run in Supabase SQL Editor. Idempotent: re-running is safe. Archive
-- tables are created only if they don't already exist.
-- ============================================

-- ============================================================
-- 1. ARCHIVE — preserve the 52 approved_scripts and 16 creative links
--    in case the user wants to recover them later.
-- ============================================================
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'approved_scripts')
     and not exists (select 1 from information_schema.tables
                     where table_schema = 'public'
                       and table_name = 'approved_scripts_archive_2026_05')
  then
    execute 'create table public.approved_scripts_archive_2026_05 as select * from public.approved_scripts';
    execute 'alter table public.approved_scripts_archive_2026_05 add primary key (id)';
  end if;

  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'approved_script_creatives')
     and not exists (select 1 from information_schema.tables
                     where table_schema = 'public'
                       and table_name = 'approved_script_creatives_archive_2026_05')
  then
    execute 'create table public.approved_script_creatives_archive_2026_05 as select * from public.approved_script_creatives';
    execute 'alter table public.approved_script_creatives_archive_2026_05 add primary key (id)';
  end if;
end $$;

-- ============================================================
-- 2. DROP RLS POLICIES on the soon-to-be-dropped tables
--    (table drops would cascade anyway; this is defensive + explicit)
-- ============================================================
drop policy if exists "approved_scripts_select" on public.approved_scripts;
drop policy if exists "approved_scripts_insert" on public.approved_scripts;
drop policy if exists "approved_scripts_update" on public.approved_scripts;
drop policy if exists "approved_scripts_delete" on public.approved_scripts;

drop policy if exists "approved_script_creatives_select" on public.approved_script_creatives;
drop policy if exists "approved_script_creatives_insert" on public.approved_script_creatives;
drop policy if exists "approved_script_creatives_update" on public.approved_script_creatives;
drop policy if exists "approved_script_creatives_delete" on public.approved_script_creatives;

drop policy if exists "ad_approved_script_links_select" on public.ad_approved_script_links;
drop policy if exists "ad_approved_script_links_insert" on public.ad_approved_script_links;
drop policy if exists "ad_approved_script_links_update" on public.ad_approved_script_links;
drop policy if exists "ad_approved_script_links_delete" on public.ad_approved_script_links;

-- ============================================================
-- 3. DROP the FK constraint + column on ad_drafts.source_script_id.
--    The column referenced approved_scripts(id) — has to go BEFORE the
--    approved_scripts table itself drops.
-- ============================================================
alter table public.ad_drafts
  drop constraint if exists ad_drafts_source_script_id_fkey;
alter table public.ad_drafts
  drop column if exists source_script_id;

-- ============================================================
-- 4. DROP the three tables in dependency order:
--    children first (link tables), then approved_scripts.
-- ============================================================
drop table if exists public.ad_approved_script_links;
drop table if exists public.approved_script_creatives;
drop table if exists public.approved_scripts;
