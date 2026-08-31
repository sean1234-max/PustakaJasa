-- ============================================================================
-- P0 SECURITY: lock the SECURITY DEFINER RPCs down to authenticated callers.
-- ============================================================================
-- next_order_seq (0009) and plak_stock_deduct / plak_stock_restore /
-- resolve_plak_node_id (0032) were all granted EXECUTE to `anon` (and, by
-- PostgreSQL's default, to PUBLIC). The two stock functions are SECURITY
-- DEFINER, run with the definer's rights, bypass RLS, and never check who the
-- caller is. Anyone who reads the public anon key out of this site's JS
-- bundle can call them directly against the PostgREST endpoint without ever
-- logging in:
--
--   * plak_stock_deduct  -> drive any Jenis Plak's stock_qty to 0. The app
--     treats 0 as "sold out" and auto-hides that code from every teacher's
--     New Order page (src/data/catalog.js filterHiddenPlakCatalog) — i.e.
--     wipe the orderable catalog at will.
--   * plak_stock_restore -> inflate stock counts arbitrarily.
--   * next_order_seq     -> burn order numbers.
--
-- No legitimate caller is anonymous. Every real call site uses the shared
-- supabase-js client (src/lib/supabaseClient.js), which always sends the
-- signed-in user's JWT:
--   - next_order_seq        <- src/lib/ordersApi.js         (teacher submitting an order)
--   - plak_stock_deduct     <- src/lib/catalogAdminApi.js   (teacher New Order / Add On submit)
--   - plak_stock_restore    <- src/lib/catalogAdminApi.js   (add-on reject / cancel, failed-insert compensation)
--   - resolve_plak_node_id  <- only ever called internally by the two stock fns
--
-- Fix: revoke from PUBLIC and anon, grant only to authenticated, and add a
-- defence-in-depth auth.uid() check inside the two state-changing stock
-- functions so a future accidental re-grant cannot silently reopen the hole.
-- ----------------------------------------------------------------------------

-- 1) Grants -------------------------------------------------------------------
revoke execute on function public.next_order_seq(text, integer)  from public;
revoke execute on function public.next_order_seq(text, integer)  from anon;
revoke execute on function public.plak_stock_deduct(jsonb)       from public;
revoke execute on function public.plak_stock_deduct(jsonb)       from anon;
revoke execute on function public.plak_stock_restore(jsonb)      from public;
revoke execute on function public.plak_stock_restore(jsonb)      from anon;
revoke execute on function public.resolve_plak_node_id(text)     from public;
revoke execute on function public.resolve_plak_node_id(text)     from anon;

grant execute on function public.next_order_seq(text, integer)   to authenticated;
grant execute on function public.plak_stock_deduct(jsonb)        to authenticated;
grant execute on function public.plak_stock_restore(jsonb)       to authenticated;
grant execute on function public.resolve_plak_node_id(text)      to authenticated;

-- 2) Defence-in-depth: re-declare the two mutating stock functions verbatim
--    from 0032, with a single added `auth.uid() is null` guard at the top.
--    Nothing else in either body changes. CREATE OR REPLACE does not touch
--    the ACL set above.
create or replace function public.plak_stock_deduct(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_node_id uuid;
  v_stock integer;
  v_baseline integer;
  v_low_threshold numeric;
  v_reserve integer;
  v_max_orderable integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  for v_item in
    select full_path, sum(qty)::integer as qty
    from jsonb_to_recordset(p_items) as x(full_path text, qty integer)
    group by full_path
  loop
    if v_item.full_path is null or v_item.qty is null or v_item.qty <= 0 then continue; end if;

    v_node_id := public.resolve_plak_node_id(v_item.full_path);
    if v_node_id is null then
      raise exception 'Unknown Jenis Plak code: %', v_item.full_path;
    end if;

    select stock_qty, stock_baseline into v_stock, v_baseline
    from public.plak_catalog_nodes where id = v_node_id for update;

    if v_stock is null then continue; end if;

    if v_baseline is not null and v_baseline > 0 and v_stock <= (v_baseline * 0.15) then
      v_low_threshold := v_baseline * 0.15;
      v_reserve := ceil(v_low_threshold * 0.10);
      v_max_orderable := greatest(v_stock - v_reserve, 0);
      if v_item.qty > v_max_orderable then
        raise exception 'INSUFFICIENT_STOCK:%:%', v_item.full_path, v_max_orderable;
      end if;
    elsif v_item.qty > v_stock then
      raise exception 'INSUFFICIENT_STOCK:%:%', v_item.full_path, v_stock;
    end if;

    update public.plak_catalog_nodes set stock_qty = stock_qty - v_item.qty where id = v_node_id;
  end loop;
end;
$$;

create or replace function public.plak_stock_restore(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_node_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  for v_item in
    select full_path, sum(qty)::integer as qty
    from jsonb_to_recordset(p_items) as x(full_path text, qty integer)
    group by full_path
  loop
    if v_item.full_path is null or v_item.qty is null or v_item.qty <= 0 then continue; end if;
    v_node_id := public.resolve_plak_node_id(v_item.full_path);
    if v_node_id is null then continue; end if;
    update public.plak_catalog_nodes
      set stock_qty = stock_qty + v_item.qty
      where id = v_node_id and stock_qty is not null;
  end loop;
end;
$$;

-- next_order_seq and resolve_plak_node_id are unchanged in body — the grant
-- changes above are sufficient (next_order_seq already needs no internal
-- auth check: order_number_counters has no RLS policies at all, so the only
-- way to touch it is through this SECURITY DEFINER function, and burning a
-- number is low-impact compared to the stock functions).
