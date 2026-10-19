-- Science B-roll Generator (Marketing Tools): text in, textbook-style
-- cross-section science clips out. It rides on the Cartoon Hooks tables and
-- the same Mac worker steps: a project is a cartoon_hooks row of kind
-- 'science' and style 'science'; its "character" is the style anchor (one
-- image every still is drawn from, so the set matches); each beat is one
-- science shot with a named move (cross-section, process, red highlight,
-- green calm, blue flow, split, gold comeback).
--
-- New for this kind: Claude checks every still before it is animated
-- (worker job 'science_check'); a failed check redraws the still once with
-- the fix in the prompt, then the clip is made.
--
-- Run with:  npm run db:run -- supabase/science-broll-migration.sql

alter table cartoon_hooks add column if not exists kind text not null default 'cartoon';
alter table cartoon_hooks drop constraint if exists cartoon_hooks_kind_check;
alter table cartoon_hooks add constraint cartoon_hooks_kind_check check (kind in ('cartoon', 'science'));
alter table cartoon_hooks drop constraint if exists cartoon_hooks_style_check;
alter table cartoon_hooks add constraint cartoon_hooks_style_check check (style in ('pixar3d', 'flat2d', 'medical', 'mixed', 'science'));
create index if not exists cartoon_hooks_kind_created_idx on cartoon_hooks (kind, created_at desc);

alter table cartoon_beats drop constraint if exists cartoon_beats_style_check;
alter table cartoon_beats add constraint cartoon_beats_style_check check (style in ('pixar3d', 'flat2d', 'medical', 'science'));
alter table cartoon_beats add column if not exists move text;                      -- the science move this beat uses
alter table cartoon_beats add column if not exists check_prompt text not null default ''; -- what Claude checks the still against, built by the app
alter table cartoon_beats add column if not exists check_status text check (check_status in ('queued', 'running', 'done', 'failed'));
alter table cartoon_beats add column if not exists check_ok boolean;
alter table cartoon_beats add column if not exists check_notes text;
alter table cartoon_beats add column if not exists check_error text;
alter table cartoon_beats add column if not exists still_redos int not null default 0;  -- automatic redraws after a failed check

-- Worker job kinds.
alter table hook_studio_jobs drop constraint if exists hook_studio_jobs_kind_check;
alter table hook_studio_jobs
  add constraint hook_studio_jobs_kind_check
  check (kind in ('remake', 'face', 'ugc_image', 'board_fetch',
                  'remake_split', 'remake_frames', 'remake_still', 'remake_tts', 'remake_clip', 'remake_mix',
                  'talking_head', 'image_gen',
                  'cartoon_character', 'cartoon_still', 'cartoon_clip', 'cartoon_voice', 'cartoon_join',
                  'hookgen_still', 'hookgen_clip', 'hookgen_check', 'hookgen_join',
                  'science_check'));

notify pgrst, 'reload schema';
