import { CATEGORIES, flattenPlakCatalog, getCategorySubjects, getCategoryColumns, tahunRangeYears } from '../data/catalog';

export function snapshotDetail(catKey, blockIdx, isMatrix, isDynamicMatrix, lineValues, matrixValues, rowsByBlockMap, columnsByBlockMap) {
  const detail = { lines: {}, matrix: null, rows: null, columns: null };
  const linePrefix = `${catKey}::${blockIdx}::`;
  Object.keys(lineValues).forEach((k) => { if (k.startsWith(linePrefix)) detail.lines[k] = lineValues[k]; });
  if (isMatrix) {
    detail.matrix = {};
    const matPrefix = `${catKey}::`;
    Object.keys(matrixValues).forEach((k) => { if (k.startsWith(matPrefix)) detail.matrix[k] = matrixValues[k]; });
  } else if (isDynamicMatrix) {
    // PBD TERBAIK / ALIRAN TERBAIK: rows (subjects, including any
    // teacher-added extras) and columns (Tahun + Nama Kelas) are both
    // per-order data, unlike MP THP's fixed rows/columns — so both get
    // snapshotted, plus the qty matrix keyed by this block
    // (`${catKey}::${blockIdx}::${rowId}::${colId}`).
    detail.rows = JSON.parse(JSON.stringify(rowsByBlockMap[`${catKey}::${blockIdx}`] || []));
    detail.columns = JSON.parse(JSON.stringify((columnsByBlockMap && columnsByBlockMap[`${catKey}::${blockIdx}`]) || []));
    detail.matrix = {};
    const matPrefix = `${catKey}::${blockIdx}::`;
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
// once here rather than per plak row. `columnsByBlockMap` only matters for
// dynamicMatrix categories (PBD) — pass {} for anything else.
export function computeBlocks(catKey, lineValues, matrixValues, rowsByBlockMap, plakRowsMap, columnsByBlockMap, updaters, plakCatalog, schoolLanguage = 'SK') {
  const flatPrices = flattenPlakCatalog(plakCatalog);
  const priceFor = (code) => {
    const entry = flatPrices.find((p) => p.code === code);
    return entry ? entry.price : null;
  };
  const currentCat = CATEGORIES.find((c) => c.key === catKey) || CATEGORIES[0];
  const isMatrix = currentCat.mode === 'matrix';
  const isDynamicMatrix = currentCat.mode === 'dynamicMatrix';
  const blocksCount = currentCat.blocksCount || 1;
  const activeIndices = Array.from({ length: blocksCount }, (_, i) => i);
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
        return { subject: subj, cells, rowTotal };
      });
      grandTotal = colTotals.reduce((a, b2) => a + b2, 0);
      blockTotalQty = grandTotal;
    } else if (isDynamicMatrix) {
      // PBD TERBAIK / ALIRAN TERBAIK: subjects (default 13 + any
      // teacher-added extras) and classes (Tahun + Nama Kelas) are both
      // per-order/teacher-defined, unlike MP THP's fixed rows/columns from
      // the catalog. Subjects render as COLUMN headers (across the top) and classes
      // (Tahun + Nama Kelas) render as ROWS (down the left) — the opposite
      // axis arrangement from MP THP's fixed matrix above. The underlying
      // storage keeps rowsByBlockMap = subjects / columnsByBlockMap =
      // classes either way (and the cell key stays `subjectId::classId`,
      // matching exportCsv.js's buildPbdMatrixRows) — only which one is the
      // UI row vs UI column is swapped here.
      const rowsKey = `${catKey}::${b}`;
      const colsKey = `${catKey}::${b}`;
      const subjectDefs = rowsByBlockMap[rowsKey] || [];
      const classDefs = (columnsByBlockMap && columnsByBlockMap[colsKey]) || [];
      colTotals = subjectDefs.map(() => 0);
      matrixRows = classDefs.map((cls) => {
        let rowTotal = 0;
        const cells = subjectDefs.map((subj, si) => {
          const key = `${catKey}::${b}::${subj.id}::${cls.id}`;
          const val = Number(matrixValues[key]) || 0;
          rowTotal += val; colTotals[si] += val;
          return { key, value: matrixValues[key] || '', onChange: (v) => updaters.onMatrix(key, v) };
        });
        // minQty: a Tahun range covering N years needs at least N medals per
        // subject (one per year) — surfaced so the UI can enforce/hint it,
        // and the actual per-year split happens on export (exportCsv.js).
        const minQty = Math.max(1, tahunRangeYears(cls.tahunFrom, cls.tahunTo).length);
        return {
          id: cls.id, tahunFrom: cls.tahunFrom, tahunTo: cls.tahunTo, namaKelas: cls.namaKelas, cells, rowTotal, minQty,
          setTahunFrom: (v) => updaters.onColumnField(colsKey, cls.id, 'tahunFrom', v),
          setTahunTo: (v) => updaters.onColumnField(colsKey, cls.id, 'tahunTo', v),
          setNamaKelas: (v) => updaters.onColumnField(colsKey, cls.id, 'namaKelas', v),
          remove: () => updaters.onColumnRemove(colsKey, cls.id),
        };
      });
      columns = subjectDefs.map((subj) => ({
        id: subj.id, subject: subj.desc, custom: !!subj.custom,
        setSubject: (v) => updaters.onRowField(rowsKey, subj.id, 'desc', v),
        remove: () => updaters.onRowRemove(rowsKey, subj.id),
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

    blocks.push({
      idx: b,
      qtyLabel: currentCat.label,
      qtyColHeader: currentCat.qtyColumnLabels ? currentCat.qtyColumnLabels[b] : 'QTY',
      sampleSlotId: `sample-${catKey}-${b}`,
      lines, isMatrix, isDynamicMatrix, columns, matrixRows,
      colTotals: colTotals.map((v) => ({ value: v })), grandTotal,
      rows,
      addRow: () => updaters.onAddRow(`${catKey}::${b}`),
      addColumn: () => updaters.onAddColumn(`${catKey}::${b}`),
      addColumnSameTahun: () => updaters.onAddColumnSameTahun(`${catKey}::${b}`),
      blockTotalQty, plakRows,
    });
  }

  return { blocks, isMatrix, isDynamicMatrix, blocksCount };
}

export const noopUpdaters = {
  onLine: () => {}, onMatrix: () => {}, onRowField: () => {}, onRowRemove: () => {},
  onAddRow: () => {}, onPlakSelect: () => {},
  onColumnField: () => {}, onColumnRemove: () => {}, onAddColumn: () => {}, onAddColumnSameTahun: () => {},
};

// Rebuilds read-only `blocks` (the same shape NewOrderStep2 renders live)
// for one category of an already-submitted order, straight from each
// item's stored `detail` snapshot — lets Sales/Production reuse
// OrderCategoryBlock to show exactly what the teacher filled in, instead
// of re-deriving a simplified summary. Groups items by blockIdx so a
// category with more than one block renders every block, not just one
// (every current category is single-block, but this stays generic).
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
    const columnsByBlock = {};
    const plakRows = {};
    const key = `${catKey}::${blockIdx}`;
    blockItems.forEach((it) => {
      if (it.detail) {
        Object.assign(lineValues, it.detail.lines || {});
        if (it.detail.matrix) Object.assign(matrixValues, it.detail.matrix);
        if (it.detail.rows) rowsByBlock[key] = it.detail.rows;
        if (it.detail.columns) columnsByBlock[key] = it.detail.columns;
      }
      plakRows[key] = [...(plakRows[key] || []), { id: it.id, jenisPlak: it.jenisPlak, unitPrice: it.unitPrice }];
    });
    const result = computeBlocks(catKey, lineValues, matrixValues, rowsByBlock, plakRows, columnsByBlock, noopUpdaters, plakCatalog, schoolLanguage);
    isMatrix = result.isMatrix;
    allBlocks.push(...result.blocks);
  });

  return { blocks: allBlocks, isMatrix };
}
