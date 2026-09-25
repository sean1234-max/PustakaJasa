import { supabase } from './supabaseClient';
import { isCustomPlakCode } from '../data/catalog';

// The Jenis Plak catalog is a global setting (not scoped to a single order
// or account) — Production manages it, everyone else just reads it. See
// supabase/migrations/0006_catalog_admin.sql.

// Rebuilds the nested { id, code, price, hidden, children } tree PlakPicker
// and computeBlocks expect from the flat parent_id rows plak_catalog_nodes
// actually stores. `stockGroups` (plak_stock_groups rows) overrides a
// node's own stock_qty/stock_baseline whenever its stock_group_key points
// at one — see fetchPlakCatalog. stockGroupSize is how many nodes (this one
// included) currently share that key, used to show "shared with N others"
// in the catalog admin UI.
export function buildPlakTree(rows, stockGroups) {
  const groupByKey = new Map((stockGroups || []).map((g) => [g.key, g]));
  const groupSize = new Map();
  rows.forEach((r) => {
    if (r.stock_group_key) groupSize.set(r.stock_group_key, (groupSize.get(r.stock_group_key) || 0) + 1);
  });
  const byId = new Map(rows.map((r) => {
    const group = r.stock_group_key ? groupByKey.get(r.stock_group_key) : null;
    return [r.id, {
      id: r.id, code: r.code, price: Number(r.price) || 0, hidden: !!r.hidden,
      stockQty: group ? group.stock_qty : (r.stock_qty ?? null),
      stockBaseline: group ? group.stock_baseline : (r.stock_baseline ?? null),
      stockGroupKey: r.stock_group_key || null,
      stockGroupSize: r.stock_group_key ? (groupSize.get(r.stock_group_key) || 1) : 0,
      children: [],
    }];
  }));
  const roots = [];
  rows.forEach((r) => {
    const node = byId.get(r.id);
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(node);
    else roots.push(node);
  });
  // A node with zero children is a leaf everywhere else in the app — drop
  // the empty array rather than leave it as a falsy-but-present `[]`.
  const strip = (node) => {
    if (node.children.length === 0) delete node.children;
    else node.children.forEach(strip);
    return node;
  };
  roots.forEach(strip);
  return roots;
}

export async function fetchPlakCatalog() {
  const [{ data, error }, { data: groups, error: groupError }] = await Promise.all([
    supabase
      .from('plak_catalog_nodes')
      .select('id, parent_id, code, price, hidden, sort_order, stock_qty, stock_baseline, stock_group_key')
      .order('sort_order', { ascending: true }),
    supabase.from('plak_stock_groups').select('key, stock_qty, stock_baseline'),
  ]);
  if (error) throw error;
  if (groupError) throw groupError;
  return buildPlakTree(data || [], groups || []);
}

// parentId null adds a new top-level code; pass an existing node's id to
// add a variant underneath it. sortOrder controls where it lands among
// its siblings — callers pass the current sibling count.
export async function addPlakNode(parentId, code, price, sortOrder) {
  const { error } = await supabase
    .from('plak_catalog_nodes')
    .insert({ parent_id: parentId, code, price: price || 0, sort_order: sortOrder || 0 });
  if (error) throw error;
}

// Deletes the node and (via the FK's on delete cascade) every node beneath
// it — used for both "remove a whole code" and "remove one variant".
export async function removePlakNode(id) {
  const { error } = await supabase.from('plak_catalog_nodes').delete().eq('id', id);
  if (error) throw error;
}

export async function updatePlakNode(id, patch) {
  const { error } = await supabase.from('plak_catalog_nodes').update(patch).eq('id', id);
  if (error) throw error;
}

