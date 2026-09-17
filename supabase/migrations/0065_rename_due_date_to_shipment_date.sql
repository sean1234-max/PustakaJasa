-- `due_date` was always the Shipment Date (when the plaques ship out) —
-- the "Shipment Date" label has been used everywhere in the UI since it
-- was added, but the column/field name never caught up, which made the
-- code read like there were two different date concepts. Pure rename, no
-- type or behavior change: still text, still whatever format each write
-- site already produces (ISO timestamp strings from JS Date objects).
--
-- Two functions reference the column by name in their body and need
-- updating in the same transaction as the rename, or the very next order
-- update / daily sweep would break:
--   - orders_write_guard() (trigger — Store Admin's pre-approval date-edit
--     check, and the two to_jsonb() "what else changed" exclusion lists)
--   - sweep_shipped_orders() (daily cron job advancing Waiting for
--     Delivery -> Shipped -> Completed by calendar date)
-- Every other reference across the app was to `orders.due_date` as plain
-- column data (reads/writes through PostgREST), which doesn't need a
-- database-side change — see the matching src/ rename in this commit.

alter table public.orders rename column due_date to shipment_date;

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

  if v_role in ('admin', 'production') then
    return new;
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
    if old.status = 'Submitted to Sales' or old.pending_addon_status = 'pending' then
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
       and not (old.status = 'Submitted to Sales' and new.status in ('In Production', 'Cancelled')) then
      raise exception 'Store Admin can only move an order from Submitted to Sales into In Production, or cancel it.';
    end if;
    if old.status <> 'Submitted to Sales' and (
      new.items is distinct from old.items
      or new.total_amount is distinct from old.total_amount
      or new.price_adjusted is distinct from old.price_adjusted
      or new.shipment_date is distinct from old.shipment_date
      or new.function_date is distinct from old.function_date
    ) then
      raise exception 'Store Admin can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$function$;

create or replace function public.sweep_shipped_orders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  set local session_replication_role = replica;

  update public.orders
     set status = 'Completed'
   where status in ('Waiting for Delivery', 'Shipped')
     and shipment_date ~ '^\d{4}-\d\d-\d\d'
     and (shipment_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date < v_today;

  update public.orders
     set status = 'Shipped'
   where status = 'Waiting for Delivery'
     and shipment_date ~ '^\d{4}-\d\d-\d\d'
     and (shipment_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date = v_today;

  set local session_replication_role = default;
end;
$function$;
