-- Verification for 0040_secure_definer_rpcs.sql + 0041_harden_order_write_and_amount_guard.sql
-- Pure inspection only (no logged-in-user simulation — that's unreliable in
-- the Supabase SQL editor). Run each BLOCK on its own. Behaviour is covered
-- by the app test checklist.

-- ============================================================
-- BLOCK 1 — grants. EXECUTE must be held ONLY by 'authenticated'
-- (plus the function owner). 'anon' / 'PUBLIC' must be ABSENT.
-- ============================================================
select
  p.proname                                    as function,
  coalesce(a.grantee::regrole::text,'PUBLIC')  as grantee,
  a.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(p.proacl) a on true
where n.nspname = 'public'
  and p.proname in ('next_order_seq','plak_stock_deduct','plak_stock_restore','resolve_plak_node_id')
order by p.proname, grantee;

-- ============================================================
-- BLOCK 2 — the same thing, stated as a pass/fail.
-- Expect every value FALSE (anon cannot execute any of them).
-- ============================================================
select
  has_function_privilege('anon','public.next_order_seq(text,integer)','execute')  as anon_next_order_seq,
  has_function_privilege('anon','public.plak_stock_deduct(jsonb)','execute')       as anon_stock_deduct,
  has_function_privilege('anon','public.plak_stock_restore(jsonb)','execute')      as anon_stock_restore,
  has_function_privilege('anon','public.resolve_plak_node_id(text)','execute')     as anon_resolve_node,
  has_function_privilege('authenticated','public.plak_stock_deduct(jsonb)','execute') as auth_stock_deduct;
  -- last column should be TRUE, the rest FALSE

-- ============================================================
-- BLOCK 3 — the auth guard is actually inside the stock functions now.
-- Expect: t | t
-- ============================================================
select
  pg_get_functiondef('public.plak_stock_deduct(jsonb)'::regprocedure)  ilike '%auth.uid() is null%' as deduct_has_auth_guard,
  pg_get_functiondef('public.plak_stock_restore(jsonb)'::regprocedure) ilike '%auth.uid() is null%' as restore_has_auth_guard;

-- ============================================================
-- BLOCK 4 — arithmetic consistency function works. Expect: t | t | f | f | f
-- ============================================================
select
  public.order_items_total_consistent('[{"jenisPlak":"CPH / A","qty":2,"unitPrice":7.5,"harga":15}]'::jsonb, 15)  as ok_simple,
  public.order_items_total_consistent('[{"jenisPlak":"OTHER - x","qty":3,"unitPrice":null,"harga":0}]'::jsonb, 0)  as ok_null_price,
  public.order_items_total_consistent('[{"jenisPlak":"CPH / A","qty":2,"unitPrice":7.5,"harga":15}]'::jsonb, 1)    as bad_total,
  public.order_items_total_consistent('[{"jenisPlak":"CPH / A","qty":2,"unitPrice":7.5,"harga":99}]'::jsonb, 99)   as bad_harga,
  public.order_items_total_consistent('[{"jenisPlak":"","qty":2,"unitPrice":7.5,"harga":15}]'::jsonb, 15)          as bad_blank_plak;

-- ============================================================
-- BLOCK 5 — the guard + trigger are installed.
-- Expect: orders_write_guard + orders_amount_guard (functions) and both
-- *_trigger rows on public.orders.
-- ============================================================
select 'function' as kind, proname as name
from pg_proc where proname in ('orders_write_guard','orders_amount_guard','order_items_total_consistent')
union all
select 'trigger', tgname
from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal
order by kind, name;

-- ============================================================
-- BLOCK 6 — the teacher In-Production freeze rule is in the installed guard.
-- Expect: t
-- ============================================================
select pg_get_functiondef('public.orders_write_guard()'::regprocedure)
       ilike '%already in production%submit an Add-On%' as has_in_production_freeze;

-- ============================================================
-- BLOCK 7 — existing orders whose stored total != sum(items.harga).
-- Not frozen by the migration, but the next salesman/teacher edit of one
-- will be blocked. Ideally 0 rows. (You already ran this — it returned none.)
-- ============================================================
select id, status, total_amount,
       (select coalesce(sum((i->>'harga')::numeric),0) from jsonb_array_elements(items) i) as items_sum
from public.orders
where not public.order_items_total_consistent(items, total_amount)
order by id desc;
