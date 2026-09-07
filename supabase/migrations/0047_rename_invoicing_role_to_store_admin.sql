-- ============================================================================
-- Rebrand the "Invoicing Department" role to "Store Admin".
--
-- ONLY the role STRING value changes: profiles.role 'invoicing' -> 'store_admin',
-- the role_check constraint, the orders_write_guard() branch, and the two
-- role-scoped orders policies. The invoice-number feature (orders.invoice_id,
-- setInvoiceId) is a separate domain concept and is untouched.
--
-- Deliberately NOT renamed (internal plumbing, never user-visible — renaming
-- would force a coordinated admin-user-ops Edge Function redeploy for no
-- functional gain):
--   * table  public.invoicing_salesman_assignments
--   * column invoicing_id
--   * function public.my_assigned_invoicing_salesman_ids()
--   * the 4 policies on invoicing_salesman_assignments (none test the role
--     STRING — "admin ..." tests 'admin'; "invoicing reads own assignments"
--     is `invoicing_id = auth.uid()`), so they keep working as-is.
--
-- Coordinated deploy: this migration + the new frontend bundle + the
-- admin-user-ops Edge Function (VALID_ROLES) must ship together, and any
-- logged-in Store Admin must re-login afterward.
-- ----------------------------------------------------------------------------

-- Written to be idempotent — the live DB was already migrated to this state
-- out-of-band, so `if exists` / `or replace` throughout lets this replay
-- cleanly for a fresh environment without erroring on what's already there.

-- 1) Role value + check constraint --------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles set role = 'store_admin' where role = 'invoicing';

alter table public.profiles add constraint profiles_role_check
  check (role in ('teacher', 'salesman', 'production', 'admin', 'store_admin'));

-- 2) orders_write_guard() — full body carried over verbatim from
--    0042_order_cancellation.sql, with the 'invoicing' branch renamed to
--    'store_admin' and its three error strings reworded. Nothing else changes.
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

  if old.status = 'Cancelled' then
    raise exception 'This order has been cancelled and can no longer be edited.';
  end if;

  if v_role = 'teacher' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status = 'Cancelled') then
      raise exception 'Teachers cannot change an order''s status.';
    end if;

    if old.status = 'Submitted to Sales' then
      return new;
    end if;

    if old.status = 'In Production' then
      if (to_jsonb(new)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at')
         is distinct from
         (to_jsonb(old)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at')
      then
        raise exception 'This order is already in production — submit an Add-On to change it.';
      end if;
      return new;
    end if;

    raise exception 'This order can no longer be edited.';
  end if;

  if v_role = 'salesman' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status in ('In Production', 'Cancelled')) then
      raise exception 'Salesmen can only move an order from Submitted to Sales into In Production, or cancel it.';
    end if;
    return new;
  end if;

  if v_role = 'store_admin' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status in ('In Production', 'Cancelled')) then
      raise exception 'Store Admin can only move an order from Submitted to Sales into In Production, or cancel it.';
    end if;
    if old.status <> 'Submitted to Sales' and (
      new.items is distinct from old.items
      or new.total_amount is distinct from old.total_amount
      or new.price_adjusted is distinct from old.price_adjusted
      or new.due_date is distinct from old.due_date
      or new.function_date is distinct from old.function_date
    ) then
      raise exception 'Store Admin can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$$;

-- create-or-replace preserves privileges, but mirror 0044's lockdown to be
-- explicit (the trigger is invoked BY Postgres, never called directly).
revoke execute on function public.orders_write_guard() from public, anon, authenticated;

-- 3) orders RLS policies — same scoping as 0039's "invoicing ..." pair
--    (assigned-salesman visibility), just keyed on the new role string. The
--    my_assigned_invoicing_salesman_ids() call is intentionally unchanged.
drop policy if exists "invoicing reads assigned salesman orders" on public.orders;
drop policy if exists "invoicing updates assigned salesman orders" on public.orders;
drop policy if exists "store_admin reads assigned salesman orders" on public.orders;
drop policy if exists "store_admin updates assigned salesman orders" on public.orders;

create policy "store_admin reads assigned salesman orders" on public.orders
  for select using (
    public.current_role() = 'store_admin'
    and salesman_id in (select public.my_assigned_invoicing_salesman_ids())
  );
create policy "store_admin updates assigned salesman orders" on public.orders
  for update using (
    public.current_role() = 'store_admin'
    and salesman_id in (select public.my_assigned_invoicing_salesman_ids())
  ) with check (
    public.current_role() = 'store_admin'
    and salesman_id in (select public.my_assigned_invoicing_salesman_ids())
  );
