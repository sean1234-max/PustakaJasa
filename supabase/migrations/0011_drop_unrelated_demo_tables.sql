-- Removes 4 tables (teachers, staff, order_items, order_item_breakdown)
-- that belonged to a different, unrelated app which used to share this
-- Supabase project (see 0004_enable_rls_other_tables.sql) — confirmed by
-- the project owner to hold only leftover demo/test accounts from that
-- other app, no longer in use. Dropping them removes the RLS exposure
-- these tables carried (they were intentionally left untouched by
-- 0010_scope_rls_by_role.sql, since fixing their policies without knowing
-- that other app's needs risked breaking it — deleting them sidesteps
-- that entirely).
drop table if exists public.order_item_breakdown cascade;
drop table if exists public.order_items cascade;
drop table if exists public.teachers cascade;
drop table if exists public.staff cascade;
