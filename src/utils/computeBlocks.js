import { CATEGORIES, flattenPlakCatalog } from '../data/catalog';

export function snapshotDetail(catKey, blockIdx, isMatrix, lineValues, matrixValues, rowsByBlockMap) {
  const detail = { lines: {}, matrix: null, rows: null };
  const linePrefix = `${catKey}::${blockIdx}::`;
  Object.keys(lineValues).forEach((k) => { if (k.startsWith(linePrefix)) detail.lines[k] = lineValues[k]; });
  if (isMatrix) {
    detail.matrix = {};
    const matPrefix = `${catKey}::`;
    Object.keys(matrixValues).forEach((k) => { if (k.startsWith(matPrefix)) detail.matrix[k] = matrixValues[k]; });
  } else {
    detail.rows = JSON.parse(JSON.stringify(rowsByBlockMap[`${catKey}::${blockIdx}`] || []));
  }
  return detail;
}

// Pure-ish computation of the editable "blocks" for a category — mirrors the
// original prototype's computeBlocks so the calculation rules (matrix totals,
// harga = qty * price) stay identical. `updaters` are callbacks the caller
// wires to its own state setters; pass no-ops for read-only rendering.
// `plakCatalog` is the live (Production-editable) catalog tree — flattened
// once here rather than per plak row.
export function computeBlocks(catKey, pbdVariant, lineValues, matrixValues, rowsByBlockMap, plakRowsMap, namaKelasRows, updaters, plakCatalog) {
  const flatPrices = flattenPlakCatalog(plakCatalog);
  const priceFor = (code) => {
    const entry = flatPrices.find((p) => p.code === code);
    return entry ? entry.price : null;
  };
  const currentCat = CATEGORIES.find((c) => c.key === catKey) || CATEGORIES[0];
  const isMatrix = currentCat.mode === 'matrix';
  const blocksCount = currentCat.blocksCount || 1;
  const isPbdCategory = currentCat.key === 'PBD';
  const activeIndices = isPbdCategory ? [pbdVariant] : Array.from({ length: blocksCount }, (_, i) => i);
  const blocks = [];

  for (const b of activeIndices) {
    const lines = currentCat.linePlaceholders.map((placeholder, i) => {
      const key = `${catKey}::${b}::${i}`;
      const line = {
        key, num: i + 1, placeholder, value: lineValues[key] || '',
        onChange: (val) => updaters.onLine(key, val),
      };
      // "position" (index 2) gets an optional second box — both numbered
      // "3" — so the teacher can split it without needing to know to press
      // Enter inside a single field. Combined with a line break on export.
      if (i === 2 && currentCat.positionLine2Placeholder) {
        const key2 = `${catKey}::${b}::2b`;
        line.secondLine = {
          key: key2, placeholder: currentCat.positionLine2Placeholder, value: lineValues[key2] || '',
          onChange: (val) => updaters.onLine(key2, val),
        };
      }
      return line;
    });

    let matrixRows = [], columns = [], colTotals = [], grandTotal = 0, rows = [], blockTotalQty = 0;

    if (isMatrix) {
      columns = currentCat.columns;
      colTotals = columns.map(() => 0);
      matrixRows = currentCat.subjects.map((subj) => {
        let rowTotal = 0;
        const cells = columns.map((col, ci) => {
          const key = `${catKey}::${subj}::${col}`;
          const val = Number(matrixValues[key]) || 0;
          rowTotal += val; colTotals[ci] += val;
          return { key, col, value: matrixValues[key] || '', onChange: (v) => updaters.onMatrix(key, v) };
        });
        return { subject: subj, cells, rowTotal };
      });
      grandTotal = colTotals.reduce((a, b2) => a + b2, 0);
      blockTotalQty = grandTotal;
    } else {
      const rowsKey = `${catKey}::${b}`;
      const rawRows = rowsByBlockMap[rowsKey] || [];
      rows = rawRows.map((row) => ({
        id: row.id, desc: row.desc, qty: row.qty,
        setDesc: (v) => updaters.onRowField(rowsKey, row.id, 'desc', v),
        setQty: (v) => updaters.onRowField(rowsKey, row.id, 'qty', v),
        remove: () => updaters.onRowRemove(rowsKey, row.id),
      }));
      blockTotalQty = rawRows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    }

    const plakRowsKey = `${catKey}::${b}`;
    const rawPlakRows = plakRowsMap[plakRowsKey] || [];
    const plakRows = rawPlakRows.map((pr) => {
      const unitPrice = priceFor(pr.jenisPlak);
      const harga = unitPrice != null ? blockTotalQty * unitPrice : 0;
      return {
        id: pr.id, jenisPlak: pr.jenisPlak, qty: blockTotalQty, rawHarga: harga,
        unitPrice,
        hargaLabel: unitPrice != null ? `RM ${harga.toFixed(2)}` : '—',
        setJenisPlak: (v) => updaters.onPlakSelect(plakRowsKey, pr.id, v),
      };
    });

    const showNamaKelas = isPbdCategory && b === 0 && !!updaters.onNamaKelas;
    const nkRows = showNamaKelas ? (namaKelasRows || []).map((nk) => ({
      id: nk.id, namaKelas: nk.namaKelas, tahun: nk.tahun,
      setNamaKelas: (v) => updaters.onNamaKelas('namaKelas', nk.id, v),
      setTahun: (v) => updaters.onNamaKelas('tahun', nk.id, v),
      remove: () => updaters.onNamaKelasRemove(nk.id),
    })) : [];

    blocks.push({
      idx: b,
      qtyLabel: currentCat.variantLabels ? currentCat.variantLabels[b] : currentCat.label,
      qtyColHeader: isMatrix ? 'QTY' : (currentCat.qtyColumnLabels ? currentCat.qtyColumnLabels[b] : 'QTY'),
      sampleSlotId: `sample-${catKey}-${b}`,
      lines, isMatrix, columns, matrixRows,
      colTotals: colTotals.map((v) => ({ value: v })), grandTotal,
      rows,
      addRow: () => updaters.onAddRow(`${catKey}::${b}`),
      blockTotalQty, plakRows, showNamaKelas, namaKelasRows: nkRows,
      addNamaKelasRow: updaters.onAddNamaKelas || (() => {}),
    });
  }

  return { blocks, isMatrix, isPbdCategory, blocksCount };
}

