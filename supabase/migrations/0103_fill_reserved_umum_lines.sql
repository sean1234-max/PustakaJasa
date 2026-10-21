-- Reserved names on ORDER LAIN-LAIN too (Sean, 2026-10-21): a line ①–④ of a row
-- (its own text; blank = the CONTOH line; "-" = no such line) reading RESERVED /
-- RESERVE / KIV / NAMA MURID is waiting for its name, like TOKOH's NAMA MURID —
-- and "NAMA MURID" now counts as Reserved everywhere (exportCsv.js reservedField).
-- fill_reserved_names fills whichever field that is.

create or replace function public.pj_is_reserved(t text)
returns boolean
language sql
immutable
as $$ select btrim(coalesce(t, '')) ~* '^(reserved?|kiv|nama\s+murid)$' $$;

-- The field of row `r` (in item `i`) still waiting for its name: 'namaMurid',
-- 'l0'..'l3', or null.
create or replace function public.pj_reserved_field(i jsonb, r jsonb)
returns text
language sql
immutable
as $$
  select case
    when public.pj_is_reserved(r->>'namaMurid') then 'namaMurid'
    when i->>'categoryKey' = 'UMUM' or i->>'categoryKey' like 'DYN::UMUM::%' then (
      select 'l' || s
        from unnest(array['0', '1', '2', '3']) with ordinality u(s, n)
       where btrim(coalesce(r->>('l' || s), '')) <> '-'
         and public.pj_is_reserved(coalesce(nullif(btrim(r->>('l' || s)), ''),
               i->'detail'->'lines'->>(concat(i->>'categoryKey', '::', coalesce(i->>'blockIdx', '0'), '::', s))))
       order by n
       limit 1)
  end
$$;

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
      or public.pj_is_reserved(n.value)
      or not exists (
        select 1
          from jsonb_array_elements(v_order.items) i,
               jsonb_array_elements(case when jsonb_typeof(i->'detail'->'rows') = 'array' then i->'detail'->'rows' else '[]'::jsonb end) r
         where r->>'id' = n.key and public.pj_reserved_field(i, r) is not null);
  if v_bad > 0 then
    raise exception 'Only "Reserved" rows can be filled in, each with a real name. Reload the order and try again.';
  end if;

  select jsonb_agg(
           case when jsonb_typeof(i->'detail'->'rows') = 'array' and jsonb_array_length(i->'detail'->'rows') > 0 then
             jsonb_set(i, '{detail,rows}', (
               select jsonb_agg(case when p_names ? (r->>'id') and public.pj_reserved_field(i, r) is not null
                                     then jsonb_set(r, array[public.pj_reserved_field(i, r)], to_jsonb(btrim(p_names->>(r->>'id'))))
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
