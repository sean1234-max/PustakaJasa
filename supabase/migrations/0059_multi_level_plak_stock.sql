-- Extends 0058_add_plak_stock_groups.sql: a parent code (GOLD, SILVER,
-- BRONZE — anything with children) can now ALSO track its own independent
-- stock, same as a leaf. Ordering a leaf beneath it (e.g. "MP393 / GOLD /
-- BASE A") must then satisfy and deduct from EVERY tracked level along
-- that path at once — GOLD's own count AND BASE A's (which may itself be a
-- shared Stock Group) — not just the leaf. Any level with neither its own
-- stock_qty nor a stock_group_key contributes nothing, so this is a no-op
-- for every code that only tracks stock at the leaf, exactly as before.
create or replace function public.plak_stock_deduct(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item record;
  v_node_id uuid;
  v_target record;
  v_stock integer;
  v_baseline integer;
  v_low_threshold numeric;
  v_reserve integer;
  v_max_orderable integer;
begin
  if public.current_role() is distinct from 'teacher' then
    raise exception 'Not allowed.';
  end if;

  create temporary table _plak_deduct_items (
    target_kind text not null,
    target_key text not null,
    full_path text not null,
    qty integer not null
  ) on commit drop;

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

    -- Every stock-tracked level from this leaf up to the root — e.g.
    -- ordering "MP393 / GOLD / BASE A" can deduct from BOTH GOLD's own
    -- independent stock and BASE A's (possibly Stock-Group-shared) stock
    -- in the same submission.
    insert into _plak_deduct_items (target_kind, target_key, full_path, qty)
    select
      case when a.stock_group_key is not null then 'group' else 'node' end,
      coalesce(a.stock_group_key, a.id::text),
      v_item.full_path,
      v_item.qty
    from (
      with recursive ancestors as (
        select id, parent_id, stock_group_key, stock_qty
        from public.plak_catalog_nodes where id = v_node_id
        union all
        select p.id, p.parent_id, p.stock_group_key, p.stock_qty
        from public.plak_catalog_nodes p
        join ancestors c on c.parent_id = p.id
      )
      select * from ancestors
    ) a
    where a.stock_group_key is not null or a.stock_qty is not null;
  end loop;

  -- Stock-Group-backed targets: one lock+check+deduct per shared row.
  for v_target in
    select target_key, sum(qty)::integer as qty, string_agg(distinct full_path, ', ') as paths
    from _plak_deduct_items
    where target_kind = 'group'
    group by target_key
  loop
    select stock_qty, stock_baseline into v_stock, v_baseline
    from public.plak_stock_groups where key = v_target.target_key for update;

    if v_stock is null then continue; end if;

    if v_baseline is not null and v_baseline > 0 and v_stock <= (v_baseline * 0.15) then
      v_low_threshold := v_baseline * 0.15;
      v_reserve := ceil(v_low_threshold * 0.10);
      v_max_orderable := greatest(v_stock - v_reserve, 0);
      if v_target.qty > v_max_orderable then
        raise exception 'INSUFFICIENT_STOCK:%:%', v_target.paths, v_max_orderable;
      end if;
    elsif v_target.qty > v_stock then
      raise exception 'INSUFFICIENT_STOCK:%:%', v_target.paths, v_stock;
    end if;

    update public.plak_stock_groups set stock_qty = stock_qty - v_target.qty where key = v_target.target_key;
  end loop;

  -- Independently-tracked node targets — a leaf's own stock, or a parent's
  -- like GOLD's, whichever levels along the path aren't in a Stock Group.
  for v_target in
    select target_key, sum(qty)::integer as qty, min(full_path) as full_path
    from _plak_deduct_items
    where target_kind = 'node'
    group by target_key
  loop
    select stock_qty, stock_baseline into v_stock, v_baseline
    from public.plak_catalog_nodes where id = v_target.target_key::uuid for update;

    if v_stock is null then continue; end if;

    if v_baseline is not null and v_baseline > 0 and v_stock <= (v_baseline * 0.15) then
      v_low_threshold := v_baseline * 0.15;
      v_reserve := ceil(v_low_threshold * 0.10);
      v_max_orderable := greatest(v_stock - v_reserve, 0);
      if v_target.qty > v_max_orderable then
        raise exception 'INSUFFICIENT_STOCK:%:%', v_target.full_path, v_max_orderable;
      end if;
    elsif v_target.qty > v_stock then
      raise exception 'INSUFFICIENT_STOCK:%:%', v_target.full_path, v_stock;
    end if;

    update public.plak_catalog_nodes set stock_qty = stock_qty - v_target.qty where id = v_target.target_key::uuid;
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
  v_target record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  create temporary table _plak_restore_items (
    target_kind text not null,
    target_key text not null,
    qty integer not null
  ) on commit drop;

  for v_item in
    select full_path, sum(qty)::integer as qty
    from jsonb_to_recordset(p_items) as x(full_path text, qty integer)
    group by full_path
  loop
    if v_item.full_path is null or v_item.qty is null or v_item.qty <= 0 then continue; end if;
    v_node_id := public.resolve_plak_node_id(v_item.full_path);
    if v_node_id is null then continue; end if;

    insert into _plak_restore_items (target_kind, target_key, qty)
    select
      case when a.stock_group_key is not null then 'group' else 'node' end,
      coalesce(a.stock_group_key, a.id::text),
      v_item.qty
    from (
      with recursive ancestors as (
        select id, parent_id, stock_group_key, stock_qty
        from public.plak_catalog_nodes where id = v_node_id
        union all
        select p.id, p.parent_id, p.stock_group_key, p.stock_qty
        from public.plak_catalog_nodes p
        join ancestors c on c.parent_id = p.id
      )
      select * from ancestors
    ) a
    where a.stock_group_key is not null or a.stock_qty is not null;
  end loop;

  -- Grouped targets: cap at the group's own baseline.
  for v_target in
    select target_key, sum(qty)::integer as qty
    from _plak_restore_items where target_kind = 'group'
    group by target_key
  loop
    update public.plak_stock_groups
      set stock_qty = least(stock_qty + v_target.qty, coalesce(stock_baseline, stock_qty + v_target.qty))
      where key = v_target.target_key;
  end loop;

  -- Independent node targets: cap at that node's own baseline.
  for v_target in
    select target_key, sum(qty)::integer as qty
    from _plak_restore_items where target_kind = 'node'
    group by target_key
  loop
    update public.plak_catalog_nodes
      set stock_qty = least(stock_qty + v_target.qty, coalesce(stock_baseline, stock_qty + v_target.qty))
      where id = v_target.target_key::uuid and stock_qty is not null;
  end loop;
end;
$function$;

revoke execute on function public.plak_stock_deduct(jsonb)  from public, anon;
revoke execute on function public.plak_stock_restore(jsonb) from public, anon;
grant execute on function public.plak_stock_deduct(jsonb)   to authenticated;
grant execute on function public.plak_stock_restore(jsonb)  to authenticated;
