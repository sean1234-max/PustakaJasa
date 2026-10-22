// The teacher's uploaded FORM ANUGERAH file(s) behind an order (0055, 0083).
// A draft can import more than one Excel before submitting, so each cart
// item carries the `importFile` (storage path) it was added from, and the
// order keeps every file its items came from.

// Cart items added while `path` was the draft's latest upload.
export function withImportFile(items, path) {
  return path ? items.map((it) => ({ ...it, importFile: path })) : items;
}

// Each cart item tagged with the upload its tab came from (several files in one order, Sean
// 2026-10-22: NewOrderStep2.jsx's step2UploadedFiles says which file filled which tab); the
// draft's latest upload when that isn't known (yet).
export function tagImportFiles(items, st) {
  const uploaded = [...(st.step2UploadedFiles || [])].reverse();
  const known = [...(st.importFiles || [])].reverse();
  const pathFor = (catKey) => {
    const owner = uploaded.find((f) => (f.categories || []).includes(catKey));
    return (owner && known.find((f) => f.name === owner.name)?.path) || st.importFilePath;
  };
  return items.map((it) => {
    const path = pathFor(it.categoryKey);
    return path ? { ...it, importFile: path } : it;
  });
}

// The order's import columns at submit, from the draft: the files its cart
// items came from, in cart order (names from the draft's upload list). A
// cart with no tagged item (added before the upload finished) falls back to
// the draft's latest upload, as before.
export function orderImportFields(st) {
  const known = st.importFiles || [];
  const paths = [...new Set((st.cart || []).map((ci) => ci.importFile).filter(Boolean))];
  const files = paths.length
    ? paths.map((path) => known.find((f) => f.path === path) || { path, name: 'order.xlsx' })
    : (st.importFilePath ? [{ path: st.importFilePath, name: st.importFileName || 'order.xlsx' }] : []);
  return {
    importFilePath: files[0]?.path || null,
    importFileName: files[0]?.name || null,
    importFiles: files,
  };
}

// The Excel(s) a submitted add-on was imported from (each add-on item
// carries its `importFile`, like a cart item).
export function addonImportFiles(order) {
  const paths = [...new Set((order?.pendingAddonItems || []).map((it) => it.importFile).filter(Boolean))];
  return paths.map((path) => ({ path, name: 'tambahan.xlsx' }));
}

// Every uploaded file on a saved order — older orders only have the single
// import_file_path.
export function orderImportFiles(order) {
  if (order?.importFiles?.length) return order.importFiles;
  return order?.importFilePath ? [{ path: order.importFilePath, name: order.importFileName || 'order.xlsx' }] : [];
}
