-- ============================================================================
-- Date-driven tail of the order pipeline: 'Shipped' + auto-'Completed'.
--
-- Until now Production's "Mark as Done" only ever set 'Waiting for Delivery',
-- and 'Completed' was defined but never set by anything. Now the last three
-- stages follow the order's Shipment Date (orders.due_date) purely from the
-- calendar:
--     Shipment Date in the future -> 'Waiting for Delivery'
--     Shipment Date is today       -> 'Shipped'
--     Shipment Date has passed     -> 'Completed'
-- markProductionDone (src/state/AppState.jsx, via deliveryStageForShipmentDate
-- in src/data/catalog.js) applies this at the moment Done is clicked; the
-- daily sweep_shipped_orders() job below advances orders whose date arrives
-- while they're already sitting in 'Waiting for Delivery' / 'Shipped'.
-- 'Completed' is terminal — the sweep never touches it.
-- ----------------------------------------------------------------------------

-- 1) Allow the new status ---------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in (
    'Submitted to Sales', 'In Production', 'Waiting for Delivery',
    'Shipped', 'Completed', 'Cancelled'
  ));

-- 2) The daily sweep ------------------------------------------------------
-- Runs with no JWT (pg_cron executes it as `postgres`), so orders_write_guard
-- would reject every row. `SET LOCAL session_replication_role = replica`
-- suppresses triggers for the rest of this transaction — these writes are the
-- calendar advancing, not a user acting — and is undone when the transaction
-- ends (the cron job's own transaction, or a rollback if an UPDATE raises).
-- due_date is free-form text (0001/0002) but every create/approve path writes
-- it from a JS Date, i.e. an ISO string; the regex skips anything else (e.g.
-- a stray 'TBD').
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

  set local session_replication_role = default;
end;
$$;

-- Nobody but the scheduler (and a manual `postgres` run) should call this.
revoke execute on function public.sweep_shipped_orders() from public, anon, authenticated;

-- 3) Schedule it ----------------------------------------------------------
-- 16:05 UTC == 00:05 Malaysia time, so "today" is fresh when it runs.
create extension if not exists pg_cron;

select cron.unschedule('sweep-shipped-orders')
where exists (select 1 from cron.job where jobname = 'sweep-shipped-orders');

select cron.schedule(
  'sweep-shipped-orders',
  '5 16 * * *',
  $$select public.sweep_shipped_orders()$$
);

-- 4) One-time backfill of orders already past their dates ----------------
select public.sweep_shipped_orders();
