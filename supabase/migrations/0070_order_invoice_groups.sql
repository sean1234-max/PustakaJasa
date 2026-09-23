-- ============================================================================
-- Lets Store Admin split ONE order across MULTIPLE invoice numbers, each
-- covering a different subset of the order's Jenis Plak codes — e.g. some
-- Jenis Plak bill under the order's existing invoice_id, others move to a
-- separate invoice. Split by Jenis Plak (not category): a Jenis Plak like
-- "PKC 263" is one physical Illustrator file regardless of which category
-- ordered it (the app already combines it into one priced line across
-- categories, see src/utils/orderBatches.js's combineByJenisPlak), so
-- that's the natural billing unit — not the category breakdown Production's
-- per-category export uses. `invoice_groups` only stores the EXCEPTIONS:
-- any Jenis Plak not listed here still bills under the order's own
-- `invoice_id` (the "default" — unchanged, still set once at approval the
-- same way as always). A Jenis Plak can only ever be a member of one entry.
--
-- Shape: [{ "invoiceId": "DWI-27000", "jenisPlakList": ["PKC 263", "PKF 266"] }, ...]
-- (originally shipped as `"categoryKeys"` — renamed in the app layer once
-- Jenis Plak turned out to be the more useful split unit; this jsonb column
-- itself doesn't care about the internal key names, so no further migration
-- was needed for the rename.)
--
-- orders_write_guard (0066) already excludes `invoice_id` from its
-- store_admin "no changes after already approved" diff — `invoice_groups`
-- needs the same exclusion so Store Admin can set it on an order that's
-- already In Production (which is when invoice numbers actually get
-- assigned in practice).
-- ----------------------------------------------------------------------------

alter table public.orders
  add column if not exists invoice_groups jsonb not null default '[]'::jsonb;

create or replace function public.orders_write_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := public.current_role();
  v_status text := public.current_status();
begin
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
      or new.shipment_date is distinct from old.shipment_date
      or new.function_date is distinct from old.function_date
    ) then
      raise exception 'Store Admin can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$function$;
