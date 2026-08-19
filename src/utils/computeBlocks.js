import {
  CATEGORIES, flattenPlakCatalog, getCategorySubjects, getCategoryColumns,
  getCustomMatrixRowIds, customMatrixLabelKey, customMatrixCellKey,
} from '../data/catalog';

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
export function computeBlocks(catKey, pbdVariant, lineValues, matrixValues, rowsByBlockMap, plakRowsMap, namaKelasRows, updaters, plakCatalog, schoolLanguage = 'SK') {
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
      columns = getCategoryColumns(currentCat, schoolLanguage);
      colTotals = columns.map(() => 0);
      matrixRows = getCategorySubjects(currentCat, schoolLanguage).map((subj) => {
        let rowTotal = 0;
        const cells = columns.map((col, ci) => {
          const key = `${catKey}::${subj}::${col}`;
          const val = Number(matrixValues[key]) || 0;
          rowTotal += val; colTotals[ci] += val;
          return { key, col, value: matrixValues[key] || '', onChange: (v) => updaters.onMatrix(key, v) };
        });
        return { subject: subj, cells, rowTotal, custom: false };
      });

      // Teacher-added rows for a subject/award not on the fixed list above
      // (see OrderCategoryBlock's matrix "+ Add Row") — same cell shape, just
      // sourced from getCustomMatrixRowIds instead of the catalog list, and
      // with an editable subject label instead of a fixed one.
      matrixRows.push(...getCustomMatrixRowIds(catKey, matrixValues).map((rowId) => {
        let rowTotal = 0;
        const cells = columns.map((col, ci) => {
          const key = customMatrixCellKey(catKey, rowId, col);
          const val = Number(matrixValues[key]) || 0;
          rowTotal += val; colTotals[ci] += val;
          return { key, col, value: matrixValues[key] || '', onChange: (v) => updaters.onMatrix(key, v) };
        });
        const labelKey = customMatrixLabelKey(catKey, rowId);
        return {
          id: rowId,
          subject: matrixValues[labelKey] || '',
          setSubject: (v) => updaters.onMatrix(labelKey, v),
          cells, rowTotal, custom: true,
          remove: () => updaters.onMatrixRowRemove(catKey, rowId),
        };
      }));

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
      // Reviewing/printing an already-submitted order (reconstructBlocksForCategory
      // below) carries the item's actual approved unitPrice — possibly
      // Sales-negotiated away from the standard catalog rate — so that's used
      // as-is instead of re-deriving a price from the live catalog, which can
      // silently miss (e.g. the catalog code was since renamed) or simply not
      // reflect a negotiated price. Live order-creation flows (New Order,
      // Amend, Add On) never set pr.unitPrice since no price exists yet there,
      // so they keep falling back to the catalog lookup as before.
      const unitPrice = pr.unitPrice != null ? pr.unitPrice : priceFor(pr.jenisPlak);
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
      addMatrixRow: () => updaters.onAddMatrixRow(catKey),
      blockTotalQty, plakRows, showNamaKelas, namaKelasRows: nkRows,
      addNamaKelasRow: updaters.onAddNamaKelas || (() => {}),
    });
  }

  return { blocks, isMatrix, isPbdCategory, blocksCount };
}

export const noopUpdaters = {
  onLine: () => {}, onMatrix: () => {}, onRowField: () => {}, onRowRemove: () => {},
  onAddRow: () => {}, onPlakSelect: () => {}, onAddMatrixRow: () => {}, onMatrixRowRemove: () => {},
};

// Rebuilds read-only `blocks` (the same shape NewOrderStep2 renders live)
// for one category of an already-submitted order, straight from each
// item's stored `detail` snapshot — lets Sales/Production reuse
// OrderCategoryBlock to show exactly what the teacher filled in, instead
// of re-deriving a simplified summary. Groups items by blockIdx so a
// category with more than one block (e.g. both PBD variants used in the
// same order) renders every block, not just one.
//
// A block can be backed by more than one item — either several Jenis Plak
// rows added in the same round, or an Add On that reused the same
// category/block in a later round (see groupItemsByBatch in
// src/utils/orderBatches.js). Every item sharing a block carries its own
// full copy of that round's `detail.rows` (list-mode categories' per-desc
// qty breakdown), so combining rounds means SUMMING matching-desc rows
// together, not letting a later item's copy silently replace an earlier
// one — the earlier bug here dropped every round but the last, understating
// the on-screen quantity table (and, for Production, undercounting the
// exported CSV) whenever a block spanned more than one round.
export function reconstructBlocksForCategory(order, catKey, plakCatalog) {
  const schoolLanguage = order.schoolLanguage === 'SJKC' ? 'SJKC' : 'SK';
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
        if (it.detail.rows) {
          if (!rowsByBlock[key]) {
            rowsByBlock[key] = it.detail.rows.map((r) => ({ ...r }));
          } else {
            it.detail.rows.forEach((r) => {
              const existing = rowsByBlock[key].find((er) => er.desc === r.desc);
              if (existing) existing.qty = (Number(existing.qty) || 0) + (Number(r.qty) || 0);
              else rowsByBlock[key].push({ ...r });
            });
          }
        }
      }
      plakRows[key] = [...(plakRows[key] || []), { id: it.id, jenisPlak: it.jenisPlak, unitPrice: it.unitPrice }];
    });
    const result = computeBlocks(catKey, blockIdx, lineValues, matrixValues, rowsByBlock, plakRows, [], noopUpdaters, plakCatalog, schoolLanguage);
    isMatrix = result.isMatrix;
    allBlocks.push(...result.blocks);
  });

  return { blocks: allBlocks, isMatrix };
}

// Same idea as reconstructBlocksForCategory, but for Production
// (src/pages/ProductionOrderDetail.jsx) — deliberately does NOT merge
// anything. One group per ITEM: different items must never share an
// export even when they're the same block from the same round, because
// each item's own Jenis Plak decides which physical AI file the exported
// CSV's text gets dropped into (e.g. an MP399 file vs a VB/A file) — two
// Jenis Plak rows sitting in one combined export would mix text meant for
// two different files with no way to tell which rows belong to which.
export function reconstructOrderDetailGroups(order, catKey, plakCatalog) {
  const schoolLanguage = order.schoolLanguage === 'SJKC' ? 'SJKC' : 'SK';
  const items = (order.items || []).filter((it) => it.categoryKey === catKey);

  return items.map((item) => {
    const blockIdx = item.blockIdx ?? 0;
    const batch = item.batch || 0;
    const lineValues = {};
    const matrixValues = {};
    const rowsByBlock = {};
    const plakRows = {};
    const key = `${catKey}::${blockIdx}`;
    if (item.detail) {
      Object.assign(lineValues, item.detail.lines || {});
      if (item.detail.matrix) Object.assign(matrixValues, item.detail.matrix);
      if (item.detail.rows) rowsByBlock[key] = item.detail.rows;
    }
    plakRows[key] = [{ id: item.id, jenisPlak: item.jenisPlak, unitPrice: item.unitPrice }];

    const result = computeBlocks(catKey, blockIdx, lineValues, matrixValues, rowsByBlock, plakRows, [], noopUpdaters, plakCatalog, schoolLanguage);
    return {
      blockIdx, batch, jenisPlak: item.jenisPlak, items: [item],
      label: batch === 0 ? 'Original Order' : `Tambahan #${batch}`,
      blk: result.blocks[0],
      isMatrix: result.isMatrix,
    };
  }).sort((a, b) => (a.batch - b.batch) || (a.blockIdx - b.blockIdx));
}
