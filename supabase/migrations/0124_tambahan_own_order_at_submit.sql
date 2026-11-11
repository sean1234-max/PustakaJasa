-- A Tambahan is its own order from the moment it is submitted (Sean, 2026-11-11), not a pending add-on on the
-- original until the salesman approves it (0091):
--   submit  -> submit_tambahan: the NEXT order number (never the original's), parent_order_id = the original,
--              status Reviewing Order — then Production's Done Review like any order;
--   approve -> approve_tambahan: straight to In Production, no invoice (Store Admin bills it in AutoCount),
--              urgent from its own Shipment Date (as addon_urgent did), its urgent Sheet row stamped.
-- The add-ons still pending when this went live (ORD-0160 pending, ORD-0257 / ORD-0300 reviewed) were turned into
-- their own orders by hand with create_tambahan_order (Sean ran it, review state kept, stock untouched).

-- Shared by submit_tambahan and the one-off conversion of the pending add-ons. Not callable by users.
create or replace function public.create_tambahan_order(
  p_parent public.orders, p_items jsonb, p_shipment_date text, p_kertas_kerja jsonb, p_reviewed boolean
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prefix text;
  v_min integer;
  v_seq integer;
  v_id text;
  v_total numeric;
  v_files jsonb;
begin
  -- the next number of the normal sequence; the test account's orders (9000+) keep to their own counter
  if substring(p_parent.id from '^ORD-(\d+)$')::integer >= 9000 then
    v_prefix := 'ORD-TEST-'; v_min := 9001;
  else
    v_prefix := 'ORD-'; v_min := 1;
  end if;
  loop
    update public.order_number_counters set next_seq = next_seq + 1 where prefix = v_prefix returning next_seq - 1 into v_seq;
    exit when found;
    begin
      insert into public.order_number_counters (prefix, next_seq) values (v_prefix, v_min + 1);
      v_seq := v_min; exit;
    exception when unique_violation then end;
  end loop;
  v_id := 'ORD-' || lpad(v_seq::text, 4, '0');
  if v_id = p_parent.id or exists (select 1 from public.orders where id = v_id) then
    raise exception 'Order number % is already taken — please try again.', v_id;
  end if;

  select coalesce(sum((e->>'harga')::numeric), 0) into v_total from jsonb_array_elements(p_items) e;
  select coalesce(jsonb_agg(jsonb_build_object('path', p, 'name', 'tambahan.xlsx')), '[]') into v_files
    from (select distinct e->>'importFile' as p from jsonb_array_elements(p_items) e where coalesce(e->>'importFile', '') <> '') f;

  insert into public.orders (
    id, kertas_kerja_files, parent_order_id, invoice_id, date_placed, delivery_date, total_amount, status, price_adjusted,
    sekolah, sales, pic_name, phone, remark, shipment_date, function_date, logo_data_url, logo_file_name,
    items, snapshot, created_by, school_type, salesman_id, ketua_panitia, terms, logo_remark, school_language,
    import_file_path, import_file_name, import_files, urgent, reviewed_at, salesman_delivery, created_by_salesman
  ) values (
    v_id, coalesce(p_kertas_kerja, '[]'::jsonb), p_parent.id, null, to_char(now() at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY'), 'TBD', v_total, 'Reviewing Order', false,
    p_parent.sekolah, p_parent.sales, p_parent.pic_name, p_parent.phone, null, coalesce(p_shipment_date, p_parent.shipment_date), p_parent.function_date, p_parent.logo_data_url, p_parent.logo_file_name,
    p_items, p_parent.snapshot, p_parent.created_by, p_parent.school_type, p_parent.salesman_id, p_parent.ketua_panitia, p_parent.terms, p_parent.logo_remark, p_parent.school_language,
    v_files->0->>'path', v_files->0->>'name', v_files, coalesce(p_parent.urgent, false),
    case when p_reviewed then now() end, p_parent.salesman_delivery, p_parent.created_by_salesman
  );
  return v_id;
end;
$function$;
revoke all on function public.create_tambahan_order(public.orders, jsonb, text, jsonb, boolean) from public, anon, authenticated;

-- The teacher who placed the order, its salesman, or admin submits a Tambahan of an approved order.
create or replace function public.submit_tambahan(p_order_id text, p_items jsonb, p_shipment_date text, p_kertas_kerja jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parent public.orders;
  v_role text := public.current_role();
begin
  if public.current_status() is distinct from 'active' then
    raise exception 'Your account is not active.';
  end if;
  select * into v_parent from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if not (v_role = 'admin'
          or (v_role = 'teacher' and v_parent.created_by = auth.uid())
          or (v_role = 'salesman' and v_parent.salesman_id = auth.uid())) then
    raise exception 'Only the order''s teacher or salesman can add a Tambahan.';
  end if;
  if v_parent.parent_order_id is not null then
    raise exception 'A Tambahan is added to the original order, not to another Tambahan.';
  end if;
  if v_parent.status not in ('Salesman Approved', 'In Production', 'Completed') then
    raise exception 'A Tambahan can only be added once the order is approved.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The Tambahan has no items.';
  end if;
  if p_shipment_date is not null and p_shipment_date !~ '^\d{4}-\d\d-\d\d' then
    raise exception 'Bad Shipment Date.';
  end if;
  return public.create_tambahan_order(v_parent, p_items, p_shipment_date, p_kertas_kerja, false);
end;
$function$;
grant execute on function public.submit_tambahan(text, jsonb, text, jsonb) to authenticated;

-- The salesman approves a reviewed Tambahan: prices (and the dates / remark / delivery the approval page edits)
-- only — same items, plaques and quantities — then straight to In Production.
-- p_fields: { shipment_date, function_date, remark, salesman_delivery } as stored; missing keys keep what's there.
create or replace function public.approve_tambahan(p_order_id text, p_items jsonb, p_price_adjusted boolean, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders;
  v_ship text;
  v_urgent boolean;
begin
  if public.current_status() is distinct from 'active' or public.current_role() not in ('salesman', 'admin') then
    raise exception 'Only the order''s salesman can approve its Tambahan.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if public.current_role() = 'salesman' and v_order.salesman_id is distinct from auth.uid() then
    raise exception 'Only the order''s salesman can approve its Tambahan.';
  end if;
  if v_order.parent_order_id is null then
    raise exception 'This is not a Tambahan.';
  end if;
  if v_order.status is distinct from 'Reviewing Order' or v_order.reviewed_at is null then
    raise exception 'Production has to review this Tambahan before it can be approved.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The Tambahan has no items.';
  end if;
  if (select jsonb_agg(jsonb_build_object('id', e->'id', 'jenisPlak', e->'jenisPlak', 'qty', e->>'qty') order by e->>'id')
        from jsonb_array_elements(p_items) e)
     is distinct from
     (select jsonb_agg(jsonb_build_object('id', e->'id', 'jenisPlak', e->'jenisPlak', 'qty', e->>'qty') order by e->>'id')
        from jsonb_array_elements(v_order.items) e) then
    raise exception 'The Tambahan changed — please reload the order and approve again.';
  end if;

  v_ship := coalesce(nullif(p_fields->>'shipment_date', ''), v_order.shipment_date);
  -- urgent: shipped within 7 days of today (as addon_urgent did at approval)
  v_urgent := case when v_ship ~ '^\d{4}-\d\d-\d\d'
                   then left(v_ship, 10)::date - (now() at time zone 'Asia/Kuala_Lumpur')::date < 7
                   else coalesce(v_order.urgent, false) end;

  -- orders_write_guard lets a salesman take an order only to Salesman Approved; this function has made its own
  -- checks above, so its one update passes the guard (the same switch fill_reserved_names uses, 0097)
  perform set_config('pj.fill_reserved', '1', true);
  update public.orders set
    items = p_items,
    total_amount = (select coalesce(sum((e->>'harga')::numeric), 0) from jsonb_array_elements(p_items) e),
    price_adjusted = coalesce(p_price_adjusted, false),
    shipment_date = v_ship,
    function_date = coalesce(nullif(p_fields->>'function_date', ''), v_order.function_date),
    remark = case when p_fields ? 'remark' then nullif(p_fields->>'remark', '') else v_order.remark end,
    salesman_delivery = coalesce((p_fields->>'salesman_delivery')::boolean, v_order.salesman_delivery),
    urgent = v_urgent,
    -- its own row in the urgent Sheet, written by the website right after (the salesman can't stamp it himself)
    urgent_sheet_synced_at = case when v_urgent then now() else v_order.urgent_sheet_synced_at end,
    status = 'In Production'
  where id = p_order_id;
  perform set_config('pj.fill_reserved', '0', true);
end;
$function$;
grant execute on function public.approve_tambahan(text, jsonb, boolean, jsonb) to authenticated;

-- signed-in users only (applied as tambahan_rpcs_no_anon)
revoke execute on function public.submit_tambahan(text, jsonb, text, jsonb) from public, anon;
revoke execute on function public.approve_tambahan(text, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.submit_tambahan(text, jsonb, text, jsonb) to authenticated;
grant execute on function public.approve_tambahan(text, jsonb, boolean, jsonb) to authenticated;
