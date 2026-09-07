-- ============================================================================
-- P2 cleanups from the 2026-09-07 re-audit.
--
-- 1) `logos` bucket accepted an upload from any authenticated account at
--    any path (0034's policy checks only bucket_id). 0043 already capped
--    size + mime type; this scopes writes to the uploader's own uid folder,
--    same as `order-imports`. Reads stay public — a school logo is printed
--    on the plaque and rendered from a public URL. Old root-path logos keep
--    working (the SELECT policy is bucket-wide).
--
-- 2) orders_write_guard() let a DEACTIVATED admin / production session keep
--    writing orders for up to ~1h (until the JWT expired) — the
--    admin/production early return sat ABOVE the `current_status() = active`
--    check. Move the status check to the top so it gates every non-service
--    role. Body otherwise VERBATIM from 0052.
-- ----------------------------------------------------------------------------

-- 1) logos bucket ----------------------------------------------------------
drop policy if exists "authenticated users can upload logos" on storage.objects;
create policy "upload own logo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- "anyone can read logos" (0034) is unchanged — logos are public by design.

-- 2) orders_write_guard() — status check first ----------------------------
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
  -- Gates EVERY role that isn't the service trigger context: a deactivated
  -- account (admin / production included) can no longer write.
  if v_status is distinct from 'active' then
    raise exception 'Your account is not active.';
  end if;

  if v_role in ('admin', 'production') then
    return new;
  end if;

  if old.status = 'Cancelled' then
    raise exception 'This order has been cancelled and can no longer be edited.';
  end if;

  if v_role = 'teacher' then
    if new.status is distinct from old.status
       and not (old.status = 'Submitted to Sales' and new.status = 'Cancelled') then
      raise exception 'Teachers cannot change an order''s status.';
    end if;
    if old.status = 'Submitted to Sales' then
      return new;
    end if;
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
       and not (old.status = 'Submitted to Sales' and new.status in ('In Production', 'Cancelled')) then
      raise exception 'Salesmen can only move an order from Submitted to Sales into In Production, or cancel it.';
    end if;
    if old.status = 'Submitted to Sales' or old.pending_addon_status = 'pending' then
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
       and not (old.status = 'Submitted to Sales' and new.status in ('In Production', 'Cancelled')) then
      raise exception 'Store Admin can only move an order from Submitted to Sales into In Production, or cancel it.';
    end if;
    if old.status <> 'Submitted to Sales' and (
      new.items is distinct from old.items
      or new.total_amount is distinct from old.total_amount
      or new.price_adjusted is distinct from old.price_adjusted
      or new.due_date is distinct from old.due_date
      or new.function_date is distinct from old.function_date
    ) then
      raise exception 'Store Admin can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'items' - 'total_amount' - 'price_adjusted' - 'due_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$$;

revoke execute on function public.orders_write_guard() from public, anon, authenticated;
