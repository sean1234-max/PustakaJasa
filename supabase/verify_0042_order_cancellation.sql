-- Verification for 0042_order_cancellation.sql.
-- Pure inspection only — behaviour (who can cancel, frozen-once-cancelled) is
-- verified by the app test checklist, not here: simulating a logged-in user
-- via set_config('request.jwt.claims', ...) is unreliable inside the Supabase
-- SQL editor (auth.uid() resolves to NULL, so current_status()/current_role()
-- misfire). Run each BLOCK on its own.

-- ============================================================
-- BLOCK 1 — new columns exist.  Expect 3 rows.
-- ============================================================
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name in ('cancel_reason','cancelled_at','cancelled_by')
order by column_name;

-- ============================================================
-- BLOCK 2 — 'Cancelled' is allowed by the status check constraint.
-- Expect: one row, check_clause containing 'Cancelled'.
-- ============================================================
select constraint_name, check_clause
from information_schema.check_constraints
where constraint_name = 'orders_status_check';

-- ============================================================
-- BLOCK 3 — the guard function + both triggers are in place.
-- Expect: orders_write_guard (function) + orders_write_guard_trigger
-- + orders_amount_guard_trigger.
-- ============================================================
select 'function' as kind, proname as name
from pg_proc where proname in ('orders_write_guard','orders_amount_guard','order_items_total_consistent')
union all
select 'trigger', tgname
from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal
order by kind, name;

-- ============================================================
-- BLOCK 4 — the guard body actually contains the new 'Cancelled' rules
-- (quick smoke check that 0042's version is the one installed, not 0041's).
-- Expect: t | t
-- ============================================================
select
  pg_get_functiondef('public.orders_write_guard()'::regprocedure) ilike '%has been cancelled and can no longer be edited%' as has_frozen_rule,
  pg_get_functiondef('public.orders_write_guard()'::regprocedure) ilike '%new.status in (''In Production'', ''Cancelled'')%'   as has_salesman_cancel_rule;
