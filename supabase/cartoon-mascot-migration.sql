-- Cartoon Generator (was Cartoon Hooks): a "mascot" style, where the
-- personified subject of the script (hair strands with faces on the scalp,
-- fat cells, a capsule) is the character, designed once and carried through
-- every beat in its own macro world, like the MDhair hair-strand film.
--
-- Run with:  npm run db:run -- supabase/cartoon-mascot-migration.sql

alter table cartoon_hooks drop constraint if exists cartoon_hooks_style_check;
alter table cartoon_hooks add constraint cartoon_hooks_style_check check (style in ('pixar3d', 'flat2d', 'medical', 'mascot', 'mixed', 'science'));
alter table cartoon_beats drop constraint if exists cartoon_beats_style_check;
alter table cartoon_beats add constraint cartoon_beats_style_check check (style in ('pixar3d', 'flat2d', 'medical', 'mascot', 'science'));

notify pgrst, 'reload schema';
