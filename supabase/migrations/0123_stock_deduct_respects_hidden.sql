-- A teacher / salesman can no longer take a Jenis Plak that is hidden from the picker (Sean, 2026-11-11):
-- PK 261 / A was auto-hidden at <= 20% of its baseline from 10-30, yet ~640 more were ordered from tabs left
-- open for days (the catalog is read once per login, so the browser's check passed). Same rule as
-- filterHiddenPlakCatalog (src/data/catalog.js): the code or any level above it is hidden, or is at 0 / at or
-- below 20% of its baseline (its Stock Group's numbers when it has one) without show_when_low.
-- Production is not limited (it manages stock and adds for one school on purpose).
-- Only increases are deducted (an edited order's existing pieces are never re-checked).
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
  if coalesce(public.current_role(), '') not in ('teacher', 'salesman', 'production') then
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

    if public.current_role() in ('teacher', 'salesman') and exists (
      with recursive anc as (
        select id, parent_id, hidden, show_when_low, stock_qty, stock_baseline, stock_group_key
        from public.plak_catalog_nodes where id = v_node_id
        union all
        select p.id, p.parent_id, p.hidden, p.show_when_low, p.stock_qty, p.stock_baseline, p.stock_group_key
        from public.plak_catalog_nodes p
        join anc on anc.parent_id = p.id
      ), eff as (
        select coalesce(anc.hidden, false) as hidden, coalesce(anc.show_when_low, false) as show_when_low,
          case when g.key is not null then g.stock_qty else anc.stock_qty end as qty,
          case when g.key is not null then g.stock_baseline else anc.stock_baseline end as baseline
        from anc left join public.plak_stock_groups g on g.key = anc.stock_group_key
      )
      select 1 from eff
      where hidden
         or (not show_when_low and qty is not null
             and (qty = 0 or (coalesce(baseline, 0) > 0 and qty <= baseline * 0.20)))
    ) then
      raise exception 'INSUFFICIENT_STOCK:%:0', v_item.full_path;
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
