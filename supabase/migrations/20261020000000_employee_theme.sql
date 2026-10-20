-- Each employee picks a dashboard theme from the sidebar (Appearance). The
-- cookie carries it for the first paint; this column carries it to their
-- next device. The five names match src/lib/theme.ts.

alter table public.employees
  add column if not exists theme text not null default 'night';

alter table public.employees
  drop constraint if exists employees_theme_check;

alter table public.employees
  add constraint employees_theme_check
  check (theme in ('night', 'ledger', 'control', 'studio', 'forest'));
