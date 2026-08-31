-- ============================================================================
-- P0 SECURITY: (1) freeze a teacher's items/total once an order is In
-- Production, (2) validate items <-> total_amount arithmetic server-side.
-- ============================================================================
-- Two independent holes, both fixed here:
--
-- (1) orders_write_guard (0017, last rewritten in full by 0038) lets a
--     teacher UPDATE their own order for as long as old.status is
--     'Submitted to Sales' OR 'In Production', with no restriction on WHICH
--     columns change. The UI (src/pages/Dashboard.jsx) only exposes "Add On"
--     once an order is In Production — but a crafted request could rewrite
--     `items` / `total_amount` / `price_adjusted` directly, i.e. lower the
--     price of an order that Sales already approved and that is already in
--     production. Only the add-on holding columns (pending_addon_*) and the
--     print timestamp should be writable by a teacher at that point.
--
-- (2) Neither orders_write_guard nor any RLS policy checks that
--     `total_amount` equals the sum of `items[].harga`, or that each
--     `harga` equals `qty * unitPrice`. A tampered client can INSERT or
--     UPDATE an order with any total it likes. This adds a second, separate
--     BEFORE INSERT OR UPDATE trigger that enforces internal arithmetic
--     consistency — it does NOT enforce a pricing policy (Sales/Invoicing
--     may still negotiate any unit price), only that the numbers add up.
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Part 1: rewrite orders_write_guard() — full body carried over verbatim
-- from 0038, with ONLY the `teacher` branch changed.
-- ---------------------------------------------------------------------------
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

    -- Pre-approval: the teacher may still fully edit the order (Amend) and
    -- start an add-on. Unchanged from before.
    if old.status = 'Submitted to Sales' then
      return new;
    end if;

    -- Post-approval (In Production): the approved order is frozen for the
    -- teacher. The ONLY writable columns are the add-on holding area and the
    -- print timestamp. Everything else — items, total, dates, remark, logo —
    -- is locked; changes go through an Add-On (Sales-reviewed) instead.
    if old.status = 'In Production' then
      if (to_jsonb(new)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at')
         is distinct from
         (to_jsonb(old)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at')
      then
        raise exception 'This order is already in production — submit an Add-On to change it.';
      end if;
      return new;
    end if;

    raise exception 'This order can no longer be edited.';
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

-- ---------------------------------------------------------------------------
-- Part 2: arithmetic consistency of items <-> total_amount.
-- ---------------------------------------------------------------------------

-- Pure check: is `p_total` the sum of every item's `harga`, and is each
-- `harga` == qty * unitPrice (within a small tolerance for float noise)?
-- Returns false — never raises — for any malformed shape, so the trigger
-- below can turn it into one clean error message.
--
-- Deliberately NOT a pricing-policy check: unitPrice can be anything Sales
-- negotiated, and can be null for Production's "OTHER - <free text>" custom
-- codes (in which case harga is expected to be 0).
create or replace function public.order_items_total_consistent(p_items jsonb, p_total numeric)
returns boolean
language plpgsql
immutable
as $$
declare
  v_sum   numeric := 0;
  v_count int;
  v_qty   numeric;
  v_harga numeric;
  v_unit  numeric;
  v_jenis text;
  e       jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return false;
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count > 2000 then
    return false;  -- implausible payload size
  end if;

  for e in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_jenis := e ->> 'jenisPlak';
      v_qty   := (e ->> 'qty')::numeric;
      v_harga := (e ->> 'harga')::numeric;
      v_unit  := nullif(e ->> 'unitPrice', '')::numeric;
    exception when others then
      return false;
    end;

    if v_jenis is null or length(btrim(v_jenis)) = 0 then return false; end if;
    if v_qty is null or v_qty <= 0 or v_qty <> floor(v_qty) then return false; end if;
    if v_harga is null or v_harga < 0 then return false; end if;
    if abs(v_harga - coalesce(v_unit, 0) * v_qty) > 0.05 then return false; end if;

    v_sum := v_sum + v_harga;
  end loop;

  return abs(coalesce(p_total, 0) - v_sum) <= greatest(0.05, v_count * 0.01);
end;
$$;

-- Second, independent trigger (kept separate from orders_write_guard so the
-- role/transition logic and the money logic can each be reasoned about on
-- their own). Runs on INSERT and UPDATE.
create or replace function public.orders_amount_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role();
begin
  -- Admin / Production keep the "fix the data" latitude they already have in
  -- orders_write_guard (both get an unconditional early return there).
  if v_role in ('admin', 'production') then
    return new;
  end if;

  -- Only validate when a money-bearing column actually changes. A historical
  -- row left inconsistent by an earlier client bug is therefore never frozen
  -- — it simply cannot be made worse. A fresh INSERT is always validated.
  if tg_op = 'INSERT'
     or new.items        is distinct from old.items
     or new.total_amount is distinct from old.total_amount
  then
    if not public.order_items_total_consistent(new.items, new.total_amount) then
      raise exception
        'Order total (%.2f) does not match the sum of its items (server-side check).', new.total_amount
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_amount_guard_trigger on public.orders;
create trigger orders_amount_guard_trigger
  before insert or update on public.orders
  for each row
  execute function public.orders_amount_guard();
