-- ============================================
-- Fix Rejections — tables backing the "Fix Rejections" tab.
--
-- The tab clears DISAPPROVED ads the way the courses teach: swap the
-- rejected creative/copy/headline for a benign "safe" image (a cat,
-- etc.), set the same ad back to ACTIVE so Meta re-reviews it, and run
-- a cheap ₱50/2-day engagement burst on its existing ad set
-- (Option A — same ad ID, no new campaign).
--
-- Two tables:
--   fix_rejection_safe_images — the reusable safe-image library. FB
--     image hashes are SCOPED PER AD ACCOUNT, so we store the public
--     source URL once and cache the per-account hash in account_hashes
--     as { "act_123": "hash", ... }. Fixing an ad in a new account
--     re-uploads by URL and appends the freshly minted hash.
--   fix_rejection_actions — audit log of every fix attempt so the CEO
--     has a record of what was changed on which ad and by whom.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================

-- ── Safe-image library ─────────────────────
create table if not exists public.fix_rejection_safe_images (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Public image URL (FB CDN url returned at upload time). Re-uploaded
  -- per ad account via /{account}/adimages?url= to mint a usable hash.
  source_url text not null,
  -- Cache of per-account image hashes: { "act_123": "abc...", ... }
  account_hashes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists fix_rejection_safe_images_active_idx
  on public.fix_rejection_safe_images (active, created_at desc);

-- ── Fix audit log ──────────────────────────
create table if not exists public.fix_rejection_actions (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,
  ad_account_id text,
  adset_id text,
  old_creative_id text,
  new_creative_id text,
  safe_image_id uuid references public.fix_rejection_safe_images(id) on delete set null,
  headline text,
  primary_text text,
  description text,
  cta text,
  engagement_budget numeric,   -- daily budget set on the ad set, in PHP
  engagement_days integer,
  engagement_applied boolean not null default false,
  -- 'success' = creative swapped + re-review triggered
  -- 'partial' = swapped but engagement burst could not be applied
  -- 'failed'  = swap itself failed (rejection NOT cleared)
  status text not null,
  error_message text,
  actor_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists fix_rejection_actions_ad_idx
  on public.fix_rejection_actions (ad_id, created_at desc);

-- ── RLS — admin + marketing only ───────────
alter table public.fix_rejection_safe_images enable row level security;
alter table public.fix_rejection_actions enable row level security;

drop policy if exists "fix_rejection_safe_images_manage"
  on public.fix_rejection_safe_images;
create policy "fix_rejection_safe_images_manage"
  on public.fix_rejection_safe_images for all
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

drop policy if exists "fix_rejection_actions_manage"
  on public.fix_rejection_actions;
create policy "fix_rejection_actions_manage"
  on public.fix_rejection_actions for all
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
