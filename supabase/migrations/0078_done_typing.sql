-- Production's "Done Typing" (Sean, 2026-10-03). After the Invoice Number,
-- Production generates the AI file and clicks Done Typing; the Production
-- head then prints the typed orders and clicks Done (→ Waiting for
-- Shipment). The status stays 'In Production' the whole time — only
-- Production's own screens split it (typed_at null = "Typing"); every other
-- user just sees In Production. A split invoice's own typedAt lives in its
-- invoice_groups entry (set from the browser by Production).

begin;

alter table public.orders add column if not exists typed_at timestamptz;

-- Orders already In Production count as typed (Sean). No trigger: there's no
-- signed-in user during a migration.
set local session_replication_role = replica;
update public.orders set typed_at = now() where status = 'In Production' and typed_at is null;
set local session_replication_role = default;

-- A new order starts untyped (as 0077, plus typed_at).
drop policy "teacher creates own orders" on public.orders;
create policy "teacher creates own orders" on public.orders for insert with check (
  created_by = (select auth.uid())
  and public.current_role() = 'teacher'
  and public.current_status() = 'active'
  and status = 'Reviewing Order'
  and reviewed_at is null
  and typed_at is null
  and salesman_id is not null
  and exists (select 1 from public.profiles pr where pr.id = orders.salesman_id and pr.role = 'salesman')
);

-- Same guard as 0077, plus: only admin / Production may set typed_at.
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
  -- sets reviewed_at — Done Review — and edits the order while reviewing).
  if v_role in ('admin', 'production') then
    return new;
  end if;

  if old.status = 'Cancelled' then
    raise exception 'This order has been cancelled and can no longer be edited.';
  end if;

  if new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Only Production can mark an order as reviewed.';
  end if;

  if new.typed_at is distinct from old.typed_at then
    raise exception 'Only Production can mark typing as done.';
  end if;

  if v_role = 'teacher' then
    if new.status is distinct from old.status
       and not (old.status = 'Reviewing Order' and new.status = 'Cancelled') then
      raise exception 'Teachers cannot change an order''s status.';
    end if;
    if old.status = 'Reviewing Order' then
      -- Update Details until Production's Done Review; after that only
      -- printing and cancelling.
      if old.reviewed_at is null then
        return new;
      end if;
      if (to_jsonb(new) - 'printed_at' - 'status' - 'cancel_reason' - 'cancelled_at' - 'cancelled_by')
         is distinct from
         (to_jsonb(old) - 'printed_at' - 'status' - 'cancel_reason' - 'cancelled_at' - 'cancelled_by')
      then
        raise exception 'Production has already reviewed this order — ask Production to change it.';
      end if;
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
    if old.status = 'Reviewing Order' or old.pending_addon_status = 'pending' then
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
    ) then
      raise exception 'Store Admin can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$function$;

commit;
