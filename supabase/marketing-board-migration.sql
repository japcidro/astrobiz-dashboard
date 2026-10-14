-- Marketing Board — reference ads (TikTok, Ads Library, …) pinned to a
-- to-do / in-progress / done board, with instruction notes and the finished
-- ads attached as outputs. The Mac worker saves a high-quality copy of each
-- reference with yt-dlp (job kind 'board_fetch' in hook_studio_jobs).
--
-- Service-role only (RLS on, no policies), like Hook Studio: the owner API
-- routes and the worker both use the service key.
--
-- Run with:  npm run db:run -- supabase/marketing-board-migration.sql

create extension if not exists pgcrypto;

create table if not exists marketing_board_items (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  source_type text not null default 'other'
    check (source_type in ('tiktok', 'fb_ads_library', 'facebook', 'instagram', 'youtube', 'other')),
  title text,
  author text,                          -- creator / page name when known
  external_thumbnail_url text,          -- from oEmbed; may expire
  embed_id text,                        -- TikTok / YouTube video id for the fallback embed
  -- Saved copy, filled by the worker
  video_path text,                      -- storage path in the marketing-board bucket
  thumb_path text,
  video_status text not null default 'pending'
    check (video_status in ('pending', 'saving', 'ready', 'failed')),
  video_error text,
  duration numeric,
  width int,
  height int,
  -- Board state
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  store text,
  assignee_id uuid references employees (id) on delete set null,
  due_date date,
  done_at timestamptz,
  created_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_board_items_status_idx
  on marketing_board_items (status, created_at desc);

create table if not exists marketing_board_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references marketing_board_items (id) on delete cascade,
  author_id uuid references employees (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists marketing_board_comments_item_idx
  on marketing_board_comments (item_id, created_at);

-- What the marketer made from the reference: an ad submitted through the
-- dashboard (Create / Bulk Create → ad_drafts) or an uploaded video file.
create table if not exists marketing_board_outputs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references marketing_board_items (id) on delete cascade,
  kind text not null check (kind in ('fb_ad', 'upload')),
  -- fb_ad
  fb_ad_id text,
  ad_account_id text,
  ad_name text,
  fb_video_id text,
  start_time timestamptz,               -- adset start: when the ad is scheduled to run
  draft_id uuid,                        -- ad_drafts.id, informational
  -- upload
  file_path text,
  note text,
  added_by uuid references employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists marketing_board_outputs_item_idx
  on marketing_board_outputs (item_id, created_at);

alter table marketing_board_items enable row level security;
alter table marketing_board_comments enable row level security;
alter table marketing_board_outputs enable row level security;

drop trigger if exists marketing_board_items_touch on marketing_board_items;
create trigger marketing_board_items_touch
  before update on marketing_board_items
  for each row execute function hook_studio_touch();

-- The worker claims 'board_fetch' jobs from the same queue as Hook Studio.
alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch'));

-- Private bucket; the app signs read URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-board', 'marketing-board', false, 524288000,
  array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
