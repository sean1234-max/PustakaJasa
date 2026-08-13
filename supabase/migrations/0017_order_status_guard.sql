-- QA finding BUG-001: RLS on `orders` only ever checked row ownership
-- (created_by = auth.uid(), or "one of my assigned teachers"), never which
-- columns changed. A teacher or salesman with a valid session could call
-- supabase.from('orders').update({status: 'Completed'}) directly and skip
-- the entire Sales-approval / Production workflow. Row-level policies
-- can't compare the old and new value of a column against each other
-- (WITH CHECK only sees the new row), so this needs a trigger.
--
-- Real transitions this app's own code actually performs today:
--   teacher   INSERT              -> status = 'Submitted to Sales' only
--   teacher   UPDATE (Amend/AddOn)-> status unchanged, only while the order
--                                    is still 'Submitted to Sales' or
--                                    'In Production' (src/pages/Dashboard.jsx
--                                    idx===0/idx===1 button gating mirrors
--                                    this exactly)
--   salesman  UPDATE (approve)    -> 'Submitted to Sales' -> 'In Production'
--                                    only (src/state/AppState.jsx approveOrder)
--   production/admin              -> unrestricted (their whole job is
--                                    managing status/fulfillment)

alter table public.orders
  add constraint orders_status_check
  check (status in ('Submitted to Sales', 'In Production', 'Out for Delivery', 'Completed'));

-- QA finding BUG-002 (order-write half of it): a deactivated/suspended
-- account's already-open browser tab keeps a live Supabase session, and
-- nothing previously stopped it from continuing to write. This helper
-- mirrors current_role() (0010) — it re-reads the live `profiles` row on
-- every call rather than trusting anything cached in the session/JWT, so
-- an Admin deactivating someone takes effect on that person's very next
-- write attempt, without needing to explicitly revoke their session.
create or replace function public.current_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select status from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_status() to authenticated;

create or replace function public.orders_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role();
  v_status text := public.current_status();
begin
  if v_role in ('admin', 'production') then
    return new;
  end if;

  if v_status is distinct from 'active' then
    raise exception 'Your account is not active.';
  end if;

  if v_role = 'teacher' then
    if new.status is distinct from old.status then
      raise exception 'Teachers cannot change an order''s status.';
    end if;
    if old.status not in ('Submitted to Sales', 'In Production') then
      raise exception 'This order can no longer be edited.';
    end if;
    return new;
  end if;

  if v_role = 'salesman' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status = 'In Production') then
      raise exception 'Salesmen can only move an order from Submitted to Sales into In Production.';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$$;

drop trigger if exists orders_write_guard_trigger on public.orders;
create trigger orders_write_guard_trigger
  before update on public.orders
  for each row
  execute function public.orders_write_guard();

-- Also lock down INSERT: a teacher-created order must start in the one
-- valid starting status (previously any status was accepted), and the
-- teacher's own account must currently be active.
drop policy if exists "teacher creates own orders" on public.orders;
create policy "teacher creates own orders" on public.orders
  for insert with check (
    created_by = auth.uid()
    and public.current_role() = 'teacher'
    and public.current_status() = 'active'
    and status = 'Submitted to Sales'
  );
