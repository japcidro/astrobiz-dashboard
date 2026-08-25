-- J&T upload history.
--
-- Before this, the only trace of an upload was `jt_deliveries.uploaded_at` on
-- each individual parcel row. That can't answer the question the admin actually
-- has when opening the uploader: "kailan ako huling nag-upload, at anong dates
-- ang sakop ng file na yun?" — so there was no way to know where to continue
-- without opening the last .xlsx again.
--
-- One row here == one .xlsx file. The client splits a file into batches of 100
-- and POSTs each separately, so every batch of the same file carries the same
-- client-generated `id` and accumulates into a single row via
-- record_jt_upload_batch() below.

create table if not exists public.jt_upload_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.employees(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  file_name text,
  row_count integer not null default 0,
  submission_date_min timestamptz,
  submission_date_max timestamptz,
  stores text[] not null default '{}',
  backfilled boolean not null default false
);

comment on table public.jt_upload_batches is
  'One row per uploaded J&T .xlsx file. Drives the "last upload" panel on the J&T dashboard.';
comment on column public.jt_upload_batches.submission_date_min is
  'Earliest J&T Submission Time in the file — the start of the range this upload covers.';
comment on column public.jt_upload_batches.submission_date_max is
  'Latest J&T Submission Time in the file — continue the next upload from here.';
comment on column public.jt_upload_batches.backfilled is
  'True for rows reconstructed from jt_deliveries.uploaded_at clustering, not recorded live. file_name and uploaded_by are unknowable for these.';

create index if not exists jt_upload_batches_uploaded_at_idx
  on public.jt_upload_batches (uploaded_at desc);

alter table public.jt_upload_batches enable row level security;

drop policy if exists "jt_upload_batches_admin" on public.jt_upload_batches;
create policy "jt_upload_batches_admin" on public.jt_upload_batches
  for all
  using (
    exists (select 1 from public.employees e where e.auth_id = auth.uid() and e.role = 'admin')
  )
  with check (
    exists (select 1 from public.employees e where e.auth_id = auth.uid() and e.role = 'admin')
  );

-- Accumulate one POSTed batch into its file's row. Atomic, so the sequential
-- per-100-row calls from the client can't clobber each other's totals.
-- LEAST/GREATEST ignore NULLs, so a batch whose rows all had unparseable
-- submission times won't wipe out a range established by earlier batches.
create or replace function public.record_jt_upload_batch(
  p_batch_id uuid,
  p_file_name text,
  p_uploaded_by uuid,
  p_row_count integer,
  p_min timestamptz,
  p_max timestamptz,
  p_stores text[]
) returns void
language sql
as $$
  insert into public.jt_upload_batches as b
    (id, uploaded_by, file_name, row_count, submission_date_min, submission_date_max, stores)
  values
    (p_batch_id, p_uploaded_by, p_file_name, coalesce(p_row_count, 0), p_min, p_max, coalesce(p_stores, '{}'))
  on conflict (id) do update set
    row_count           = b.row_count + excluded.row_count,
    submission_date_min = least(b.submission_date_min, excluded.submission_date_min),
    submission_date_max = greatest(b.submission_date_max, excluded.submission_date_max),
    stores              = (
      select coalesce(array_agg(distinct s order by s), '{}')
      from unnest(b.stores || excluded.stores) as s
      where s is not null and s <> ''
    ),
    file_name           = coalesce(b.file_name, excluded.file_name),
    completed_at        = now();
$$;

grant execute on function public.record_jt_upload_batch(uuid, text, uuid, integer, timestamptz, timestamptz, text[]) to authenticated;

-- Backfill history from existing parcels so the panel isn't empty on day one.
-- Rows written within 15 minutes of each other came from the same file: the
-- client uploads batches back-to-back, while separate sittings are hours apart.
insert into public.jt_upload_batches
  (uploaded_at, completed_at, row_count, submission_date_min, submission_date_max, stores, backfilled)
select
  min(uploaded_at),
  max(uploaded_at),
  count(*),
  min(submission_date),
  max(submission_date),
  coalesce(
    (select array_agg(distinct s order by s) from unnest(array_agg(store_name)) as s where s is not null and s <> ''),
    '{}'
  ),
  true
from (
  select
    uploaded_at,
    submission_date,
    store_name,
    sum(is_new_batch) over (order by uploaded_at rows between unbounded preceding and current row) as batch_no
  from (
    select
      uploaded_at,
      submission_date,
      store_name,
      case
        when lag(uploaded_at) over (order by uploaded_at) is null then 1
        when uploaded_at - lag(uploaded_at) over (order by uploaded_at) > interval '15 minutes' then 1
        else 0
      end as is_new_batch
    from public.jt_deliveries
  ) marked
) grouped
group by batch_no
on conflict (id) do nothing;
