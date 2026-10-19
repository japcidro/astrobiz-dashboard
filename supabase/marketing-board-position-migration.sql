-- Marketing Board: cards keep a hand-set order inside a column. Smaller
-- position = higher up. New cards land at the top (a negative epoch, so
-- newer is smaller), and a drag between two cards takes the midpoint of
-- their positions, so no other row has to move.
--
-- Run with:  npm run db:run -- supabase/marketing-board-position-migration.sql

alter table marketing_board_items add column if not exists position double precision;
update marketing_board_items set position = -extract(epoch from created_at) where position is null;
alter table marketing_board_items alter column position set default -extract(epoch from now());
alter table marketing_board_items alter column position set not null;
create index if not exists marketing_board_items_status_position_idx on marketing_board_items (status, position);

notify pgrst, 'reload schema';
