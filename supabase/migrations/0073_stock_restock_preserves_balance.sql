-- Production/Admin's "Stock Qty" field used to double as both the starting
-- capital number AND a hard reset of the running balance (updatePlakNodeStock
-- always set stock_qty = stock_baseline = whatever was typed) — so restocking
-- required manually working out "how much is left + how much just arrived"
-- and typing THAT combined number in, or the running balance (and whatever
-- had already been deducted against it) got silently wiped.
--
-- Split into two concepts the admin UI now shows as separate columns:
--   * STOCK (stock_baseline) — the known "capital" total, edited directly.
--   * BALANCE (stock_qty) — what's actually left, read-only, computed.
-- Typing a new STOCK number now shifts the balance by the SAME delta
-- instead of overwriting it — e.g. STOCK 1000, 200 already used (balance
-- 800); restocking STOCK to 1300 moves balance to 1100 (1300 - 200), not a
-- reset to 1300. stock_baseline already existed (used only for the 15%/25%
-- low-stock thresholds — see stockZoneFor/getStockStatus in catalog.js),
-- this just makes it the number Production actually edits, and preserves
-- stock_qty's own running total across that edit instead of clobbering it.
--
-- A plain client-side read-then-write can't express "stock_qty +=
-- (new_baseline - old_baseline)" atomically (supabase-js has no raw-SQL
-- update expression), so this is an RPC — same reasoning as
-- plak_stock_deduct/restore already being RPCs rather than direct updates.
create or replace function public.plak_node_set_stock(p_id uuid, p_new_stock integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (public.current_role() = 'admin'
          or (public.current_role() = 'production' and public.current_status() = 'active')) then
    raise exception 'Not authorized.';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'Stock must be zero or greater.';
  end if;

  update public.plak_catalog_nodes
  set stock_qty = greatest(coalesce(stock_qty, 0) + (p_new_stock - coalesce(stock_baseline, 0)), 0),
      stock_baseline = p_new_stock
  where id = p_id;
end;
$function$;

create or replace function public.plak_stock_group_set_stock(p_key text, p_new_stock integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (public.current_role() = 'admin'
          or (public.current_role() = 'production' and public.current_status() = 'active')) then
    raise exception 'Not authorized.';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'Stock must be zero or greater.';
  end if;

  update public.plak_stock_groups
  set stock_qty = greatest(coalesce(stock_qty, 0) + (p_new_stock - coalesce(stock_baseline, 0)), 0),
      stock_baseline = p_new_stock
  where key = p_key;
end;
$function$;

revoke execute on function public.plak_node_set_stock(uuid, integer) from public, anon;
revoke execute on function public.plak_stock_group_set_stock(text, integer) from public, anon;
grant execute on function public.plak_node_set_stock(uuid, integer) to authenticated;
grant execute on function public.plak_stock_group_set_stock(text, integer) to authenticated;
