-- Science B-roll: two looks (cinematic 3D medical animation, the new default,
-- and the textbook plate), and a scale per beat (surface, section, cellular,
-- vessel, body) so a set moves through the body instead of holding one
-- framing.
--
-- Run with:  npm run db:run -- supabase/science-broll-looks-migration.sql

alter table cartoon_hooks add column if not exists look text not null default 'cinematic';
alter table cartoon_hooks drop constraint if exists cartoon_hooks_look_check;
alter table cartoon_hooks add constraint cartoon_hooks_look_check check (look in ('cinematic', 'plate'));
-- Sets made before the looks existed were textbook plates.
update cartoon_hooks set look = 'plate' where kind = 'science' and created_at < '2026-10-20T00:00:00+08:00';

alter table cartoon_beats add column if not exists scale text;

notify pgrst, 'reload schema';
