-- Lets several plak_catalog_nodes rows — leaves, or even a parent with
-- children (e.g. "CRYSTAL MEDAL" whose DESIGN A/B/C variants shouldn't
-- each track their own count) — share one stock number instead of each
-- tracking independently. A code like "BASE A" repeats identically under
-- GOLD/SILVER/BRONZE across several different top-level codes but is
-- physically the same component, so selling any of them should deduct
-- from one shared pool.
--
-- Linking is manual and by name, never auto-matched by code text:
-- Production types the same stock_group_key on every node that should
-- share stock (see catalogAdminApi.js / ProductionCatalog.jsx /
-- AdminCatalog.jsx). A node with stock_group_key set ignores its own
-- stock_qty/stock_baseline entirely — the shared numbers live here.
create table public.plak_stock_groups (
  key text primary key,
  stock_qty integer not null check (stock_qty >= 0),
  stock_baseline integer check (stock_baseline is null or stock_baseline > 0),
  created_at timestamptz not null default now()
);

alter table public.plak_stock_groups enable row level security;

-- Mirrors plak_catalog_nodes' own policy shape exactly (see
-- 0006_catalog_admin.sql) — everyone signed in reads, only admin/production
-- (production while active) write.
create policy "authenticated reads stock groups" on public.plak_stock_groups
  for select using (auth.role() = 'authenticated');
create policy "admin writes stock groups" on public.plak_stock_groups
  for insert with check (public.current_role() = 'admin');
create policy "admin updates stock groups" on public.plak_stock_groups
  for update using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create policy "admin deletes stock groups" on public.plak_stock_groups
  for delete using (public.current_role() = 'admin');
create policy "production writes stock groups" on public.plak_stock_groups
  for insert with check (public.current_role() = 'production' and public.current_status() = 'active');
create policy "production updates stock groups" on public.plak_stock_groups
  for update using (public.current_role() = 'production' and public.current_status() = 'active')
  with check (public.current_role() = 'production' and public.current_status() = 'active');
create policy "production deletes stock groups" on public.plak_stock_groups
  for delete using (public.current_role() = 'production' and public.current_status() = 'active');

alter table public.plak_catalog_nodes
  add column stock_group_key text references public.plak_stock_groups(key) on delete set null;

create index plak_catalog_nodes_stock_group_key_idx
  on public.plak_catalog_nodes(stock_group_key) where stock_group_key is not null;

-- plak_stock_deduct / plak_stock_restore: same role checks and
-- restore-capped-at-baseline rule as 0053_bound_stock_rpcs.sql, but each
-- item now resolves to its real stock-tracked target first — its own node,
-- or the plak_stock_groups row it's linked to via stock_group_key — and
-- quantities are summed by THAT target rather than by node. Two different
-- full_paths sharing a group (e.g. one order buying both the GOLD and the
-- SILVER variant of the same shared "BASE A") must be checked together, or
-- the shared pool could be oversold by a single submission.
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
    node_id uuid not null,
    stock_group_key text,
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

    insert into _plak_deduct_items (node_id, stock_group_key, full_path, qty)
    select v_node_id, pcn.stock_group_key, v_item.full_path, v_item.qty
    from public.plak_catalog_nodes pcn where pcn.id = v_node_id;
  end loop;

  -- Grouped items: one lock+check+deduct per shared plak_stock_groups row.
  for v_target in
    select stock_group_key, sum(qty)::integer as qty, string_agg(distinct full_path, ', ') as paths
    from _plak_deduct_items
    where stock_group_key is not null
    group by stock_group_key
  loop
    select stock_qty, stock_baseline into v_stock, v_baseline
    from public.plak_stock_groups where key = v_target.stock_group_key for update;

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

    update public.plak_stock_groups set stock_qty = stock_qty - v_target.qty where key = v_target.stock_group_key;
  end loop;

  -- Ungrouped items: unchanged per-node logic.
  for v_target in
    select node_id, sum(qty)::integer as qty, min(full_path) as full_path
    from _plak_deduct_items
    where stock_group_key is null
    group by node_id
  loop
    select stock_qty, stock_baseline into v_stock, v_baseline
    from public.plak_catalog_nodes where id = v_target.node_id for update;

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

    update public.plak_catalog_nodes set stock_qty = stock_qty - v_target.qty where id = v_target.node_id;
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
    node_id uuid not null,
    stock_group_key text,
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

    insert into _plak_restore_items (node_id, stock_group_key, qty)
    select v_node_id, pcn.stock_group_key, v_item.qty
    from public.plak_catalog_nodes pcn where pcn.id = v_node_id;
  end loop;

  -- Grouped items: cap at the group's own baseline, same rule as below.
  for v_target in
    select stock_group_key, sum(qty)::integer as qty
    from _plak_restore_items where stock_group_key is not null
    group by stock_group_key
  loop
    update public.plak_stock_groups
      set stock_qty = least(stock_qty + v_target.qty, coalesce(stock_baseline, stock_qty + v_target.qty))
      where key = v_target.stock_group_key;
  end loop;

  -- Ungrouped items: unchanged — cap at the node's own baseline.
  for v_target in
    select node_id, sum(qty)::integer as qty
    from _plak_restore_items where stock_group_key is null
    group by node_id
  loop
    update public.plak_catalog_nodes
      set stock_qty = least(stock_qty + v_target.qty, coalesce(stock_baseline, stock_qty + v_target.qty))
      where id = v_target.node_id and stock_qty is not null;
  end loop;
end;
$function$;

revoke execute on function public.plak_stock_deduct(jsonb)  from public, anon;
revoke execute on function public.plak_stock_restore(jsonb) from public, anon;
grant execute on function public.plak_stock_deduct(jsonb)   to authenticated;
grant execute on function public.plak_stock_restore(jsonb)  to authenticated;
