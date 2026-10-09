-- Sean, 2026-10-09:
--  * Update Details stays open to the teacher (and the salesman) until the
--    salesman approves — but changing the items/total of an order Production
--    already reviewed sends it back for review (reviewed_at cleared).
--  * An add-on (teacher's or salesman's) is reviewed by Production first:
--    pending → reviewed (Production only) → the salesman approves it.

alter table public.orders drop constraint orders_pending_addon_status_check;
alter table public.orders add constraint orders_pending_addon_status_check
  check (pending_addon_status is null or pending_addon_status in ('pending', 'reviewed', 'rejected'));

create or replace function public.orders_write_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text := public.current_role();
  v_status text := public.current_status();
begin
  if v_status is distinct from 'active' then
    raise exception 'Your account is not active.';
  end if;

  -- Admin / Production keep their "fix the data" latitude (Production also
  -- sets reviewed_at — Done Review — reviews add-ons, and edits the order).
  if v_role in ('admin', 'production') then
    return new;
  end if;

  if old.status = 'Cancelled' then
    raise exception 'This order has been cancelled and can no longer be edited.';
  end if;

  -- Only Production marks an order reviewed; anyone may clear it (an edit
  -- sends the order back for review).
  if new.reviewed_at is distinct from old.reviewed_at and new.reviewed_at is not null then
    raise exception 'Only Production can mark an order as reviewed.';
  end if;

  if new.typed_at is distinct from old.typed_at then
    raise exception 'Only Production can mark typing as done.';
  end if;

  if new.pending_addon_status = 'reviewed' and old.pending_addon_status is distinct from 'reviewed' then
    raise exception 'Only Production can review an add-on.';
  end if;

  -- Changing what a reviewed order contains needs Production to review it
  -- again.
  if old.status = 'Reviewing Order' and new.status = 'Reviewing Order'
     and old.reviewed_at is not null and new.reviewed_at is not null
     and (new.items is distinct from old.items or new.total_amount is distinct from old.total_amount) then
    raise exception 'This order was already reviewed — changing it sends it back to Production for review.';
  end if;

  if v_role = 'teacher' then
    if new.status is distinct from old.status
       and not (old.status = 'Reviewing Order' and new.status = 'Cancelled') then
      raise exception 'Teachers cannot change an order''s status.';
    end if;
    if old.status = 'Reviewing Order' then
      return new;
    end if;
    if old.status in ('Salesman Approved', 'In Production') then
      if (to_jsonb(new)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at')
         is distinct from
         (to_jsonb(old)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at')
      then
        raise exception 'This order is already approved — submit an Add-On to change it.';
      end if;
      return new;
    end if;
    raise exception 'This order can no longer be edited.';
  end if;

  if v_role = 'salesman' then
    if new.status is distinct from old.status
       and not (old.status = 'Reviewing Order' and new.status = 'Cancelled')
       and not (old.status = 'Reviewing Order' and new.status = 'Salesman Approved' and old.reviewed_at is not null) then
      raise exception 'Salesmen can approve an order only after Production has reviewed it, or cancel it.';
    end if;
    if old.status = 'Reviewing Order' then
      return new;
    end if;
    -- Approving an add-on (its items merged in) only once Production
    -- reviewed it.
    if old.pending_addon_status in ('pending', 'reviewed') then
      if new.items is distinct from old.items and old.pending_addon_status is distinct from 'reviewed' then
        raise exception 'Production has to review this add-on before it can be approved.';
      end if;
      return new;
    end if;
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
       and not (old.status = 'Reviewing Order' and new.status = 'Cancelled')
       and not (old.status = 'Reviewing Order' and new.status = 'In Production' and old.reviewed_at is not null)
       and not (old.status = 'Salesman Approved' and new.status = 'In Production') then
      raise exception 'Store Admin can open the invoice of a Salesman Approved order, approve a reviewed order and open its invoice in one go, or cancel an order still being reviewed.';
    end if;
    if old.status <> 'Reviewing Order' and (
      new.items is distinct from old.items
      or new.total_amount is distinct from old.total_amount
      or new.price_adjusted is distinct from old.price_adjusted
      or new.shipment_date is distinct from old.shipment_date
      or new.function_date is distinct from old.function_date
      or new.salesman_delivery is distinct from old.salesman_delivery
    ) then
      raise exception 'Store Admin can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at' - 'salesman_delivery')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at' - 'salesman_delivery') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$function$;
