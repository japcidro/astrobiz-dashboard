-- ============================================
-- Attendance improvements — week-varying shifts + reminders
-- Run this in Supabase SQL Editor. Idempotent.
-- ============================================

-- ---------- Per-day shift schedule ----------
-- Admins set shifts per-employee per-date (since schedules vary weekly).
-- A row marks either a working shift (start_time + end_time) or an off day.
create table if not exists employee_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  shift_date date not null,
  start_time time,              -- nullable when is_off_day = true
  end_time time,                -- nullable when is_off_day = true
  break_minutes int not null default 60,
  is_off_day boolean not null default false,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, shift_date)
);

create index if not exists employee_shifts_date_idx
  on employee_shifts (shift_date);
create index if not exists employee_shifts_employee_date_idx
  on employee_shifts (employee_id, shift_date desc);

alter table employee_shifts enable row level security;

drop policy if exists "employee_shifts_admin_all" on employee_shifts;
create policy "employee_shifts_admin_all" on employee_shifts
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "employee_shifts_self_select" on employee_shifts;
create policy "employee_shifts_self_select" on employee_shifts
  for select using (
    employee_id in (select id from employees where auth_id = auth.uid())
  );

drop trigger if exists employee_shifts_updated_at on employee_shifts;
create trigger employee_shifts_updated_at
  before update on employee_shifts
  for each row execute function update_updated_at();

-- ---------- Employee notifications (non-admin, per-person) ----------
-- Separate from admin_alerts since employees only see their own.
create table if not exists employee_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  type text not null,                   -- 'clockin_reminder' | 'break_reminder' | 'clockout_reminder' | 'forgot_clockout'
  severity text not null default 'info' check (severity in ('urgent', 'action', 'info')),
  title text not null,
  body text,
  action_url text,
  payload jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  emailed_at timestamptz,
  email_error text
);

create index if not exists employee_notifications_employee_unread_idx
  on employee_notifications (employee_id, created_at desc)
  where read_at is null and dismissed_at is null;

create index if not exists employee_notifications_dedup_idx
  on employee_notifications (employee_id, type, created_at desc);

alter table employee_notifications enable row level security;

drop policy if exists "employee_notifications_self" on employee_notifications;
create policy "employee_notifications_self" on employee_notifications
  for all using (
    employee_id in (select id from employees where auth_id = auth.uid())
  );

drop policy if exists "employee_notifications_admin" on employee_notifications;
create policy "employee_notifications_admin" on employee_notifications
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

-- ---------- Attendance events log (auto-close, auto-pause) ----------
create table if not exists attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  time_entry_id uuid references time_entries(id) on delete set null,
  event_type text not null,             -- 'auto_closed' | 'reminder_sent' | 'anomaly_detected'
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_events_employee_idx
  on attendance_events (employee_id, created_at desc);
create index if not exists attendance_events_type_idx
  on attendance_events (event_type, created_at desc);

alter table attendance_events enable row level security;

drop policy if exists "attendance_events_admin" on attendance_events;
create policy "attendance_events_admin" on attendance_events
  for all using (
    exists (select 1 from employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "attendance_events_self_select" on attendance_events;
create policy "attendance_events_self_select" on attendance_events
  for select using (
    employee_id in (select id from employees where auth_id = auth.uid())
  );

-- ---------- Helper: dedup insert for employee notifications ----------
create or replace function insert_employee_notification(
  p_employee_id uuid,
  p_type text,
  p_severity text,
  p_title text,
  p_body text,
  p_action_url text,
  p_payload jsonb,
  p_dedup_minutes int default 60
) returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  select id into v_existing
  from employee_notifications
  where employee_id = p_employee_id
    and type = p_type
    and created_at > now() - (p_dedup_minutes || ' minutes')::interval
  limit 1;

  if v_existing is not null then
    return null;
  end if;

  insert into employee_notifications (
    employee_id, type, severity, title, body, action_url, payload
  ) values (
    p_employee_id, p_type, p_severity, p_title, p_body, p_action_url, p_payload
  )
  returning id into v_id;

  return v_id;
end;
$$;
