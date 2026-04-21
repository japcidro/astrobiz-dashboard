-- ============================================
-- Content Studio Module — image generation studio
-- Run this in your Supabase SQL Editor. Idempotent.
--
-- Scoped per Shopify store (store_name) so each brand/store
-- has its own moodboard, product photos, and generated library.
-- ============================================

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.moodboard_images (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  image_url text not null,
  label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.product_photos (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  product_name text not null,
  image_url text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  image_url text not null,
  prompt text,
  output_type text not null default 'feed_post',
  moodboard_ids uuid[] default '{}'::uuid[],
  product_photo_ids uuid[] default '{}'::uuid[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  rating smallint,
  feedback_tags text[] default '{}'::text[]
);

create table if not exists public.saved_images (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  image_url text not null,
  label text,
  album text default 'General',
  created_at timestamptz default now()
);

-- Optional: per-store prompt_modifier column on shopify_stores.
-- If set, it is prefixed to every generation prompt for that store.
alter table public.shopify_stores
  add column if not exists prompt_modifier text;

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists moodboard_images_store_idx on public.moodboard_images (store_name, created_at desc);
create index if not exists product_photos_store_idx on public.product_photos (store_name, created_at desc);
create index if not exists generated_images_store_idx on public.generated_images (store_name, created_at desc);
create index if not exists saved_images_store_idx on public.saved_images (store_name, created_at desc);

-- ============================================================
-- RLS — admin + marketing can manage all rows.
-- Other roles have no access.
-- ============================================================
alter table public.moodboard_images enable row level security;
alter table public.product_photos enable row level security;
alter table public.generated_images enable row level security;
alter table public.saved_images enable row level security;

drop policy if exists "content_studio_moodboard_manage" on public.moodboard_images;
create policy "content_studio_moodboard_manage"
  on public.moodboard_images for all
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

drop policy if exists "content_studio_product_photos_manage" on public.product_photos;
create policy "content_studio_product_photos_manage"
  on public.product_photos for all
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

drop policy if exists "content_studio_generated_manage" on public.generated_images;
create policy "content_studio_generated_manage"
  on public.generated_images for all
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

drop policy if exists "content_studio_saved_manage" on public.saved_images;
create policy "content_studio_saved_manage"
  on public.saved_images for all
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
-- STORAGE — create the public bucket `content-studio`
-- ============================================================
insert into storage.buckets (id, name, public)
values ('content-studio', 'content-studio', true)
on conflict (id) do nothing;

drop policy if exists "content_studio_storage_insert" on storage.objects;
create policy "content_studio_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'content-studio'
    and exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );

drop policy if exists "content_studio_storage_read" on storage.objects;
create policy "content_studio_storage_read"
  on storage.objects for select to public
  using (bucket_id = 'content-studio');

drop policy if exists "content_studio_storage_update" on storage.objects;
create policy "content_studio_storage_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'content-studio'
    and exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );

drop policy if exists "content_studio_storage_delete" on storage.objects;
create policy "content_studio_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'content-studio'
    and exists (
      select 1 from employees
      where employees.auth_id = auth.uid()
        and employees.role in ('admin', 'marketing')
    )
  );
