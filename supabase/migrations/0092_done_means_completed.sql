-- Production's Done now makes an order 'Completed' straight away (Sean,
-- 2026-10-14): no more Waiting for Shipment / Shipped stages, so every order
-- still in one of them becomes Completed now, and the daily Shipment-Date
-- sweep (0056 / 0077) is retired. The status check constraint keeps the old
-- names, so this is reversible.
begin;

-- Like the old sweep: skip orders_write_guard / stamp triggers for this bulk move.
set local session_replication_role = replica;

update public.orders
   set status = 'Completed'
 where status in ('Waiting for Shipment', 'Shipped');

update public.orders o
   set invoice_groups = sub.new_groups
  from (
    select o2.id,
           jsonb_agg(
             case when (g ->> 'status') in ('Waiting for Shipment', 'Shipped')
                  then g || jsonb_build_object('status', 'Completed')
                  else g end
             order by ord
           ) as new_groups
      from public.orders o2, jsonb_array_elements(o2.invoice_groups) with ordinality as t(g, ord)
     where jsonb_array_length(o2.invoice_groups) > 0
     group by o2.id
  ) sub
 where o.id = sub.id
   and sub.new_groups is distinct from o.invoice_groups;

set local session_replication_role = default;

select cron.unschedule('sweep-shipped-orders');
drop function if exists public.sweep_shipped_orders();

commit;
