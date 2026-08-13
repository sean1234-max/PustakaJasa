-- Grants the new 'admin' role access on top of what 0010 already set up
-- for teacher/salesman/production — added as new policies (Postgres ORs
-- multiple permissive policies together) rather than editing the existing
-- production-scoped ones, so the already-verified teacher/salesman/
-- production behavior from 0010 can't regress.

-- orders: admin sees and updates everything, same as production.
create policy "admin reads all orders" on public.orders
  for select using (public.current_role() = 'admin');
create policy "admin updates all orders" on public.orders
  for update using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- plak_catalog_nodes (pricing/product catalog): admin gets the same write
-- access as production. Select was already open to any authenticated user.
create policy "admin writes catalog" on public.plak_catalog_nodes
  for insert with check (public.current_role() = 'admin');
create policy "admin updates catalog" on public.plak_catalog_nodes
  for update using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
create policy "admin deletes catalog" on public.plak_catalog_nodes
  for delete using (public.current_role() = 'admin');

-- catalog_reference_images: same pattern as the catalog above.
create policy "admin writes reference images" on public.catalog_reference_images
  for insert with check (public.current_role() = 'admin');
create policy "admin updates reference images" on public.catalog_reference_images
  for update using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
create policy "admin deletes reference images" on public.catalog_reference_images
  for delete using (public.current_role() = 'admin');

-- profiles: admin can read and edit every account (status, sekolah,
-- display_name). Deliberately no admin INSERT policy — new profile rows
-- are only ever created by the admin-user-ops Edge Function, which uses
-- the service_role key server-side (bypassing RLS entirely) in the same
-- request as the matching auth.users row, so account creation can never
-- happen half-done from the client.
create policy "admin reads all profiles" on public.profiles
  for select using (public.current_role() = 'admin');
create policy "admin updates all profiles" on public.profiles
  for update using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- salesman_assignments: admin manages every school<->salesman link
-- (previously only hand-editable in the Supabase dashboard).
create policy "admin reads all assignments" on public.salesman_assignments
  for select using (public.current_role() = 'admin');
create policy "admin writes assignments" on public.salesman_assignments
  for insert with check (public.current_role() = 'admin');
create policy "admin updates assignments" on public.salesman_assignments
  for update using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
create policy "admin deletes assignments" on public.salesman_assignments
  for delete using (public.current_role() = 'admin');
