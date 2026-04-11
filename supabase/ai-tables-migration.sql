-- ============================================
-- AI Generator Tables - Migration
-- Run this in your Supabase SQL Editor
-- ============================================

-- Per-store knowledge documents (8 types per store)
create table ai_store_docs (
  id uuid primary key default uuid_generate_v4(),
  store_name text not null,
  doc_type text not null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_name, doc_type)
);

create index idx_ai_store_docs_store on ai_store_docs(store_name);

alter table ai_store_docs enable row level security;

-- Admin + marketing can read
create policy "ai_store_docs_select" on ai_store_docs
  for select using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role in ('admin', 'marketing'))
  );

-- Admin can write
create policy "ai_store_docs_insert" on ai_store_docs
  for insert with check (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "ai_store_docs_update" on ai_store_docs
  for update using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "ai_store_docs_delete" on ai_store_docs
  for delete using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create trigger ai_store_docs_updated_at
  before update on ai_store_docs
  for each row execute function update_updated_at();

-- Generation history
create table ai_generations (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid references employees(id) on delete cascade,
  store_name text not null,
  tool_type text not null,
  input_data jsonb not null default '{}'::jsonb,
  output_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_ai_generations_employee on ai_generations(employee_id);
create index idx_ai_generations_store on ai_generations(store_name);

alter table ai_generations enable row level security;

-- Users can read their own + admin can read all
create policy "ai_generations_select" on ai_generations
  for select using (
    employee_id in (select id from employees where auth_id = auth.uid())
    or exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

create policy "ai_generations_insert" on ai_generations
  for insert with check (
    employee_id in (select id from employees where auth_id = auth.uid())
  );
