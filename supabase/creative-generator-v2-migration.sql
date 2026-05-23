-- ============================================
-- Creative Generator v2 — Claude Project-style per-brand schema
--
-- 1. Archive existing ai_store_docs into ai_store_docs_archive_2026_05
-- 2. Create brand_system_prompts (1 row per store)
-- 3. Create brand_reference_files (many rows per store, with extracted_text)
-- 4. Create private storage bucket `brand-files` with admin/marketing RLS
-- 5. Drop ai_store_docs (data is safe in the archive table)
--
-- Idempotent: re-running is safe. Archive is created only if missing.
-- ============================================

-- ============================================================
-- 1. ARCHIVE ai_store_docs (preserves the prior knowledge-base data)
-- ============================================================
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'ai_store_docs')
     and not exists (select 1 from information_schema.tables
                     where table_schema = 'public' and table_name = 'ai_store_docs_archive_2026_05')
  then
    execute 'create table public.ai_store_docs_archive_2026_05 as select * from public.ai_store_docs';
    execute 'alter table public.ai_store_docs_archive_2026_05 add primary key (id)';
  end if;
end $$;

-- ============================================================
-- 2. brand_system_prompts — one row per store
-- ============================================================
create table if not exists public.brand_system_prompts (
  id uuid primary key default gen_random_uuid(),
  store_name text not null unique,
  system_prompt text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null
);

create index if not exists brand_system_prompts_store_idx
  on public.brand_system_prompts (store_name);

alter table public.brand_system_prompts enable row level security;

drop policy if exists "brand_system_prompts_manage" on public.brand_system_prompts;
create policy "brand_system_prompts_manage"
  on public.brand_system_prompts for all
  using (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  )
  with check (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );

-- ============================================================
-- 3. brand_reference_files — many rows per store
-- ============================================================
create table if not exists public.brand_reference_files (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  title text not null,
  category text not null check (category in (
    'winning_scripts',
    'brand_voice',
    'product_info',
    'customer_reviews',
    'other'
  )),
  file_url text,
  file_name text,
  file_type text,
  extracted_text text not null default '',
  file_size_bytes integer,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists brand_reference_files_store_idx
  on public.brand_reference_files (store_name, created_at desc);
create index if not exists brand_reference_files_category_idx
  on public.brand_reference_files (store_name, category);

alter table public.brand_reference_files enable row level security;

drop policy if exists "brand_reference_files_manage" on public.brand_reference_files;
create policy "brand_reference_files_manage"
  on public.brand_reference_files for all
  using (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  )
  with check (
    exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );

-- ============================================================
-- 4. STORAGE — private bucket `brand-files`
--    Files are listed by signed/authenticated URL only; not public.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('brand-files', 'brand-files', false)
on conflict (id) do nothing;

drop policy if exists "brand_files_storage_insert" on storage.objects;
create policy "brand_files_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand-files'
    and exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );

drop policy if exists "brand_files_storage_read" on storage.objects;
create policy "brand_files_storage_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'brand-files'
    and exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );

drop policy if exists "brand_files_storage_delete" on storage.objects;
create policy "brand_files_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'brand-files'
    and exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );

-- ============================================================
-- 5. DROP legacy ai_store_docs (archive is in ai_store_docs_archive_2026_05)
-- ============================================================
drop trigger if exists ai_store_docs_updated_at on public.ai_store_docs;
drop policy if exists "ai_store_docs_select" on public.ai_store_docs;
drop policy if exists "ai_store_docs_insert" on public.ai_store_docs;
drop policy if exists "ai_store_docs_update" on public.ai_store_docs;
drop policy if exists "ai_store_docs_delete" on public.ai_store_docs;
drop table if exists public.ai_store_docs;
