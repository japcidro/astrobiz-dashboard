-- Guides: short walkthroughs that run on a page (src/lib/guides). One row per
-- employee and guide: how far they got, when they finished, and whether they
-- turned down the first-visit offer. Guide ids live in code, not here.

create table if not exists public.guide_progress (
  employee_id uuid not null references public.employees(id) on delete cascade,
  guide_id text not null,
  last_step integer not null default 0,
  completed_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (employee_id, guide_id)
);

alter table public.guide_progress enable row level security;

-- Each employee reads and writes their own rows; admins can read everyone's
-- (who has finished what).
drop policy if exists "guide_progress_own" on public.guide_progress;
create policy "guide_progress_own" on public.guide_progress
  for all
  using (
    exists (select 1 from public.employees e where e.auth_id = auth.uid() and e.id = guide_progress.employee_id)
  )
  with check (
    exists (select 1 from public.employees e where e.auth_id = auth.uid() and e.id = guide_progress.employee_id)
  );

drop policy if exists "guide_progress_admin_read" on public.guide_progress;
create policy "guide_progress_admin_read" on public.guide_progress
  for select
  using (
    exists (select 1 from public.employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );
