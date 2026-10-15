-- ============================================
-- Store Ad Defaults - default ad copy
-- "Save current as default" in the ad wizards now keeps the store's
-- usual primary text, headline and description too, so a marketer does
-- not retype the same copy on every bulk run.
-- ============================================

alter table store_ad_defaults
  add column if not exists default_primary_text text,
  add column if not exists default_headline text,
  add column if not exists default_description text;
