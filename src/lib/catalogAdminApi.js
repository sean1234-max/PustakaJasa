import { supabase } from './supabaseClient';

// Reference sample images and the Jenis Plak catalog are global settings
// (not scoped to a single order or account) — Production manages both,
// everyone else just reads them. See supabase/migrations/0006_catalog_admin.sql.

export async function fetchReferenceImages() {
  const { data, error } = await supabase.from('catalog_reference_images').select('slot_id, image_data_url');
  if (error) throw error;
  const map = {};
  (data || []).forEach((row) => { map[row.slot_id] = row.image_data_url; });
  return map;
}

export async function saveReferenceImage(slotId, dataUrl) {
  const { error } = await supabase
    .from('catalog_reference_images')
    .upsert({ slot_id: slotId, image_data_url: dataUrl, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// Rebuilds the nested { id, code, price, hidden, children } tree PlakPicker
// and computeBlocks expect from the flat parent_id rows plak_catalog_nodes
// actually stores.
export function buildPlakTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, {
    id: r.id, code: r.code, price: Number(r.price) || 0, hidden: !!r.hidden, children: [],
  }]));
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
  const { data, error } = await supabase
    .from('plak_catalog_nodes')
    .select('id, parent_id, code, price, hidden, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return buildPlakTree(data || []);
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

// Batched sort_order write for drag-and-drop reordering (see AdminCatalog.jsx)
// — a drag can shift many siblings' indices at once, unlike the arrow
// buttons' single adjacent swap, so this is one upsert instead of N
// sequential updatePlakNode calls. Only ever targets existing ids (a
// reorder never creates or deletes rows), so the upsert's ON CONFLICT DO
// UPDATE path only ever touches the sort_order column passed in — it
// can't null out a row's parent_id/code/price/hidden.
export async function updatePlakNodeOrder(rows) {
  const { error } = await supabase.from('plak_catalog_nodes').upsert(rows);
  if (error) throw error;
}
