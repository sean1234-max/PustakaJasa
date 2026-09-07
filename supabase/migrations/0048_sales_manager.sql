-- ============================================================================
-- Sales Manager tier. A salesman flagged `is_sales_manager` can SEE every
-- order (all salesmen's), not just their own — for oversight. They still
-- only ACT on their own orders: there's deliberately no matching UPDATE
-- policy, so "salesman updates own orders" (0039) stays the write rule.
--
-- Admin toggles the flag from the salesman detail / Users page (a plain
-- profiles UPDATE — admin already has full update RLS on profiles, 0015).
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_sales_manager boolean not null default false;

-- Only a salesman can hold the flag.
alter table public.profiles drop constraint if exists profiles_sales_manager_is_salesman;
alter table public.profiles add constraint profiles_sales_manager_is_salesman
  check (not is_sales_manager or role = 'salesman');

-- security definer so the orders policy below can consult it without the
-- caller needing their own SELECT on the profiles row.
create or replace function public.is_sales_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_sales_manager from public.profiles where id = auth.uid()), false);
$$;
revoke execute on function public.is_sales_manager() from public, anon;
grant execute on function public.is_sales_manager() to authenticated;

drop policy if exists "sales manager reads all orders" on public.orders;
create policy "sales manager reads all orders" on public.orders
  for select using (
    public.current_role() = 'salesman' and public.is_sales_manager()
  );
