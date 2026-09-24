-- ============================================================================
-- A split order's invoices (orders.invoice_groups, 0070) used to share one
-- production/delivery status: orders.status. Marking one invoice "Done" on
-- the Production dashboard (markProductionDone, AppState.jsx) moved the
-- WHOLE order — every other invoice's card jumped along with it, which is
-- wrong once billing has actually been split across invoices that ship
-- independently.
--
-- No schema change needed on `orders` — invoice_groups is already jsonb, so
-- each group entry can just carry its own `status` key going forward
-- (written by the app; absent on a group that's never been marked done
-- independently, which then simply falls back to the order's own status,
-- see getOrderInvoiceSlices in src/utils/orderBatches.js). This migration
-- only needs to teach the daily calendar sweep to advance those per-group
-- statuses too, the same Waiting for Delivery -> Shipped -> Completed rule
-- it already applies to orders.status, off the SAME order-level Shipment
-- Date (due_date) — there's still only one ship date per order, just
-- independent statuses per invoice now.
-- ----------------------------------------------------------------------------
create or replace function public.sweep_shipped_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  set local session_replication_role = replica;

  update public.orders
     set status = 'Completed'
   where status in ('Waiting for Delivery', 'Shipped')
     and due_date ~ '^\d{4}-\d\d-\d\d'
     and (due_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date < v_today;

  update public.orders
     set status = 'Shipped'
   where status = 'Waiting for Delivery'
     and due_date ~ '^\d{4}-\d\d-\d\d'
     and (due_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date = v_today;

  -- Same two rules, applied per invoice_groups[] entry's own `status`.
  -- Only orders whose recomputed array actually differs get written, so a
  -- split order with nothing due to advance (or an order with no split at
  -- all — invoice_groups = '[]') is left untouched.
  update public.orders o
     set invoice_groups = sub.new_groups
    from (
      select o2.id,
             jsonb_agg(
               case
                 when (g ->> 'status') in ('Waiting for Delivery', 'Shipped')
                      and o2.due_date ~ '^\d{4}-\d\d-\d\d'
                      and (o2.due_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date < v_today
                   then g || jsonb_build_object('status', 'Completed')
                 when (g ->> 'status') = 'Waiting for Delivery'
                      and o2.due_date ~ '^\d{4}-\d\d-\d\d'
                      and (o2.due_date::timestamptz at time zone 'Asia/Kuala_Lumpur')::date = v_today
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
$$;

-- One-time catch-up, same as 0056 did on its own introduction.
select public.sweep_shipped_orders();
