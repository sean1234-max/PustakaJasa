-- Reserved names filled in after the order is In Production (Sean, 2026-10-17):
-- KIV & ARTWORK is look-only now. Production or the order's salesman types the
-- real name over a "Reserved" / "Reserve" / "KIV" NAMA MURID; once none is left
-- the KIV card leaves KIV & ARTWORK on its own. Rows filled after the plaques
-- were typed (typed_at) are kept in kiv_filled_rows (row ids): their own card in
-- Typing makes only them. Filled before that, they're typed with the rest.

alter table public.orders add column if not exists kiv_filled_rows jsonb;

-- Only this function writes past orders_write_guard (a salesman can't change an
-- approved order's items otherwise): it sets pj.fill_reserved for its own update.
do $$
declare
  d text;
begin
  d := pg_get_functiondef('public.orders_write_guard'::regproc);
  if position('pj.fill_reserved' in d) = 0 then
    d := replace(d,
      E'  if v_role in (''admin'', ''production'') then',
      E'  -- fill_reserved_names (0097): only the Reserved names it was asked to fill\n'
      || E'  if current_setting(''pj.fill_reserved'', true) = ''1'' then\n    return new;\n  end if;\n\n'
      || E'  if v_role in (''admin'', ''production'') then');
    execute d;
  end if;
end $$;

-- p_names: { "<row id>": "<name>" } — every row a "Reserved" row of this order,
-- every name a real one.
create or replace function public.fill_reserved_names(p_order_id text, p_names jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_items jsonb;
  v_bad integer;
begin
  if public.current_status() is distinct from 'active'
     or public.current_role() not in ('production', 'admin', 'salesman') then
    raise exception 'Only Production or the order''s salesman can fill in Reserved names.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if public.current_role() = 'salesman' and v_order.salesman_id is distinct from auth.uid() then
    raise exception 'Only the order''s salesman can fill in its Reserved names.';
  end if;
  if v_order.status <> 'In Production' then
    raise exception 'Reserved names can be filled in here only while the order is In Production.';
  end if;
  if jsonb_typeof(p_names) is distinct from 'object' or p_names = '{}'::jsonb then
    raise exception 'No names to fill in.';
  end if;

  select count(*) into v_bad
    from jsonb_each_text(p_names) n
   where btrim(n.value) = ''
      or btrim(n.value) ~* '^(reserved?|kiv)$'
      or not exists (
        select 1
          from jsonb_array_elements(v_order.items) i,
               jsonb_array_elements(case when jsonb_typeof(i->'detail'->'rows') = 'array' then i->'detail'->'rows' else '[]'::jsonb end) r
         where r->>'id' = n.key and btrim(coalesce(r->>'namaMurid', '')) ~* '^(reserved?|kiv)$');
  if v_bad > 0 then
    raise exception 'Only "Reserved" rows can be filled in, each with a real name. Reload the order and try again.';
  end if;

  select jsonb_agg(
           case when jsonb_typeof(i->'detail'->'rows') = 'array' and jsonb_array_length(i->'detail'->'rows') > 0 then
             jsonb_set(i, '{detail,rows}', (
               select jsonb_agg(case when p_names ? (r->>'id')
                                     then jsonb_set(r, '{namaMurid}', to_jsonb(btrim(p_names->>(r->>'id'))))
                                     else r end order by ro)
                 from jsonb_array_elements(i->'detail'->'rows') with ordinality t(r, ro)))
           else i end
           order by io)
    into v_items
    from jsonb_array_elements(v_order.items) with ordinality u(i, io);

  perform set_config('pj.fill_reserved', '1', true);
  update public.orders
     set items = v_items,
         kiv_filled_rows = case when typed_at is not null
                                then coalesce(kiv_filled_rows, '[]'::jsonb) || (select jsonb_agg(k) from jsonb_object_keys(p_names) k)
                                else kiv_filled_rows end
   where id = p_order_id;
  perform set_config('pj.fill_reserved', '', true);
end;
$$;

revoke execute on function public.fill_reserved_names(text, jsonb) from public, anon;
grant execute on function public.fill_reserved_names(text, jsonb) to authenticated;
