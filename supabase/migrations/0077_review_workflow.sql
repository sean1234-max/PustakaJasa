-- Production review step (Sean, 2026-10-02). New pipeline:
--   Reviewing Order → (Production: Done Review) → Salesman Approved →
--   (Store Admin: Invoice Number) → In Production → (Production: Done) →
--   Waiting for Shipment → Shipped → Completed   (+ Cancelled)
-- • 'Submitted to Sales' is renamed 'Reviewing Order'; `reviewed_at` is set
--   by Production's "Done Review" (the order stays 'Reviewing Order', shown
--   with a ✓ Review Done mark).
-- • Sales can approve only a reviewed order → 'Salesman Approved' (new).
-- • Store Admin's Invoice Number moves Salesman Approved → In Production;
--   its paper-copy shortcut (approve + invoice in one go) still exists but
--   also needs the review first.
-- • A teacher's Update Details stops at Done Review.
-- • 'Waiting for Delivery' is renamed 'Waiting for Shipment'.

begin;

-- The data fixes below must not trip orders_write_guard (no signed-in user
-- during a migration).
set local session_replication_role = replica;

alter table public.orders drop constraint orders_status_check;
alter table public.orders add column if not exists reviewed_at timestamptz;

update public.orders set status = 'Reviewing Order' where status = 'Submitted to Sales';
-- Approved but no Invoice Number yet = Salesman Approved under the new flow.
update public.orders set status = 'Salesman Approved' where status = 'In Production' and invoice_id is null;
update public.orders set status = 'Waiting for Shipment' where status = 'Waiting for Delivery';
update public.orders o
   set invoice_groups = (
     select jsonb_agg(case when g ->> 'status' = 'Waiting for Delivery'
                           then g || jsonb_build_object('status', 'Waiting for Shipment') else g end
                      order by ord)
       from jsonb_array_elements(o.invoice_groups) with ordinality as t(g, ord))
 where o.invoice_groups::text like '%Waiting for Delivery%';

alter table public.orders add constraint orders_status_check check (status = any (array[
  'Reviewing Order', 'Salesman Approved', 'In Production', 'Waiting for Shipment', 'Shipped', 'Completed', 'Cancelled'
]));

set local session_replication_role = default;

drop policy "teacher creates own orders" on public.orders;
create policy "teacher creates own orders" on public.orders for insert with check (
  created_by = (select auth.uid())
  and public.current_role() = 'teacher'
  and public.current_status() = 'active'
  and status = 'Reviewing Order'
  and reviewed_at is null
  and salesman_id is not null
  and exists (select 1 from public.profiles pr where pr.id = orders.salesman_id and pr.role = 'salesman')
);

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

-- Daily Shipped/Completed sweep: same rules, renamed status.
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
   where status in ('Waiting for Shipment', 'Shipped')
     and shipment_date ~ '^\d{4}-\d\d-\d\d'
     and (shipment_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date < v_today;

  update public.orders
     set status = 'Shipped'
   where status = 'Waiting for Shipment'
     and shipment_date ~ '^\d{4}-\d\d-\d\d'
     and (shipment_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date = v_today;

  -- Same two rules, applied per invoice_groups[] entry's own `status`.
  update public.orders o
     set invoice_groups = sub.new_groups
    from (
      select o2.id,
             jsonb_agg(
               case
                 when (g ->> 'status') in ('Waiting for Shipment', 'Shipped')
                      and o2.shipment_date ~ '^\d{4}-\d\d-\d\d'
                      and (o2.shipment_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date < v_today
                   then g || jsonb_build_object('status', 'Completed')
                 when (g ->> 'status') = 'Waiting for Shipment'
                      and o2.shipment_date ~ '^\d{4}-\d\d-\d\d'
                      and (o2.shipment_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date = v_today
                   then g || jsonb_build_object('status', 'Shipped')
                 else g
               end
               order by ord
             ) as new_groups
        from public.orders o2, jsonb_array_elements(o2.invoice_groups) with ordinality as t(g, ord)
       where jsonb_array_length(o2.invoice_groups) > 0
       group by o2.id
    ) sub
   where o.id = sub.id
     and sub.new_groups is distinct from o.invoice_groups;

  set local session_replication_role = default;
end;
$function$;

commit;
