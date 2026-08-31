-- ============================================================================
-- Live schema reconciliation — NOT a migration. Run each BLOCK and compare
-- against what the migrations in supabase/migrations/ say SHOULD be there.
-- 0039's own header notes that the live project has drifted from earlier
-- policy-naming generations ("both an old- and current-named copy of the
-- same salesman policy exist side by side"), so the migration files are not
-- a reliable picture of what's actually enforced. This is.
--
-- What to look for:
--   * duplicate policies for the same table+command (drift — safe to drop
--     the stale one, but confirm which is which first)
--   * any policy whose USING / WITH CHECK is literally `true` on `orders`,
--     `profiles`, or the catalog tables (should be none after 0010)
--   * `anon` holding any privilege it doesn't need
--   * RLS not enabled on an app table
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BLOCK 1 — RLS on/off for every app table. All should be rowsecurity = t.
-- ---------------------------------------------------------------------------
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'orders','profiles','plak_catalog_nodes','catalog_reference_images',
    'invoicing_salesman_assignments','audit_log','order_number_counters'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- BLOCK 2 — every policy on every app table. Scan for:
--   - two rows with the same (tablename, cmd) but different policyname  -> drift
--   - qual = 'true' or with_check = 'true' on orders/profiles/catalog   -> hole
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'orders','profiles','plak_catalog_nodes','catalog_reference_images',
    'invoicing_salesman_assignments','audit_log','order_number_counters'
  )
order by tablename, cmd, policyname;

-- ---------------------------------------------------------------------------
-- BLOCK 3 — duplicate policies for the same table + command (the 0039 drift).
-- Ideally 0 rows. Any row here is a stale policy to review/drop.
-- ---------------------------------------------------------------------------
select tablename, cmd, count(*) as policy_count,
       string_agg(policyname, ' | ' order by policyname) as policies
from pg_policies
where schemaname = 'public'
  and tablename in ('orders','profiles','plak_catalog_nodes','catalog_reference_images','invoicing_salesman_assignments')
group by tablename, cmd
having count(*) > 1
order by tablename, cmd;

-- ---------------------------------------------------------------------------
-- BLOCK 4 — any policy anywhere in `public` whose USING or WITH CHECK is the
-- literal `true` (the old "allow anon" shape). Expect none on the app tables.
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- BLOCK 5 — triggers on `orders`. Expect exactly:
--   orders_write_guard_trigger, orders_amount_guard_trigger  (both BEFORE)
-- ---------------------------------------------------------------------------
select tgname,
       case when tgtype & 2 = 2 then 'BEFORE' else 'AFTER' end as timing,
       case
         when tgtype & 4 = 4 and tgtype & 16 = 16 then 'INSERT/UPDATE'
         when tgtype & 4 = 4 then 'INSERT'
         when tgtype & 16 = 16 then 'UPDATE'
         else 'other'
       end as events,
       tgenabled
from pg_trigger
where tgrelid = 'public.orders'::regclass and not tgisinternal
order by tgname;

-- ---------------------------------------------------------------------------
-- BLOCK 6 — every function in `public`: security type + who can execute.
-- Scan for: SECURITY DEFINER functions granted to `anon`, or any function
-- granted to PUBLIC that mutates data.
-- ---------------------------------------------------------------------------
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security,
  coalesce(
    string_agg(distinct a.grantee::regrole::text, ', ') filter (where a.grantee is not null),
    'PUBLIC'
  ) as executable_by
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(p.proacl) a on a.privilege_type = 'EXECUTE'
where n.nspname = 'public'
group by p.oid, p.proname, p.prosecdef
order by p.proname;

-- ---------------------------------------------------------------------------
-- BLOCK 7 — table/sequence privileges held by `anon`. A short list is fine
-- (Supabase grants some by default); make sure `orders`, `profiles`,
-- `audit_log`, `order_number_counters` are NOT writable by anon.
-- ---------------------------------------------------------------------------
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon'
  and table_name in ('orders','profiles','plak_catalog_nodes','catalog_reference_images',
                     'invoicing_salesman_assignments','audit_log','order_number_counters')
order by table_name, privilege_type;
