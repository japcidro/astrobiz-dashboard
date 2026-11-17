-- Static Ad Generator, "create your own": a creative plan per page (brand),
-- written by the planner with no reference ad. Nothing renders until the
-- owner approves concepts; each approved concept becomes an image_studio_run
-- (preset 'own') whose id is written back into its concept.
--
-- Run with:  npm run db:run -- supabase/image-studio-own-plans-migration.sql

create table if not exists image_studio_plans (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  product text,
  brief text not null default '',
  diagnosis text not null default '',
  concepts jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists image_studio_plans_created_idx on image_studio_plans (created_at desc);

alter table image_studio_plans enable row level security;

drop trigger if exists image_studio_plans_touch on image_studio_plans;
create trigger image_studio_plans_touch before update on image_studio_plans
  for each row execute function hook_studio_touch();
