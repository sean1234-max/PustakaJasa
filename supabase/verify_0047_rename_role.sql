-- Verification for 0047_rename_invoicing_role_to_store_admin.sql.
-- Pure inspection only. Run each BLOCK on its own.

-- ============================================================
-- BLOCK 1 — role check constraint now lists 'store_admin', not 'invoicing'.
-- Expect: one row, check_clause containing 'store_admin' and NOT 'invoicing'.
-- ============================================================
select constraint_name, check_clause
from information_schema.check_constraints
where constraint_name = 'profiles_role_check';

-- ============================================================
-- BLOCK 2 — no profiles left on the old role.  Expect: 0 rows for 'invoicing'.
-- ============================================================
select role, count(*)
from public.profiles
group by role
order by role;

-- ============================================================
-- BLOCK 3 — the two orders policies were renamed.
-- Expect: "store_admin reads assigned salesman orders" +
--         "store_admin updates assigned salesman orders",
--         and NO "invoicing ..." policies.
-- ============================================================
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'orders'
  and (policyname ilike '%store_admin%' or policyname ilike '%invoicing%')
order by policyname;

-- ============================================================
-- BLOCK 4 — the installed guard body is 0047's (store_admin branch, no
-- 'invoicing' literal).  Expect: t | f
-- ============================================================
select
  pg_get_functiondef('public.orders_write_guard()'::regprocedure) ilike '%v_role = ''store_admin''%'  as has_store_admin_branch,
  pg_get_functiondef('public.orders_write_guard()'::regprocedure) ilike '%v_role = ''invoicing''%'    as still_has_invoicing_branch;

-- ============================================================
-- BLOCK 5 — the assignment table / function kept their names (unchanged).
-- Expect: invoicing_salesman_assignments table + my_assigned_invoicing_salesman_ids fn.
-- ============================================================
select 'table' as kind, table_name as name
from information_schema.tables
where table_schema = 'public' and table_name = 'invoicing_salesman_assignments'
union all
select 'function', proname
from pg_proc where proname = 'my_assigned_invoicing_salesman_ids';
