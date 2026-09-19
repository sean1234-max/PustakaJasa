-- Urgent-order tracking (see src/utils/urgentOrder.js): an order is
-- "urgent" if fewer than 5 Mon-Fri working days separate the moment its
-- Shipment Date is first saved (approval time — see approveOrder /
-- approveAndSetInvoiceId in src/state/AppState.jsx) from that Shipment
-- Date. Snapshotted once there; never recomputed afterward even if the
-- date is later edited — immutability is by convention only (never
-- included in a later updateOrder(...) patch), same as id/created_by/
-- snapshot today.
--
-- urgent_sheet_synced_at: null until the one-time Google Sheets append
-- (Store Admin's Invoice Number save, only for urgent orders) succeeds.
-- Doubles as the idempotency guard (never append twice) and the
-- persisted "still needs syncing" flag the retry UI reads.
alter table public.orders
  add column urgent boolean not null default false,
  add column urgent_sheet_synced_at timestamptz;

-- orders_write_guard's store_admin branch (unlike the salesman branch,
-- which fully bypasses its own allow-list check while old.status =
-- 'Submitted to Sales') runs its column-diff check unconditionally on
-- every store_admin update. Without adding 'urgent'/'urgent_sheet_synced_at'
-- to its exclusion lists, both approveAndSetInvoiceId (which sets urgent
-- alongside invoice_id) and the later "mark synced" update would trip
-- "Store Admin can only set the Invoice Number...". Everything else in
-- this function is identical to 0065's version.
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
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$function$;
