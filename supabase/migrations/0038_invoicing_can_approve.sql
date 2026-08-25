-- Lets Invoicing Department approve a "Submitted to Sales" order (adjust
-- pricing, move it into 'In Production') at the same moment it assigns an
-- Invoice Number — for orders a Salesman hands over as a paper hard copy
-- before ever clicking Approve in the system themselves. See
-- src/state/AppState.jsx's approveAndSetInvoiceId. Sales' own digital
-- approval flow (SalesOrderSummary.jsx) is unaffected — this is an
-- additional path to the same end state, not a replacement.

-- 1) RLS: Invoicing now needs to see/act on EVERY order, not just ones
-- already past 'Submitted to Sales' — it may be the one approving it.
drop policy if exists "invoicing reads approved orders" on public.orders;
drop policy if exists "invoicing updates approved orders" on public.orders;

create policy "invoicing reads all orders" on public.orders
  for select using (public.current_role() = 'invoicing');
create policy "invoicing updates all orders" on public.orders
  for update using (public.current_role() = 'invoicing')
  with check (public.current_role() = 'invoicing');

-- 2) Column-write guard: Invoicing may always set invoice_id. It may also
-- change items/total_amount/price_adjusted/due_date/function_date and move
-- status from 'Submitted to Sales' to 'In Production' — but ONLY while the
-- order is still 'Submitted to Sales' to begin with (mirrors the
-- salesman branch's own restriction — once an order is 'In Production'
-- pricing stays frozen for Invoicing exactly like it already is for Sales).
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

  if v_role = 'invoicing' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status = 'In Production') then
      raise exception 'Invoicing Department can only move an order from Submitted to Sales into In Production.';
    end if;
    if old.status <> 'Submitted to Sales' and (
      new.items is distinct from old.items
      or new.total_amount is distinct from old.total_amount
      or new.price_adjusted is distinct from old.price_adjusted
      or new.due_date is distinct from old.due_date
      or new.function_date is distinct from old.function_date
    ) then
      raise exception 'Invoicing Department can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status') then
      raise exception 'Invoicing Department can only set the Invoice Number (and pricing/approve it if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$$;
