-- ============================================================================
-- P1 SECURITY: freeze a salesman's own order once it's approved, the same
-- way the teacher (0041) and Store Admin (0042/0047) branches already are.
--
-- Before this, the `salesman` branch of orders_write_guard() did an
-- unconditional `return new` after the status check — so a crafted request
-- from a salesman account could rewrite `items` / `total_amount` /
-- `due_date` / `invoice_id` on their own order while it was already In
-- Production or Completed (e.g. lower the price of an approved order). The
-- UI never exposes that, and orders_amount_guard (0041) still forces
-- items <-> total to add up, but there was no policy stopping it.
--
-- Full body carried over VERBATIM from the live 0047 definition; ONLY the
-- `salesman` branch changes. A salesman keeps full latitude before
-- approval (approve with negotiated pricing/dates) and while an add-on is
-- pending — approveAddOn / rejectAddOn (src/state/AppState.jsx) legitimately
-- fold a Sales-reviewed add-on into `items` + `total_amount`.
-- ----------------------------------------------------------------------------
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

    -- Full latitude before approval, and while an add-on is pending
    -- (approveAddOn / rejectAddOn resolve it and rewrite items + total).
    if old.status = 'Submitted to Sales' or old.pending_addon_status = 'pending' then
      return new;
    end if;

    -- Approved order: frozen for the salesman the same way it is for the
    -- teacher — only the add-on holding columns, the print stamp and status
    -- may move. A real change goes through an Add-On.
    if (to_jsonb(new)
          - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
          - 'printed_at' - 'status')
       is distinct from
       (to_jsonb(old)
          - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
          - 'printed_at' - 'status')
    then
      raise exception 'This order is already approved — changes go through an Add-On.';
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

revoke execute on function public.orders_write_guard() from public, anon, authenticated;
