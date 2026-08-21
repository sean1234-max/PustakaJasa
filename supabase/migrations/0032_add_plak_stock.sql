-- Stock management for the Jenis Plak catalog. Each leaf node in
-- plak_catalog_nodes can now carry a current stock count (stock_qty) and
-- the reference quantity the 15%/25% low-stock thresholds are measured
-- against (stock_baseline) — set together whenever Production/Admin types
-- a new stock number (see updatePlakNodeStock in catalogAdminApi.js).
--
-- stock_qty IS NULL means "stock tracking not enabled for this item yet" —
-- it behaves exactly as before this migration (always visible, no
-- deduction, no cap). This matters because every existing row would
-- otherwise default to 0 stock the moment this migration runs, which
-- combined with the "0 stock = auto-hidden" rule below would wipe the
-- entire catalog from every teacher's New Order page until Production
-- manually re-entered a stock count for all ~150 existing codes. NULL lets
-- Production roll stock tracking out one code at a time.
alter table public.plak_catalog_nodes
  add column stock_qty integer,
  add column stock_baseline integer;

alter table public.plak_catalog_nodes
  add constraint plak_catalog_nodes_stock_qty_check check (stock_qty is null or stock_qty >= 0);
alter table public.plak_catalog_nodes
  add constraint plak_catalog_nodes_stock_baseline_check check (stock_baseline is null or stock_baseline > 0);

-- Resolves a leaf's " / "-joined full path (exactly what PlakPicker commits
-- as an order item's `jenisPlak` — see src/data/catalog.js
-- flattenPlakCatalog) back to its plak_catalog_nodes.id, by walking the
-- tree root-to-leaf. Needed because `code` alone isn't unique (sibling
-- variants like "BASE A" repeat under GOLD/SILVER/BRONZE) — the full path
-- is the only reliably unique key the client already uses everywhere else.
create or replace function public.resolve_plak_node_id(p_full_path text)
returns uuid
language sql
stable
set search_path = public
as $$
  with recursive tree as (
    select id, parent_id, code::text as full_path
    from public.plak_catalog_nodes
    where parent_id is null
    union all
    select n.id, n.parent_id, t.full_path || ' / ' || n.code
    from public.plak_catalog_nodes n
    join tree t on n.parent_id = t.id
  )
  select id from tree where full_path = p_full_path limit 1;
$$;

-- Atomically checks and deducts stock for a batch of order items in one
-- transaction (a Postgres function body is already one transaction) — all
-- items succeed or none do, so a New Order/Add On submission can never
-- deduct only some of its lines. `p_items` is a jsonb array of
-- {full_path, qty}; duplicate full_paths (rare, but possible if a teacher
-- picks the same code in two categories) are summed before checking.
--
-- Enforcement mirrors the client-side preview in
-- src/data/catalog.js getStockStatus:
--   - stock_qty IS NULL (tracking not enabled) -> always allowed, no-op.
--   - Once stock_qty drops to <=15% of stock_baseline, a fixed reserve
--     (10% of the 15% threshold, e.g. baseline 1000 -> threshold 150 ->
--     reserve 15) is permanently protected — the max orderable is
--     current stock minus that reserve, recalculated live each call so it
--     shrinks as stock depletes but the reserve itself never does.
--   - Outside that zone, the only limit is total stock on hand.
-- `for update` row-locks each touched node so concurrent submissions for
-- the same code serialize instead of both reading a pre-deduction count.
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

-- Adds stock back (Add On rejected/withdrawn after its submission-time
-- deduction — see rejectAddOn/cancelPendingAddOn in AppState.jsx). Silently
-- skips anything that no longer resolves (code renamed/deleted since) or
-- isn't stock-tracked — there's nothing sensible to restore either way.
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

grant execute on function public.resolve_plak_node_id(text) to anon, authenticated;
grant execute on function public.plak_stock_deduct(jsonb) to anon, authenticated;
grant execute on function public.plak_stock_restore(jsonb) to anon, authenticated;
