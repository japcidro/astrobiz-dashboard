-- Science B-roll: the style anchor needs the marketer's OK before any still is
-- drawn, and a redraw of the anchor is a different take each time (a note,
-- or one of the skill's variations), counted in anchor_redos.
--
-- Run with:  npm run db:run -- supabase/science-broll-anchor-migration.sql

alter table cartoon_hooks add column if not exists anchor_approved boolean not null default false;
alter table cartoon_hooks add column if not exists anchor_redos int not null default 0;
alter table cartoon_hooks add column if not exists anchor_note text not null default '';

-- Cartoon hooks have no gate: mark them approved so nothing waits on them.
update cartoon_hooks set anchor_approved = true where kind = 'cartoon' and anchor_approved = false;

notify pgrst, 'reload schema';
