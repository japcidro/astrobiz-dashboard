-- Hook Generator: room to prompt freely.
--   * Head-tap moves are optional. A hook planned without any has beats of
--     kind 'custom': no hand-on-head requirement and no head-tap check.
--   * The marketer can hold a hook after planning (hold_stills) to read and
--     edit every prompt before the starting images are drawn, and can replace
--     a beat's image or clip prompt with their own (still_custom /
--     motion_custom: the text is used as written).
--   * Clip length can be chosen: for the whole hook (clip_seconds, null =
--     fit each beat's line) or per beat (clip_seconds_set). A chosen length
--     is kept whole in the joined hook instead of being cut where the line ends.
--
-- Run with:  npm run db:run -- supabase/hook-generator-freedom-migration.sql

alter table hookgen_hooks
  add column if not exists hold_stills boolean not null default false,
  add column if not exists clip_seconds int;

alter table hookgen_beats
  add column if not exists still_custom boolean not null default false,
  add column if not exists motion_custom boolean not null default false,
  add column if not exists clip_seconds_set boolean not null default false;
