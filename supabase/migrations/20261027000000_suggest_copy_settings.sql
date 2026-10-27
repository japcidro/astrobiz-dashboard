-- Bulk Create: per-store settings for copy suggested from each uploaded
-- image (src/components/marketing/bulk-create). Whether suggestions run on
-- upload, the language mix the copy is written in, and whether recent
-- winner ads lend their tone.

alter table public.store_ad_defaults
  add column if not exists suggest_copy_enabled boolean not null default true,
  add column if not exists suggest_copy_language text not null default 'taglish',
  add column if not exists suggest_copy_use_winners boolean not null default true;

alter table public.store_ad_defaults
  drop constraint if exists store_ad_defaults_suggest_copy_language_check;
alter table public.store_ad_defaults
  add constraint store_ad_defaults_suggest_copy_language_check
  check (suggest_copy_language in ('taglish', 'english', 'tagalog'));
