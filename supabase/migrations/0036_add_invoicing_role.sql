-- New role: Invoicing Department. Assigns/tracks Invoice Numbers after
-- Salesman approval — a responsibility Production previously owned (see
-- src/pages/ProductionOrderDetail.jsx before this change) but no longer
-- needs to, so Production can open an approved order and start work
-- immediately without waiting on an invoice number.

-- 1) Widen the role enum (mirrors 0016_allow_admin_role.sql's own pattern).
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('teacher', 'salesman', 'production', 'admin', 'invoicing'));

-- 2) Column-write guard: Invoicing Department may change invoice_id and
-- nothing else on an order — mirrors the restricted teacher/salesman
-- branches in orders_write_guard() (0017_order_status_guard.sql), not the
-- unconditional admin/production pass-through. Comparing the whole row as
-- jsonb (minus invoice_id) rather than hand-listing every other column
-- keeps this correct automatically as the table gains columns later.
create or replace function public.orders_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role();
  v_status text := public.current_status();
begin
  if v_role in ('admin', 'production') then
    return new;
  end if;

  if v_status is distinct from 'active' then
    raise exception 'Your account is not active.';
  end if;

  if v_role = 'teacher' then
    if new.status is distinct from old.status then
      raise exception 'Teachers cannot change an order''s status.';
    end if;
    if old.status not in ('Submitted to Sales', 'In Production') then
      raise exception 'This order can no longer be edited.';
    end if;
    return new;
  end if;

  if v_role = 'salesman' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status = 'In Production') then
      raise exception 'Salesmen can only move an order from Submitted to Sales into In Production.';
    end if;
    return new;
  end if;

  if v_role = 'invoicing' then
    if (to_jsonb(new) - 'invoice_id') is distinct from (to_jsonb(old) - 'invoice_id') then
      raise exception 'Invoicing Department can only set the Invoice Number.';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$$;

-- 3) RLS: Invoicing Department needs to see every order once it's past
-- Sales (so it can assign/search invoices and review history), and needs
-- an UPDATE policy to reach the trigger above at all (RLS is checked
-- before the trigger, not instead of it — the trigger is the one that
-- actually restricts which columns change).
create policy "invoicing reads approved orders" on public.orders
  for select using (
    public.current_role() = 'invoicing' and status <> 'Submitted to Sales'
  );
create policy "invoicing updates approved orders" on public.orders
  for update using (
    public.current_role() = 'invoicing' and status <> 'Submitted to Sales'
  ) with check (
    public.current_role() = 'invoicing' and status <> 'Submitted to Sales'
  );
