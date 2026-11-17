-- "Create your own" plans keep what the planner learned from the page's own
-- ads (winners with numbers, copy and what is in the winning videos), so the
-- plan screen can show what each concept is built on.
--
-- Run with:  npm run db:run -- supabase/image-studio-own-evidence-migration.sql

alter table image_studio_plans add column if not exists evidence jsonb;
