-- A teacher can pick ANY salesman when submitting an order (0039) — so a
-- mis-click (or genuinely not knowing which salesman covers their school)
-- can land an order on the wrong one. The RLS "update access" policy
-- (0064) deliberately blocks a salesman from ever changing an order's own
-- salesman_id: its WITH CHECK still requires salesman_id = auth.uid() on
-- the RESULTING row, so a plain client-side update can't hand an order off
-- to someone else. This RPC is the one narrow, audited way to do that on
-- purpose — only the salesman who currently owns the order (or an admin)
-- can call it, and only to a real, active salesman account.
create or replace function public.reassign_order_salesman(p_order_id text, p_new_salesman_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role();
  v_old_salesman_id uuid;
  v_old_sales text;
  v_status text;
  v_new_name text;
begin
  if v_role not in ('salesman', 'admin') then
    raise exception 'Only a salesman or admin can reassign an order.';
  end if;
  if public.current_status() is distinct from 'active' and v_role != 'admin' then
    raise exception 'Your account is not active.';
  end if;

  select salesman_id, sales, status into v_old_salesman_id, v_old_sales, v_status
  from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_status = 'Cancelled' then
    raise exception 'This order has been cancelled and can no longer be reassigned.';
  end if;
  if v_role = 'salesman' and v_old_salesman_id is distinct from auth.uid() then
    raise exception 'You can only reassign an order that is currently assigned to you.';
  end if;

  select display_name into v_new_name from public.profiles
  where id = p_new_salesman_id and role = 'salesman' and status = 'active';
  if v_new_name is null then
    raise exception 'Choose a real, active salesman account to reassign to.';
  end if;
  if p_new_salesman_id = v_old_salesman_id then
    raise exception 'This order is already assigned to that salesman.';
  end if;

  update public.orders set salesman_id = p_new_salesman_id, sales = v_new_name where id = p_order_id;

  insert into public.audit_log (admin_id, action, target_table, target_id, before, after)
  values (
    auth.uid(), 'reassign_salesman', 'orders', p_order_id,
    jsonb_build_object('salesman_id', v_old_salesman_id, 'sales', v_old_sales),
    jsonb_build_object('salesman_id', p_new_salesman_id, 'sales', v_new_name)
  );
end;
$$;

grant execute on function public.reassign_order_salesman(text, uuid) to authenticated;
