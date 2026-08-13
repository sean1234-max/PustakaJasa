-- Every earlier migration opened its table to the anon key with a plain
-- `using (true)` policy — meant to keep the app working before real
-- Supabase Auth was wired in, but never tightened afterward. That means
-- anyone who extracts the public anon/publishable key from this site's JS
-- bundle (trivial — it's shipped to every visitor's browser) can read,
-- modify, or delete every order, every school's contact details, and the
-- entire pricing catalog directly via Supabase's REST API, without ever
-- logging in. RequireRole (src/components/RequireRole.jsx) only gates
-- which *pages* the React app shows — it does nothing to protect the data
-- itself, since the data was reachable by anyone regardless.
--
-- This migration replaces those blanket policies with ones scoped to the
-- logged-in user's role and ownership, matching what the app UI already
-- assumes: a teacher only touches their own orders, a salesman only their
-- assigned teachers' orders, production manages everything
-- production-related, and nobody unauthenticated can do anything at all.
--
-- Deliberately NOT touched: `teachers`, `order_items`,
-- `order_item_breakdown`, `staff` (opened up in
-- 0004_enable_rls_other_tables.sql) — those belong to a different app that
-- happens to share this Supabase project, not this school-order-app.
-- Fixing their policies needs that other app's own access model; doing it
-- here blind could break it.

-- ---------------------------------------------------------------------
-- Helpers: resolve the calling session's own role / assigned teachers
-- once, as SECURITY DEFINER so the lookup bypasses RLS internally —
-- avoids repeating a subquery in every policy below, and avoids any risk
-- of RLS on `profiles`/`salesman_assignments` recursively blocking these
-- checks. Both only ever resolve auth.uid() (the caller's own, unforgeable
-- session), so a caller can never use these to learn about another user.
-- ---------------------------------------------------------------------
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_assigned_teacher_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select teacher_id from public.salesman_assignments where salesman_id = auth.uid();
$$;

grant execute on function public.current_role() to authenticated;
grant execute on function public.my_assigned_teacher_ids() to authenticated;

-- ---------------------------------------------------------------------
-- profiles: a user may read only their own row (needed for login /
-- session restore in src/state/AppState.jsx). No client-side writes —
-- accounts are provisioned directly in the Supabase dashboard.
-- IMPORTANT: this table wasn't created by a migration in this repo, so if
-- it already carries a permissive policy under a different name than the
-- ones guessed below, that old policy won't be dropped and will keep
-- allowing full access alongside this one. After running this, check
-- Table Editor -> profiles -> RLS in the Supabase dashboard and delete any
-- leftover permissive policy by hand.
-- ---------------------------------------------------------------------
drop policy if exists "allow anon read" on public.profiles;
drop policy if exists "allow anon insert" on public.profiles;
drop policy if exists "allow anon update" on public.profiles;
drop policy if exists "allow anon delete" on public.profiles;
drop policy if exists "Enable read access for all users" on public.profiles;

create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- ---------------------------------------------------------------------
-- salesman_assignments: a salesman may read only their own assignment
-- rows. No client-side writes — managed directly in the dashboard. Same
-- "wasn't created by a migration here" caveat as profiles above applies.
-- ---------------------------------------------------------------------
drop policy if exists "allow anon read" on public.salesman_assignments;
drop policy if exists "allow anon insert" on public.salesman_assignments;
drop policy if exists "allow anon update" on public.salesman_assignments;
drop policy if exists "allow anon delete" on public.salesman_assignments;
drop policy if exists "Enable read access for all users" on public.salesman_assignments;

create policy "read own assignments" on public.salesman_assignments
  for select using (auth.uid() = salesman_id);

-- ---------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------
drop policy if exists "allow anon read" on public.orders;
drop policy if exists "allow anon insert" on public.orders;
drop policy if exists "allow anon update" on public.orders;
drop policy if exists "allow anon delete" on public.orders;

create policy "teacher reads own orders" on public.orders
  for select using (created_by = auth.uid());
create policy "salesman reads assigned orders" on public.orders
  for select using (created_by in (select public.my_assigned_teacher_ids()));
create policy "production reads all orders" on public.orders
  for select using (public.current_role() = 'production');

-- Teacher-created only, and always attributed to themselves — stops
-- anyone from inserting an order under another teacher's identity.
create policy "teacher creates own orders" on public.orders
  for insert with check (created_by = auth.uid() and public.current_role() = 'teacher');

create policy "teacher updates own orders" on public.orders
  for update using (created_by = auth.uid())
  with check (created_by = auth.uid());
create policy "salesman updates assigned orders" on public.orders
  for update using (created_by in (select public.my_assigned_teacher_ids()))
  with check (created_by in (select public.my_assigned_teacher_ids()));
create policy "production updates all orders" on public.orders
  for update using (public.current_role() = 'production')
  with check (public.current_role() = 'production');

-- No delete policy — nothing in the app deletes an order today; add one
-- explicitly (scoped) if that ever becomes a real feature.

-- ---------------------------------------------------------------------
-- catalog_reference_images: any logged-in user may view (teachers need
-- these while filling in order details); only production manages them.
-- ---------------------------------------------------------------------
drop policy if exists "allow anon read" on public.catalog_reference_images;
drop policy if exists "allow anon insert" on public.catalog_reference_images;
drop policy if exists "allow anon update" on public.catalog_reference_images;
drop policy if exists "allow anon delete" on public.catalog_reference_images;

create policy "authenticated reads reference images" on public.catalog_reference_images
  for select using (auth.role() = 'authenticated');
create policy "production writes reference images" on public.catalog_reference_images
  for insert with check (public.current_role() = 'production');
create policy "production updates reference images" on public.catalog_reference_images
  for update using (public.current_role() = 'production') with check (public.current_role() = 'production');
create policy "production deletes reference images" on public.catalog_reference_images
  for delete using (public.current_role() = 'production');

-- ---------------------------------------------------------------------
-- plak_catalog_nodes: the pricing catalog. Any logged-in user may read
-- (every role needs prices to build/review orders); only production edits.
-- ---------------------------------------------------------------------
drop policy if exists "allow anon read" on public.plak_catalog_nodes;
drop policy if exists "allow anon insert" on public.plak_catalog_nodes;
drop policy if exists "allow anon update" on public.plak_catalog_nodes;
drop policy if exists "allow anon delete" on public.plak_catalog_nodes;

create policy "authenticated reads catalog" on public.plak_catalog_nodes
  for select using (auth.role() = 'authenticated');
create policy "production writes catalog" on public.plak_catalog_nodes
  for insert with check (public.current_role() = 'production');
create policy "production updates catalog" on public.plak_catalog_nodes
  for update using (public.current_role() = 'production') with check (public.current_role() = 'production');
create policy "production deletes catalog" on public.plak_catalog_nodes
  for delete using (public.current_role() = 'production');
