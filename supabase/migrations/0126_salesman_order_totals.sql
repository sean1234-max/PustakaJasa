-- Admin Salesmen page (Sean, 2026-11-12): each salesman's Total Orders, Total Sales (every order but Cancelled),
-- Pending (Reviewing Order) and Completed, summed in the database — the page polls it, so the ranking stays live,
-- and it isn't cut short by fetchOrders' 500-order window. Admin only: anyone else gets no rows.

create or replace function public.salesman_order_totals()
returns table(salesman_id uuid, total_orders integer, total_sales numeric, pending integer, completed integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  select o.salesman_id,
         count(*)::integer,
         coalesce(sum(o.total_amount) filter (where o.status <> 'Cancelled'), 0)::numeric,
         (count(*) filter (where o.status = 'Reviewing Order'))::integer,
         (count(*) filter (where o.status = 'Completed'))::integer
  from public.orders o
  where public.current_role() = 'admin'
    and o.salesman_id is not null
  group by o.salesman_id;
$function$;

revoke all on function public.salesman_order_totals() from public, anon;
grant execute on function public.salesman_order_totals() to authenticated;
