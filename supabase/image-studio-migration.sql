-- Marketing Board images + Image Studio.
--
-- Board cards get a kind: 'video' (today's cards) or 'image' (a saved image
-- reference from a link or an upload, in image_path). Image Studio turns a
-- reference into our own images from a plain-words instruction and
-- role-tagged attachments; each run makes N results, rendered by the Mac
-- worker on Nano Banana Pro (job kind 'image_gen').
--
-- Run with:  npm run db:run -- supabase/image-studio-migration.sql

alter table marketing_board_items
  add column if not exists kind text not null default 'video' check (kind in ('video', 'image')),
  add column if not exists image_path text;

create index if not exists marketing_board_items_kind_idx on marketing_board_items (kind, created_at desc);

create table if not exists image_studio_runs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references marketing_board_items (id) on delete set null,
  store text,
  preset text not null default 'adapt',
  instruction text not null default '',
  product_mode text not null default 'in' check (product_mode in ('in', 'none')),
  person_mode text not null default 'model' check (person_mode in ('model', 'none', 'new')),
  output text not null default 'single' check (output in ('single', 'pair', 'set3')),
  format text not null default '1:1' check (format in ('1:1', '4:5', '9:16', '1.91:1')),
  versions int not null default 1 check (versions between 1 and 4),
  text_on_image text not null default '',
  text_style text not null default 'reference' check (text_style in ('reference', 'clean')),
  attachments jsonb not null default '[]'::jsonb,   -- [{bucket, path, role, label}]
  prompt text not null default '',
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists image_studio_runs_item_idx on image_studio_runs (item_id, created_at desc);

create table if not exists image_studio_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references image_studio_runs (id) on delete cascade,
  idx int not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  job_id uuid,
  path text,                 -- the image (or the wide before/after image)
  preview_path text,
  pair_paths jsonb,          -- ["…-before.png", "…-after.png"] for a pair
  brand_check jsonb,
  kept boolean not null default false,
  credits numeric,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists image_studio_results_run_idx on image_studio_results (run_id, idx);

alter table image_studio_runs enable row level security;
alter table image_studio_results enable row level security;

drop trigger if exists image_studio_results_touch on image_studio_results;
create trigger image_studio_results_touch before update on image_studio_results
  for each row execute function hook_studio_touch();

alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch',
                  'remake_split', 'remake_frames', 'remake_still', 'remake_tts', 'remake_clip', 'remake_mix',
                  'talking_head',
                  'cartoon_character', 'cartoon_still', 'cartoon_clip', 'cartoon_voice', 'cartoon_join',
                  'image_gen'));
