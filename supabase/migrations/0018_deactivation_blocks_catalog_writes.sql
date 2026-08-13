-- QA finding BUG-002, continued: same "deactivation doesn't stop an
-- already-open tab from writing" gap, but for Production's catalog and
-- reference-image tables — orders was covered in 0017 (which also added
-- current_status()). A deactivated Production account could otherwise
-- keep editing prices or replacing reference images indefinitely.
drop policy if exists "production writes reference images" on public.catalog_reference_images;
create policy "production writes reference images" on public.catalog_reference_images
  for insert with check (public.current_role() = 'production' and public.current_status() = 'active');
drop policy if exists "production updates reference images" on public.catalog_reference_images;
create policy "production updates reference images" on public.catalog_reference_images
  for update using (public.current_role() = 'production' and public.current_status() = 'active')
  with check (public.current_role() = 'production' and public.current_status() = 'active');
drop policy if exists "production deletes reference images" on public.catalog_reference_images;
create policy "production deletes reference images" on public.catalog_reference_images
  for delete using (public.current_role() = 'production' and public.current_status() = 'active');

drop policy if exists "production writes catalog" on public.plak_catalog_nodes;
create policy "production writes catalog" on public.plak_catalog_nodes
  for insert with check (public.current_role() = 'production' and public.current_status() = 'active');
drop policy if exists "production updates catalog" on public.plak_catalog_nodes;
create policy "production updates catalog" on public.plak_catalog_nodes
  for update using (public.current_role() = 'production' and public.current_status() = 'active')
  with check (public.current_role() = 'production' and public.current_status() = 'active');
drop policy if exists "production deletes catalog" on public.plak_catalog_nodes;
create policy "production deletes catalog" on public.plak_catalog_nodes
  for delete using (public.current_role() = 'production' and public.current_status() = 'active');
