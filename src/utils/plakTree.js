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
      id: r.id, code: r.code, price: Number(r.price) || 0, hidden: !!r.hidden, showWhenLow: !!r.show_when_low,
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
