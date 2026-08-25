-- Replaces the old capped school<->salesman assignment system
-- (salesman_assignments, 0019/0020/0025/0026) with: (1) a teacher can pick
-- ANY salesman when placing an order — Admin no longer manages a
-- school<->salesman relationship at all, and (2) a NEW, uncapped
-- invoicing_salesman_assignments table letting Admin assign one or more
-- salesmen to an Invoicing Department user, scoping that user's own order
-- visibility to just those salesmen's orders.

-- ---------------------------------------------------------------------
-- 1) Remove the old school<->salesman system entirely.
-- ---------------------------------------------------------------------
drop trigger if exists salesman_assignments_max_three on public.salesman_assignments;
drop function if exists public.enforce_max_salesmen_per_school();

drop policy if exists "admin reads all assignments" on public.salesman_assignments;
drop policy if exists "admin writes assignments" on public.salesman_assignments;
drop policy if exists "admin updates assignments" on public.salesman_assignments;
drop policy if exists "admin deletes assignments" on public.salesman_assignments;
drop policy if exists "read own assignments" on public.salesman_assignments;
drop policy if exists "teacher reads own assignment" on public.salesman_assignments;

-- The live project has some drift from an earlier naming generation of
-- 0010_scope_rls_by_role.sql's policies (both an old- and current-named
-- copy of the same salesman policy exist side by side) — drop both name
-- variants so this migration replays cleanly regardless of which are
-- actually present.
drop policy if exists "salesman see assigned orders" on public.orders;
drop policy if exists "salesman update assigned orders" on public.orders;

drop table if exists public.salesman_assignments;

drop function if exists public.my_assigned_salesman_ids();
drop function if exists public.my_assigned_salesman_id();

-- Teacher can now submit an order naming ANY salesman, not just a
-- pre-assigned one — still validated server-side to be a real salesman
-- account (not just any uuid).
drop policy if exists "teacher creates own orders" on public.orders;
create policy "teacher creates own orders" on public.orders
  for insert with check (
    created_by = auth.uid()
    and public.current_role() = 'teacher'
    and public.current_status() = 'active'
    and status = 'Submitted to Sales'
    and salesman_id is not null
    and exists (select 1 from public.profiles pr where pr.id = salesman_id and pr.role = 'salesman')
  );

-- Teacher needs to read every salesman's display_name to populate the
-- picker now (not just a pre-assigned one) — low-sensitivity data, safe
-- to broaden to any authenticated user.
drop policy if exists "teacher reads assigned salesman profile" on public.profiles;
create policy "authenticated reads salesman profiles" on public.profiles
  for select using (auth.role() = 'authenticated' and role = 'salesman');

-- ---------------------------------------------------------------------
-- 2) Salesman's own order visibility used to be derived from
-- salesman_assignments (which teachers were assigned to them) — now that
-- a teacher names their salesman directly per order, the correct source
-- of truth is each order's own salesman_id.
-- ---------------------------------------------------------------------
drop policy if exists "salesman reads assigned orders" on public.orders;
drop policy if exists "salesman updates assigned orders" on public.orders;
create policy "salesman reads own orders" on public.orders
  for select using (salesman_id = auth.uid());
create policy "salesman updates own orders" on public.orders
  for update using (salesman_id = auth.uid())
  with check (salesman_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3) New: Invoicing Department user <-> Salesman assignment (many-to-many,
-- no cap — one invoicing user can be assigned any number of salesmen).
-- ---------------------------------------------------------------------
create table public.invoicing_salesman_assignments (
  invoicing_id uuid not null,
  salesman_id uuid not null,
  unique (invoicing_id, salesman_id)
);
alter table public.invoicing_salesman_assignments enable row level security;

create policy "admin reads invoicing assignments" on public.invoicing_salesman_assignments
  for select using (public.current_role() = 'admin');
create policy "admin writes invoicing assignments" on public.invoicing_salesman_assignments
  for insert with check (public.current_role() = 'admin');
create policy "admin deletes invoicing assignments" on public.invoicing_salesman_assignments
  for delete using (public.current_role() = 'admin');
create policy "invoicing reads own assignments" on public.invoicing_salesman_assignments
  for select using (invoicing_id = auth.uid());

create or replace function public.my_assigned_invoicing_salesman_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select salesman_id from public.invoicing_salesman_assignments where invoicing_id = auth.uid();
$$;
grant execute on function public.my_assigned_invoicing_salesman_ids() to authenticated;

-- Invoicing's own order visibility (0038_invoicing_can_approve.sql) is now
-- scoped to only the salesmen assigned to them, same shape as Salesman's
-- own scoping above.
drop policy if exists "invoicing reads all orders" on public.orders;
drop policy if exists "invoicing updates all orders" on public.orders;
create policy "invoicing reads assigned salesman orders" on public.orders
  for select using (
    public.current_role() = 'invoicing'
    and salesman_id in (select public.my_assigned_invoicing_salesman_ids())
  );
create policy "invoicing updates assigned salesman orders" on public.orders
  for update using (
    public.current_role() = 'invoicing'
    and salesman_id in (select public.my_assigned_invoicing_salesman_ids())
  ) with check (
    public.current_role() = 'invoicing'
    and salesman_id in (select public.my_assigned_invoicing_salesman_ids())
  );
