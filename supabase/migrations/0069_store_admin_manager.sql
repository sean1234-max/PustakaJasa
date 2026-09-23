-- ============================================================================
-- Store Admin Manager tier — mirrors 0048_sales_manager.sql exactly, for the
-- store_admin role instead of salesman. A store_admin flagged
-- `is_store_admin_manager` can SEE every order (all salesmen's), not just
-- the ones assigned to them via invoicing_salesman_assignments — for
-- oversight. Deliberately view-only: no matching UPDATE policy, so
-- "update access" (0064) stays the write rule (still scoped to assigned
-- salesmen only).
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_store_admin_manager boolean not null default false;

-- Only a store_admin can hold the flag.
alter table public.profiles drop constraint if exists profiles_store_admin_manager_is_store_admin;
alter table public.profiles add constraint profiles_store_admin_manager_is_store_admin
  check (not is_store_admin_manager or role = 'store_admin');

create or replace function public.is_store_admin_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_store_admin_manager from public.profiles where id = auth.uid()), false);
$$;
revoke execute on function public.is_store_admin_manager() from public, anon;
grant execute on function public.is_store_admin_manager() to authenticated;

create policy "store admin manager reads all orders" on public.orders
  for select using (
    public.current_role() = 'store_admin' and public.is_store_admin_manager()
  );
