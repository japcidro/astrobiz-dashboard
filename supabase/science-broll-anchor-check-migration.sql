-- Science B-roll: the style anchor is checked by Claude for anatomical
-- coherence (nothing floating, every structure attached, nothing happening)
-- before the marketer sees it; a fail redraws it once with the fix.
--
-- Run with:  npm run db:run -- supabase/science-broll-anchor-check-migration.sql

alter table cartoon_hooks add column if not exists anchor_check_prompt text not null default '';
alter table cartoon_hooks add column if not exists anchor_check_status text check (anchor_check_status in ('queued', 'running', 'done', 'failed'));
alter table cartoon_hooks add column if not exists anchor_check_ok boolean;
alter table cartoon_hooks add column if not exists anchor_check_notes text;
alter table cartoon_hooks add column if not exists anchor_check_error text;
alter table cartoon_hooks add column if not exists anchor_auto_redos int not null default 0;

-- Anchors already drawn count as checked.
update cartoon_hooks set anchor_check_status = 'done' where kind = 'science' and character_status = 'done' and anchor_check_status is null;

notify pgrst, 'reload schema';
