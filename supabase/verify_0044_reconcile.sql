-- Verification for 0044_reconcile_policies_and_advisors.sql. Pure inspection.

-- ============================================================
-- BLOCK 1 — `orders` policy set after cleanup. Expect exactly 11 rows:
--   INSERT (1): teacher creates own orders
--   SELECT (5): admin reads all orders, invoicing reads assigned salesman orders,
--               production reads all orders, salesman reads own orders,
--               teacher reads own orders
--   UPDATE (5): admin updates all orders, invoicing updates assigned salesman orders,
--               production updates all orders, salesman updates own orders,
--               teacher updates own orders
-- The dropped names (teachers insert own orders / teachers see own orders /
-- production see all orders / production update all orders) must be GONE.
-- ============================================================
select cmd, policyname
from pg_policies
where schemaname = 'public' and tablename = 'orders'
order by cmd, policyname;

-- ============================================================
-- BLOCK 2 — policy count per command on orders. Expect exactly:
--   INSERT = 1, SELECT = 5, UPDATE = 5   (no DELETE policy — by design).
-- ============================================================
select cmd, count(*) as policy_count
from pg_policies
where schemaname = 'public' and tablename = 'orders'
group by cmd
order by cmd;

-- ============================================================
-- BLOCK 3 — order_items_total_consistent now has a fixed search_path.
-- Expect: a row containing 'search_path=public' (or 'SET search_path TO public').
-- ============================================================
select proname, proconfig
from pg_proc
where proname = 'order_items_total_consistent';

-- ============================================================
-- BLOCK 4 — the function still works (search_path change didn't break it).
-- Expect: t | f
-- ============================================================
select
  public.order_items_total_consistent('[{"jenisPlak":"X","qty":2,"unitPrice":7.5,"harga":15}]'::jsonb, 15) as ok,
  public.order_items_total_consistent('[{"jenisPlak":"X","qty":2,"unitPrice":7.5,"harga":15}]'::jsonb, 99) as bad;

-- ============================================================
-- BLOCK 5 — RPC exposure. Expect every value FALSE:
--   trigger fns not callable by anyone; helpers not callable by anon.
-- ============================================================
select
  has_function_privilege('anon',          'public.orders_write_guard()',  'execute') as anon_write_guard,
  has_function_privilege('authenticated', 'public.orders_write_guard()',  'execute') as auth_write_guard,
  has_function_privilege('anon',          'public.orders_amount_guard()', 'execute') as anon_amount_guard,
  has_function_privilege('anon',          'public.current_role()',        'execute') as anon_current_role,
  has_function_privilege('anon',          'public.current_status()',      'execute') as anon_current_status;

-- ============================================================
-- BLOCK 6 — but `authenticated` KEEPS the RLS helpers (the orders/catalog
-- policies call them and would break otherwise). Expect: t | t | t
-- ============================================================
select
  has_function_privilege('authenticated', 'public.current_role()',                       'execute') as auth_current_role,
  has_function_privilege('authenticated', 'public.current_status()',                     'execute') as auth_current_status,
  has_function_privilege('authenticated', 'public.my_assigned_invoicing_salesman_ids()', 'execute') as auth_invoicing_ids;
