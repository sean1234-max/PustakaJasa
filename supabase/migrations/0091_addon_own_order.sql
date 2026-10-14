-- Sean, 2026-10-14: an approved Tambahan (add-on) becomes its own order.
--
-- Before: Sales' approval merged the add-on's items into the original order
-- (a second `batch`), so it had no workflow of its own. Now the add-on is
-- reviewed and approved exactly as before (pending_addon_* on the original),
-- and approving it creates a NEW order, numbered from the same sequence as
-- every order (ORD-0055 …; the test account's own 9000+ counter for its test
-- orders), carrying only the add-on's items and parent_order_id = the original.
-- It skips Store Admin (billed in AutoCount, nothing entered on the website):
-- it starts In Production, so Typing (or KIV & ARTWORK for crystal /
-- Reserved) picks it up straight away, then In Production → Done as usual.
-- Function details, dates and urgency are the original's. Add-ons approved
-- before this stay merged in their original order.

alter table public.orders add column if not exists parent_order_id text references public.orders(id);
create index if not exists orders_parent_order_id_idx on public.orders (parent_order_id);

create or replace function public.approve_addon(p_order_id text, p_items jsonb, p_price_adjusted boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_parent public.orders;
  v_prefix text;
  v_min integer;
  v_seq integer;
  v_id text;
  v_total numeric;
  v_files jsonb;
begin
  if public.current_status() is distinct from 'active' or public.current_role() not in ('salesman', 'admin') then
    raise exception 'Only the order''s salesman can approve its add-on.';
  end if;

  select * into v_parent from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if public.current_role() = 'salesman' and v_parent.salesman_id is distinct from auth.uid() then
    raise exception 'Only the order''s salesman can approve its add-on.';
  end if;
  if v_parent.status = 'Cancelled' then
    raise exception 'This order has been cancelled.';
  end if;
  if v_parent.pending_addon_status is distinct from 'reviewed' then
    raise exception 'Production has to review this add-on before it can be approved.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The add-on has no items.';
  end if;
  -- Sales may change prices at approval, nothing else: same items, plaques and quantities.
  if (select jsonb_agg(jsonb_build_object('id', e->'id', 'jenisPlak', e->'jenisPlak', 'qty', e->>'qty') order by e->>'id')
        from jsonb_array_elements(p_items) e)
     is distinct from
     (select jsonb_agg(jsonb_build_object('id', e->'id', 'jenisPlak', e->'jenisPlak', 'qty', e->>'qty') order by e->>'id')
        from jsonb_array_elements(v_parent.pending_addon_items) e) then
    raise exception 'The add-on changed — please reload the order and approve again.';
  end if;

  -- next number: the test account's orders (9000+) keep to their own counter
  if substring(v_parent.id from '^ORD-(\d+)$')::integer >= 9000 then
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

  select coalesce(sum((e->>'harga')::numeric), 0) into v_total from jsonb_array_elements(p_items) e;
  select coalesce(jsonb_agg(jsonb_build_object('path', p, 'name', 'tambahan.xlsx')), '[]') into v_files
    from (select distinct e->>'importFile' as p from jsonb_array_elements(p_items) e where coalesce(e->>'importFile', '') <> '') f;

  insert into public.orders (
    id, parent_order_id, invoice_id, date_placed, delivery_date, total_amount, status, price_adjusted,
    sekolah, sales, pic_name, phone, remark, shipment_date, function_date, logo_data_url, logo_file_name,
    items, snapshot, created_by, school_type, salesman_id, ketua_panitia, terms, logo_remark, school_language,
    import_file_path, import_file_name, import_files, urgent, urgent_sheet_synced_at, reviewed_at, salesman_delivery, created_by_salesman
  ) values (
    v_id, v_parent.id, null, to_char(now() at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY'), 'TBD', v_total, 'In Production', coalesce(p_price_adjusted, false),
    v_parent.sekolah, v_parent.sales, v_parent.pic_name, v_parent.phone, null, v_parent.shipment_date, v_parent.function_date, v_parent.logo_data_url, v_parent.logo_file_name,
    p_items, v_parent.snapshot, v_parent.created_by, v_parent.school_type, v_parent.salesman_id, v_parent.ketua_panitia, v_parent.terms, v_parent.logo_remark, v_parent.school_language,
    v_files->0->>'path', v_files->0->>'name', v_files, v_parent.urgent,
    -- urgent like its original (same Shipment Date): its own row in the urgent Sheet, written by the
    -- website right after (stamped here — the salesman can't stamp an approved order himself)
    case when v_parent.urgent then now() end,
    now(), v_parent.salesman_delivery, v_parent.created_by_salesman
  );

  update public.orders
     set pending_addon_items = null, pending_addon_status = null, pending_addon_reject_reason = null
   where id = v_parent.id;

  return v_id;
end;
$function$;

revoke execute on function public.approve_addon(text, jsonb, boolean) from public, anon;
grant execute on function public.approve_addon(text, jsonb, boolean) to authenticated;
