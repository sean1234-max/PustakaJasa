-- ============================================================================
-- P1 SECURITY: the three SECURITY DEFINER RPCs the browser calls during
-- order submission (plak_stock_deduct, plak_stock_restore, next_order_seq)
-- are EXECUTE-able by every `authenticated` session — they have to be, the
-- browser calls them directly. But nothing stopped a signed-in user from
-- POSTing to /rest/v1/rpc/... by hand:
--
--   * plak_stock_restore had NO upper bound — any account could inflate a
--     Jenis Plak's stock_qty to any number.
--   * plak_stock_deduct / next_order_seq could be driven by any role (drain
--     a code's stock, or burn order numbers).
--
-- Fixes, keeping every legitimate call path working:
--   * restore now caps stock_qty at stock_baseline — it can only give back
--     what a deduction took, never push a code above its baseline.
--   * deduct and next_order_seq require the caller to be a teacher (the only
--     role that submits orders — the sole caller of both, see
--     src/state/AppState.jsx submitOrder / submitPendingAddOn).
-- Bodies are otherwise VERBATIM from their live definitions.
-- ----------------------------------------------------------------------------

create or replace function public.next_order_seq(p_prefix text, p_min_seq integer default 1)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_seq integer;
begin
  if public.current_role() is distinct from 'teacher' then
    raise exception 'Not allowed.';
  end if;
  loop
    update public.order_number_counters
      set next_seq = next_seq + 1
      where prefix = p_prefix
      returning next_seq - 1 into v_seq;
    exit when found;

    begin
      insert into public.order_number_counters (prefix, next_seq)
        values (p_prefix, p_min_seq + 1);
      v_seq := p_min_seq;
      exit;
    exception when unique_violation then
      -- Another concurrent call seeded the row first — loop back and UPDATE it.
    end;
  end loop;
  return v_seq;
end;
$function$;

create or replace function public.plak_stock_deduct(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item record;
  v_node_id uuid;
  v_stock integer;
  v_baseline integer;
  v_low_threshold numeric;
  v_reserve integer;
  v_max_orderable integer;
begin
  if public.current_role() is distinct from 'teacher' then
    raise exception 'Not allowed.';
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
$function$;

create or replace function public.plak_stock_restore(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- Cap at the baseline: restore can only undo a deduction, never inflate
    -- a code past the number Production last set it to.
    update public.plak_catalog_nodes
      set stock_qty = least(stock_qty + v_item.qty, coalesce(stock_baseline, stock_qty + v_item.qty))
      where id = v_node_id and stock_qty is not null;
  end loop;
end;
$function$;

-- The advisor's RPC-exposure lint stays (these are called from the browser
-- by design) — mirror 0044's grant shape so the lockdown is explicit.
revoke execute on function public.next_order_seq(text, integer)  from public, anon;
revoke execute on function public.plak_stock_deduct(jsonb)       from public, anon;
revoke execute on function public.plak_stock_restore(jsonb)      from public, anon;
grant execute on function public.next_order_seq(text, integer)   to authenticated;
grant execute on function public.plak_stock_deduct(jsonb)        to authenticated;
grant execute on function public.plak_stock_restore(jsonb)       to authenticated;
