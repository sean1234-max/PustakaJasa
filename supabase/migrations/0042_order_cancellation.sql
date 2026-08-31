-- ============================================================================
-- P1: an order that will not be fulfilled has no way to be closed out, and
-- its submit-time stock deduction (plak_stock_deduct, called in
-- src/state/AppState.jsx submitOrder) is never given back. An order left
-- unapproved in 'Submitted to Sales' forever therefore holds stock forever;
-- enough of them and a Jenis Plak's stock_qty reaches 0 and the code
-- auto-hides from every teacher's New Order page (filterHiddenPlakCatalog).
--
-- This adds a terminal 'Cancelled' status. The stock is restored
-- CLIENT-SIDE by the new cancelOrder() action (it calls plak_stock_restore,
-- same pattern as rejectAddOn / the failed-insert compensation in
-- submitOrder) — there is no stock trigger anywhere in this schema and this
-- migration deliberately does not add one, to keep the "app orchestrates
-- stock, DB enforces the floor" split already in place.
--
-- Who may cancel, and from where:
--   teacher   : own order, only while 'Submitted to Sales' (before Sales acts)
--   salesman  : own order, only while 'Submitted to Sales'
--   invoicing : assigned order, only while 'Submitted to Sales'
--   admin / production : any order, any status (they already have an
--                        unconditional early return in orders_write_guard)
-- Cancelling an order that is already 'In Production' (work may have
-- started, an invoice may exist) is left to admin only, on purpose.
--
-- Once 'Cancelled' the order is frozen for every non-admin role.
-- ----------------------------------------------------------------------------

-- 1) Columns for the cancellation audit trail ------------------------------
alter table public.orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.profiles(id);

-- 2) Allow the new status value -------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('Submitted to Sales', 'In Production', 'Waiting for Delivery', 'Completed', 'Cancelled'));

-- 3) orders_write_guard() — full body carried over from 0041, with the
--    'Cancelled' rules added. Changes vs 0041:
--      * a hard stop at the top of the non-admin path: a 'Cancelled' order
--        cannot be edited by teacher / salesman / invoicing at all.
--      * teacher may move 'Submitted to Sales' -> 'Cancelled'.
--      * salesman may move 'Submitted to Sales' -> 'Cancelled' (as well as
--        -> 'In Production').
--      * invoicing may move 'Submitted to Sales' -> 'Cancelled' (as well as
--        -> 'In Production').
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

  if v_role = 'invoicing' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status in ('In Production', 'Cancelled')) then
      raise exception 'Invoicing Department can only move an order from Submitted to Sales into In Production, or cancel it.';
    end if;
    if old.status <> 'Submitted to Sales' and (
      new.items is distinct from old.items
      or new.total_amount is distinct from old.total_amount
      or new.price_adjusted is distinct from old.price_adjusted
      or new.due_date is distinct from old.due_date
      or new.function_date is distinct from old.function_date
    ) then
      raise exception 'Invoicing Department can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by') then
      raise exception 'Invoicing Department can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$$;