// Setting a new STOCK number (stock_baseline) shifts the running BALANCE
// (stock_qty) by the same delta instead of overwriting it — see
// 0073_stock_restock_preserves_balance.sql. `stockQty` here is the new
// STOCK/capital total Production just typed in, not the balance itself.
// Clearing the field (null) is a plain untrack — no delta to preserve,
// both columns go back to "not tracked" (see 0032_add_plak_stock.sql's
// header for why NULL is kept distinct from 0 there).
export async function updatePlakNodeStock(id, stockQty) {
  if (stockQty == null) {
    const { error } = await supabase
      .from('plak_catalog_nodes')
      .update({ stock_qty: null, stock_baseline: null })
      .eq('id', id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('plak_node_set_stock', { p_id: id, p_new_stock: stockQty });
  if (error) throw error;
}

// Attaches a node to a shared Stock Group (see 0058_add_plak_stock_groups.sql)
// — from then on its stock lives on the plak_stock_groups row instead of on
// the node itself. If the group doesn't exist yet, `initialStockQty` creates
// it (required — linking never sums or averages whatever independent
// numbers the newly-joining node had before, there's nothing sensible to
// derive it from). Joining an already-existing group leaves its number
// untouched and `initialStockQty` is ignored.
export async function linkPlakNodeToStockGroup(nodeId, groupKey, initialStockQty) {
  const key = (groupKey || '').trim();
  if (!key) throw new Error('Stock Group name is required.');
  const { data: existing, error: fetchError } = await supabase
    .from('plak_stock_groups').select('key').eq('key', key).maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) {
    const qty = Math.round(Number(initialStockQty));
    if (Number.isNaN(qty) || qty < 0) throw new Error('Enter a starting Stock Qty for this new Stock Group.');
    const { error: insertError } = await supabase
      .from('plak_stock_groups').insert({ key, stock_qty: qty, stock_baseline: qty });
    if (insertError) throw insertError;
  }
  const { error } = await supabase
    .from('plak_catalog_nodes')
    .update({ stock_group_key: key, stock_qty: null, stock_baseline: null })
    .eq('id', nodeId);
  if (error) throw error;
}

// Detaches a node from its Stock Group — it goes back to independent
// tracking starting from "not tracked yet" (stock_qty null), same as a
// brand new code. Never inherits a slice of the shared number on the way
// out; there's nothing sensible to split it by.
export async function unlinkPlakNodeFromStockGroup(nodeId) {
  const { error } = await supabase
    .from('plak_catalog_nodes')
    .update({ stock_group_key: null, stock_qty: null, stock_baseline: null })
    .eq('id', nodeId);
  if (error) throw error;
}

// Sets a Stock Group's shared STOCK number — same delta-preserving-balance
// behavior as updatePlakNodeStock above, just targeting the group row every
// linked node reads from instead of one node's own columns.
export async function updateStockGroupStock(groupKey, stockQty) {
  if (stockQty == null) {
    const { error } = await supabase
      .from('plak_stock_groups')
      .update({ stock_qty: null, stock_baseline: null })
      .eq('key', groupKey);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc('plak_stock_group_set_stock', { p_key: groupKey, p_new_stock: stockQty });
  if (error) throw error;
}

// Atomic, all-or-nothing stock deduction/restoration — see
// supabase/migrations/0032_add_plak_stock.sql for the enforcement rules.
// `items` is [{ full_path, qty }] where full_path is exactly an order
// item's `jenisPlak` (the " / "-joined catalog path PlakPicker commits).
export async function deductPlakStock(items) {
  const payload = (items || []).filter((it) => it.full_path && Number(it.qty) > 0 && !isCustomPlakCode(it.full_path))
    .map((it) => ({ full_path: it.full_path, qty: Math.round(Number(it.qty)) }));
  if (payload.length === 0) return;
  const { error } = await supabase.rpc('plak_stock_deduct', { p_items: payload });
  if (error) throw error;
}

export async function restorePlakStock(items) {
  const payload = (items || []).filter((it) => it.full_path && Number(it.qty) > 0 && !isCustomPlakCode(it.full_path))
    .map((it) => ({ full_path: it.full_path, qty: Math.round(Number(it.qty)) }));
  if (payload.length === 0) return;
  const { error } = await supabase.rpc('plak_stock_restore', { p_items: payload });
  if (error) throw error;
}

// Batched sort_order write for drag-and-drop reordering (see
// AdminCatalog.jsx / ProductionCatalog.jsx) — a drag can shift many
// siblings' indices at once, unlike the arrow buttons' single adjacent
// swap. This used to be a single upsert({id, sort_order}) call, which
// looked like it should only ever touch sort_order on the ON CONFLICT DO
// UPDATE path — but Postgres validates an upsert's NOT NULL constraints
// (code has none) against its INSERT shape before it ever evaluates the
// conflict, regardless of whether the row already exists, so every
// reorder failed with "null value in column code violates not-null
// constraint". Plain per-row updates (still fired in parallel, so it's
// still one batch of concurrent requests, just not one SQL statement)
// only ever touch the column actually being set.
export async function updatePlakNodeOrder(rows) {
  const results = await Promise.all(
    rows.map(({ id, sort_order }) => supabase.from('plak_catalog_nodes').update({ sort_order }).eq('id', id)),
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}
