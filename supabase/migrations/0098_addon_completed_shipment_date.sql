-- Add-on on a Completed order + the add-on's own Shipment Date (Sean, 2026-10-17).
-- A Completed order takes an Add On too (teacher or salesman). The salesman may
-- give the add-on its own Shipment Date (pending_addon_shipment_date); when the
-- add-on is approved, its Tambahan order ships on that date, and is urgent when
-- that date is within 7 days of the approval (like urgentOrder.js). No date:
-- the original order's Shipment Date and urgency, as before.

alter table public.orders add column if not exists pending_addon_shipment_date text;

do $$
declare
  d text;
  n text;
begin
  -- orders_write_guard: the date travels with the other pending_addon_* fields,
  -- and a teacher's add-on may go on a Completed order too.
  d := pg_get_functiondef('public.orders_write_guard'::regproc);
  if position('pending_addon_shipment_date' in d) = 0 then
    n := replace(d, E'- ''pending_addon_reject_reason''', E'- ''pending_addon_reject_reason'' - ''pending_addon_shipment_date''');
    n := replace(n, E'if old.status in (''Salesman Approved'', ''In Production'') then',
                    E'if old.status in (''Salesman Approved'', ''In Production'', ''Completed'') then');
    if n = d then raise exception 'orders_write_guard: nothing replaced'; end if;
    execute n;
  end if;

  -- approve_addon: the Tambahan takes the add-on's own Shipment Date (and urgency) when given.
  d := pg_get_functiondef('public.approve_addon(text, jsonb, boolean)'::regprocedure);
  if position('pending_addon_shipment_date' in d) = 0 then
    n := replace(d, E'v_parent.phone, null, v_parent.shipment_date,',
                    E'v_parent.phone, null, coalesce(v_parent.pending_addon_shipment_date, v_parent.shipment_date),');
    n := replace(n, E'v_files, v_parent.urgent,',
                    E'v_files, public.addon_urgent(v_parent),');
    n := replace(n, E'case when v_parent.urgent then now() end,',
                    E'case when public.addon_urgent(v_parent) then now() end,');
    n := replace(n, E'set pending_addon_items = null, pending_addon_status = null, pending_addon_reject_reason = null',
                    E'set pending_addon_items = null, pending_addon_status = null, pending_addon_reject_reason = null, pending_addon_shipment_date = null');
    if (length(n) - length(replace(n, 'pending_addon_shipment_date', ''))) / length('pending_addon_shipment_date') <> 2
       or position('addon_urgent' in n) = 0 then
      raise exception 'approve_addon: not every change applied';
    end if;
    -- addon_urgent must exist before the new approve_addon is created
    execute $f$
      create or replace function public.addon_urgent(p public.orders)
      returns boolean
      language sql
      stable
      set search_path = public
      as $b$
        select case
          when p.pending_addon_shipment_date ~ '^\d{4}-\d\d-\d\d'
            then left(p.pending_addon_shipment_date, 10)::date - (now() at time zone 'Asia/Kuala_Lumpur')::date < 7
          else coalesce(p.urgent, false)
        end;
      $b$;
    $f$;
    execute n;
  end if;
end $$;
