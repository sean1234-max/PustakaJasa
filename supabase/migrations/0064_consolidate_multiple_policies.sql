-- Performance advisor (2026-09-17 pass, multiple_permissive_policies): each
-- of these tables had 2+ separate PERMISSIVE policies for the same
-- (role, action) — e.g. orders SELECT had 6 (admin/production/sales
-- manager/salesman/store_admin/teacher) all OR'd together by Postgres at
-- query time. Postgres has to evaluate every one of them per row; merging
-- them into ONE policy with an explicit `or` does the same OR, evaluated
-- once, instead of once per policy per row.
--
-- Every combined policy below is the literal OR of its old policies' exact
-- conditions (order doesn't matter for an OR) — same effective access for
-- every role, nothing added or removed. Verified afterward by comparing
-- row counts visible to a teacher/salesman/admin against the same
-- accounts' actual data (see conversation) — a plain SELECT COUNT under
-- each role's impersonated session, both before and after this migration,
-- came out identical.

-- ai_extraction_runs: SELECT (admin, own) — 2 -> 1
drop policy "admins read all extraction runs" on public.ai_extraction_runs;
drop policy "read own extraction runs" on public.ai_extraction_runs;
create policy "select access" on public.ai_extraction_runs
  for select using (
    public.current_role() = 'admin'
    or created_by = (select auth.uid())
  );

-- ai_grammar_checks: SELECT (admin, own) — 2 -> 1
drop policy "admins read all grammar checks" on public.ai_grammar_checks;
drop policy "read own grammar checks" on public.ai_grammar_checks;
create policy "select access" on public.ai_grammar_checks
  for select using (
    public.current_role() = 'admin'
    or created_by = (select auth.uid())
  );

-- catalog_reference_images: DELETE/INSERT/UPDATE (admin, production+active) — 2 -> 1 each
drop policy "admin deletes reference images" on public.catalog_reference_images;
drop policy "production deletes reference images" on public.catalog_reference_images;
create policy "delete access" on public.catalog_reference_images
  for delete using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

drop policy "admin writes reference images" on public.catalog_reference_images;
drop policy "production writes reference images" on public.catalog_reference_images;
create policy "insert access" on public.catalog_reference_images
  for insert with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

drop policy "admin updates reference images" on public.catalog_reference_images;
drop policy "production updates reference images" on public.catalog_reference_images;
create policy "update access" on public.catalog_reference_images
  for update using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  ) with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

-- invoicing_salesman_assignments: SELECT (admin, own) — 2 -> 1
-- (its DELETE/INSERT each only ever had one policy — not touched)
drop policy "admin reads invoicing assignments" on public.invoicing_salesman_assignments;
drop policy "invoicing reads own assignments" on public.invoicing_salesman_assignments;
create policy "select access" on public.invoicing_salesman_assignments
  for select using (
    public.current_role() = 'admin'
    or invoicing_id = (select auth.uid())
  );

-- plak_catalog_nodes: DELETE/INSERT/UPDATE (admin, production+active) — 2 -> 1 each
-- (its SELECT only ever had one policy — not touched)
drop policy "admin deletes catalog" on public.plak_catalog_nodes;
drop policy "production deletes catalog" on public.plak_catalog_nodes;
create policy "delete access" on public.plak_catalog_nodes
  for delete using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

drop policy "admin writes catalog" on public.plak_catalog_nodes;
drop policy "production writes catalog" on public.plak_catalog_nodes;
create policy "insert access" on public.plak_catalog_nodes
  for insert with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

drop policy "admin updates catalog" on public.plak_catalog_nodes;
drop policy "production updates catalog" on public.plak_catalog_nodes;
create policy "update access" on public.plak_catalog_nodes
  for update using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  ) with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

-- plak_stock_groups: DELETE/INSERT/UPDATE (admin, production+active) — 2 -> 1 each
-- (its SELECT only ever had one policy — not touched)
drop policy "admin deletes stock groups" on public.plak_stock_groups;
drop policy "production deletes stock groups" on public.plak_stock_groups;
create policy "delete access" on public.plak_stock_groups
  for delete using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

drop policy "admin writes stock groups" on public.plak_stock_groups;
drop policy "production writes stock groups" on public.plak_stock_groups;
create policy "insert access" on public.plak_stock_groups
  for insert with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

drop policy "admin updates stock groups" on public.plak_stock_groups;
drop policy "production updates stock groups" on public.plak_stock_groups;
create policy "update access" on public.plak_stock_groups
  for update using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  ) with check (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and current_status() = 'active')
  );

-- profiles: SELECT (admin, salesman-visible-to-all, own) — 3 -> 1
-- (its UPDATE only ever had one policy — not touched)
drop policy "admin reads all profiles" on public.profiles;
drop policy "authenticated reads salesman profiles" on public.profiles;
drop policy "read own profile" on public.profiles;
create policy "select access" on public.profiles
  for select using (
    public.current_role() = 'admin'
    or ((select auth.role()) = 'authenticated' and role = 'salesman')
    or (select auth.uid()) = id
  );

-- orders: SELECT (admin/production/sales manager/salesman/store_admin/teacher) — 6 -> 1
-- UPDATE (admin/production/salesman/store_admin/teacher) — 5 -> 1
-- (its INSERT only ever had one policy — "teacher creates own orders",
-- already optimized in 0063 — not touched)
drop policy "admin reads all orders" on public.orders;
drop policy "production reads all orders" on public.orders;
drop policy "sales manager reads all orders" on public.orders;
drop policy "salesman reads own orders" on public.orders;
drop policy "store_admin reads assigned salesman orders" on public.orders;
drop policy "teacher reads own orders" on public.orders;
create policy "select access" on public.orders
  for select using (
    public.current_role() = 'admin'
    or public.current_role() = 'production'
    or (public.current_role() = 'salesman' and is_sales_manager())
    or salesman_id = (select auth.uid())
    or (public.current_role() = 'store_admin' and salesman_id in (select my_assigned_invoicing_salesman_ids()))
    or created_by = (select auth.uid())
  );

drop policy "admin updates all orders" on public.orders;
drop policy "production updates all orders" on public.orders;
drop policy "salesman updates own orders" on public.orders;
drop policy "store_admin updates assigned salesman orders" on public.orders;
drop policy "teacher updates own orders" on public.orders;
create policy "update access" on public.orders
  for update using (
    public.current_role() = 'admin'
    or public.current_role() = 'production'
    or salesman_id = (select auth.uid())
    or (public.current_role() = 'store_admin' and salesman_id in (select my_assigned_invoicing_salesman_ids()))
    or created_by = (select auth.uid())
  ) with check (
    public.current_role() = 'admin'
    or public.current_role() = 'production'
    or salesman_id = (select auth.uid())
    or (public.current_role() = 'store_admin' and salesman_id in (select my_assigned_invoicing_salesman_ids()))
    or created_by = (select auth.uid())
  );
