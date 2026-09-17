-- Reverts 0060_add_ops_checklist.sql — the Admin Dashboard checklist UI was
-- removed (user didn't want it there), so nothing reads or writes this
-- table anymore.
drop table if exists public.ops_checklist_items;
