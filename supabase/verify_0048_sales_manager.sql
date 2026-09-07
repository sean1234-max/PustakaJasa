-- Verification for 0048_sales_manager.sql. Run each BLOCK on its own.

-- BLOCK 1 — column + constraint exist. Expect: is_sales_manager boolean NO,
-- and a check constraint mentioning is_sales_manager.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_sales_manager';

select conname, pg_get_constraintdef(oid)
from pg_constraint where conname = 'profiles_sales_manager_is_salesman';

-- BLOCK 2 — helper function + grant. Expect: is_sales_manager fn, executable by authenticated.
select proname, has_function_privilege('authenticated', 'public.is_sales_manager()', 'execute') as auth_can_exec
from pg_proc where proname = 'is_sales_manager';

-- BLOCK 3 — the orders SELECT policy. Expect one row: "sales manager reads all orders".
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'orders' and policyname = 'sales manager reads all orders';

-- BLOCK 4 — who is a manager right now. Expect 0 rows initially.
select id, display_name, email from public.profiles where is_sales_manager;
