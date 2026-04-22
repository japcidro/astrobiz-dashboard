-- ============================================
-- Tasks — lightweight todo list per employee
-- with admin → employee cross-assignment
-- Run this in your Supabase SQL Editor
-- ============================================

create type task_status as enum (
  'pending',
  'in_progress',
  'done',
  'cancelled'
);

create type task_priority as enum ('low', 'med', 'high');

create table tasks (
  id uuid primary key default uuid_generate_v4(),

  title text not null,
  description text,

  status task_status not null default 'pending',
  priority task_priority not null default 'med',

  due_date date,

  -- Who typed the task
  created_by uuid not null references employees(id) on delete restrict,
  -- Who must do it (can be same as created_by for self-tasks)
  assigned_to uuid not null references employees(id) on delete cascade,

  -- Optional deep-link to a dashboard page (e.g. /marketing/ads?ad_id=...)
  link_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_tasks_assigned_to on tasks(assigned_to);
create index idx_tasks_created_by on tasks(created_by);
create index idx_tasks_status on tasks(status);
create index idx_tasks_due_date on tasks(due_date);

alter table tasks enable row level security;

-- SELECT:
--   - admin sees all
--   - everyone else sees tasks assigned to them OR created by them
create policy "tasks_select" on tasks
  for select using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
    or assigned_to in (select id from employees where auth_id = auth.uid())
    or created_by in (select id from employees where auth_id = auth.uid())
  );

-- INSERT:
--   - admin can assign tasks to anyone (any assigned_to)
--   - non-admin can only self-assign (assigned_to must equal created_by)
--   - created_by must be the inserting user
create policy "tasks_insert" on tasks
  for insert with check (
    created_by in (select id from employees where auth_id = auth.uid())
    and (
      exists (
        select 1 from employees e
        where e.auth_id = auth.uid() and e.role = 'admin'
      )
      or assigned_to = created_by
    )
  );

-- UPDATE:
--   - admin can update any task
--   - creator can update tasks they created
--   - assignee can update status/completed_at of tasks assigned to them
create policy "tasks_update" on tasks
  for update using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
    or created_by in (select id from employees where auth_id = auth.uid())
    or assigned_to in (select id from employees where auth_id = auth.uid())
  );

-- DELETE:
--   - admin can delete anything
--   - creator can delete tasks they created
--   - assignee CANNOT delete (they should mark cancelled instead)
create policy "tasks_delete" on tasks
  for delete using (
    exists (
      select 1 from employees e
      where e.auth_id = auth.uid() and e.role = 'admin'
    )
    or created_by in (select id from employees where auth_id = auth.uid())
  );

create trigger tasks_updated_at
  before update on tasks
  for each row execute function update_updated_at();

-- Auto-stamp completed_at when status transitions to 'done'
create or replace function set_task_completed_at()
returns trigger as $$
begin
  if new.status = 'done' and (old.status is null or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_set_completed_at
  before insert or update of status on tasks
  for each row execute function set_task_completed_at();
