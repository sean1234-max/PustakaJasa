// The teacher's uploaded FORM ANUGERAH file(s) behind an order (0055, 0083).
// A draft can import more than one Excel before submitting, so each cart
// item carries the `importFile` (storage path) it was added from, and the
// order keeps every file its items came from.

// Cart items added while `path` was the draft's latest upload.
export function withImportFile(items, path) {
  return path ? items.map((it) => ({ ...it, importFile: path })) : items;
}

// Each cart item tagged with the upload its tab came from (several files in one order, Sean
// 2026-10-22: NewOrderStep2.jsx's step2UploadedFiles says which file filled which tab). A tab no
// upload filled was typed by hand: no file (Sean, 2026-11-23: ORD-0594's typed plaques got an
// old SK MERU (2) upload still in the draft). Only a draft that doesn't say which file filled
// which tab (no step2UploadedFiles) still takes its latest upload.
export function tagImportFiles(items, st) {
  const uploaded = [...(st.step2UploadedFiles || [])].reverse();
  const known = [...(st.importFiles || [])].reverse();
  const pathFor = (catKey) => {
    if (!uploaded.length) return st.importFilePath;
    const owner = uploaded.find((f) => (f.categories || []).includes(catKey));
    return (owner && known.find((f) => f.name === owner.name)?.path) || null;
  };
  return items.map((it) => {
    const path = pathFor(it.categoryKey);
    return path ? { ...it, importFile: path } : it;
  });
}

// The order's import columns at submit, from the draft: the files its cart
// items came from, in cart order (names from the draft's upload list) — none
// when every plaque was typed by hand, whatever the draft uploaded before
// (Sean, 2026-11-23: ORD-0594 got an old upload and its check compared the wrong file).
export function orderImportFields(st) {
  const known = st.importFiles || [];
  const paths = [...new Set((st.cart || []).map((ci) => ci.importFile).filter(Boolean))];
  const files = paths.map((path) => known.find((f) => f.path === path) || { path, name: 'order.xlsx' });
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

// Salesman Edit Order (Sean, 2026-11-07): which order files the saved edit uses. A file uploaded during
// the edit replaces the order's own (they move to `replaced`, kept but no longer read); none uploaded —
// the order keeps its files. Production's Corrected Excel is always replaced: the salesman's version is now
// the order. Items kept from before stop pointing at a replaced file.
export function editedOrderFiles(order, st, now) {
  const oldFiles = orderImportFiles(order);
  const oldPaths = new Set(oldFiles.map((f) => f.path));
  const used = orderImportFields(st).importFiles.filter((f) => !oldPaths.has(f.path));
  const newFiles = used.length ? used : (st.importFiles || []);
  const replaced = [
    ...(newFiles.length ? oldFiles : []),
    ...(order.correctedImportFilePath ? [{ path: order.correctedImportFilePath, name: order.correctedImportFileName || 'corrected.xlsx', corrected: true }] : []),
  ].map((f) => ({ ...f, replacedAt: now }));
  const items = (st.cart || []).map((ci) => {
    if (!newFiles.length || !ci.importFile || !oldPaths.has(ci.importFile)) return { ...ci };
    const rest = { ...ci };
    delete rest.importFile;
    return rest;
  });
  return { newFiles, replaced, items };
}
