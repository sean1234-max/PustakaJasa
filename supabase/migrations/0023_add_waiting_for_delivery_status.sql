-- Production had no way to signal "physically finished, ready to hand off
-- to delivery" — src/pages/ProductionOrderDetail.jsx only let Production
-- enter an Invoice Number and export CSV, nothing ever advanced
-- `orders.status` past 'In Production'. The pipeline already reserved a
-- next-stage slot for this ('Out for Delivery', see 0017), but no code
-- anywhere in this app ever set it, so nothing observable regresses by
-- renaming that unused slot to 'Waiting for Delivery' to back the new
-- Production "Mark as Done" button (src/pages/ProductionOrderDetail.jsx).
-- The UPDATE first is a defensive backfill in case any row was ever hand-set
-- to the old label directly in the Supabase dashboard.

update public.orders set status = 'Waiting for Delivery' where status = 'Out for Delivery';

alter table public.orders drop constraint orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('Submitted to Sales', 'In Production', 'Waiting for Delivery', 'Completed'));
