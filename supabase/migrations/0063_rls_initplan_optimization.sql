-- Performance advisor (2026-09-17 pass, auth_rls_initplan): these 14
-- policies call auth.uid()/auth.role() directly in their USING/WITH CHECK
-- expression, which Postgres re-evaluates for every row scanned instead of
-- once per query. Wrapping the call as `(select auth.uid())` lets the
-- planner hoist it into an InitPlan (computed once, reused for every row) —
-- see https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select.
--
-- Every change below is a pure syntax rewrite: the exact same condition,
-- same effective access for every role, just wrapped for one evaluation
-- instead of per-row. `current_role()`/`current_status()` (this app's own
-- functions, not Supabase's auth.*) are left exactly as they were — the
-- advisor didn't flag those, and this migration only touches what it did.
-- No new/changed/removed conditions anywhere in this file.

-- profiles
drop policy "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using ((select auth.uid()) = id);

drop policy "authenticated reads salesman profiles" on public.profiles;
create policy "authenticated reads salesman profiles" on public.profiles
  for select using ((select auth.role()) = 'authenticated' and role = 'salesman');

-- orders
drop policy "teacher reads own orders" on public.orders;
create policy "teacher reads own orders" on public.orders
  for select using (created_by = (select auth.uid()));

drop policy "teacher updates own orders" on public.orders;
create policy "teacher updates own orders" on public.orders
  for update using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

drop policy "teacher creates own orders" on public.orders;
create policy "teacher creates own orders" on public.orders
  for insert with check (
    created_by = (select auth.uid())
    and public.current_role() = 'teacher'
    and public.current_status() = 'active'
    and status = 'Submitted to Sales'
    and salesman_id is not null
    and exists (
      select 1 from profiles pr
      where pr.id = orders.salesman_id and pr.role = 'salesman'
    )
  );

drop policy "salesman reads own orders" on public.orders;
create policy "salesman reads own orders" on public.orders
  for select using (salesman_id = (select auth.uid()));

drop policy "salesman updates own orders" on public.orders;
create policy "salesman updates own orders" on public.orders
  for update using (salesman_id = (select auth.uid())) with check (salesman_id = (select auth.uid()));

-- audit_log
drop policy "admin writes own audit rows" on public.audit_log;
create policy "admin writes own audit rows" on public.audit_log
  for insert with check (admin_id = (select auth.uid()) and public.current_role() = 'admin');

-- catalog_reference_images
drop policy "authenticated reads reference images" on public.catalog_reference_images;
create policy "authenticated reads reference images" on public.catalog_reference_images
  for select using ((select auth.role()) = 'authenticated');

-- plak_catalog_nodes
drop policy "authenticated reads catalog" on public.plak_catalog_nodes;
create policy "authenticated reads catalog" on public.plak_catalog_nodes
  for select using ((select auth.role()) = 'authenticated');

-- plak_stock_groups
drop policy "authenticated reads stock groups" on public.plak_stock_groups;
create policy "authenticated reads stock groups" on public.plak_stock_groups
  for select using ((select auth.role()) = 'authenticated');

-- invoicing_salesman_assignments
drop policy "invoicing reads own assignments" on public.invoicing_salesman_assignments;
create policy "invoicing reads own assignments" on public.invoicing_salesman_assignments
  for select using (invoicing_id = (select auth.uid()));

-- ai_extraction_runs
drop policy "read own extraction runs" on public.ai_extraction_runs;
create policy "read own extraction runs" on public.ai_extraction_runs
  for select using (created_by = (select auth.uid()));

-- ai_grammar_checks
drop policy "read own grammar checks" on public.ai_grammar_checks;
create policy "read own grammar checks" on public.ai_grammar_checks
  for select using (created_by = (select auth.uid()));