export const noopUpdaters = {
  onLine: () => {}, onMatrix: () => {}, onRowField: () => {}, onRowRemove: () => {},
  onAddRow: () => {}, onPlakSelect: () => {},
};

// Rebuilds read-only `blocks` (the same shape NewOrderStep2 renders live)
// for one category of an already-submitted order, straight from each
// item's stored `detail` snapshot — lets Sales/Production reuse
// OrderCategoryBlock to show exactly what the teacher filled in, instead
// of re-deriving a simplified summary. Groups items by blockIdx so a
// category with more than one block (e.g. both PBD variants used in the
// same order) renders every block, not just one.
export function reconstructBlocksForCategory(order, catKey, plakCatalog) {
  const items = (order.items || []).filter((it) => it.categoryKey === catKey);
  const blockIdxs = [...new Set(items.map((it) => it.blockIdx ?? 0))];
  const allBlocks = [];
  let isMatrix = false;

  blockIdxs.forEach((blockIdx) => {
    const blockItems = items.filter((it) => (it.blockIdx ?? 0) === blockIdx);
    const lineValues = {};
    const matrixValues = {};
    const rowsByBlock = {};
    const plakRows = {};
    const key = `${catKey}::${blockIdx}`;
    blockItems.forEach((it) => {
      if (it.detail) {
        Object.assign(lineValues, it.detail.lines || {});
        if (it.detail.matrix) Object.assign(matrixValues, it.detail.matrix);
        if (it.detail.rows) rowsByBlock[key] = it.detail.rows;
      }
      plakRows[key] = [...(plakRows[key] || []), { id: it.id, jenisPlak: it.jenisPlak }];
    });
    const result = computeBlocks(catKey, blockIdx, lineValues, matrixValues, rowsByBlock, plakRows, [], noopUpdaters, plakCatalog);
    isMatrix = result.isMatrix;
    allBlocks.push(...result.blocks);
  });

  return { blocks: allBlocks, isMatrix };
}
