import {
  CATEGORIES, flattenPlakCatalog, getCategorySubjects, getCategoryColumns, tahunRangeYears,
  getCustomMatrixRowIds, customMatrixLabelKey, matrixCellKey,
  getCategoryLinePlaceholders, getCategoryPositionLine2Placeholder,
  getCategoryTahunPlaceholder, getCategoryNamaKelasPlaceholder,
} from '../data/catalog';

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
    // list-mode categories with a Nama Kelas list (OTHERS' hasNamaKelasList)
    // also need their columnsByBlock snapshotted — same storage slot
    // dynamicMatrix uses for Tahun+Nama Kelas, just holding {id, name}
    // objects here instead. Left null (as before) for TOKOH/LONJAKAN, which
    // never write anything into columnsByBlock under their own key.
    const colsForBlock = columnsByBlockMap && columnsByBlockMap[`${catKey}::${blockIdx}`];
    if (colsForBlock) detail.columns = JSON.parse(JSON.stringify(colsForBlock));
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
    // Every category requires line 1 (the event name); a category can mark
    // additional lines required too via `requiredLineIndices` (0-based —
    // OTHERS requires line 3's first box, see catalog.js) instead of
    // defaulting every field to optional. Read by OrderCategoryBlock (the
    // ★ marker) and AppState.jsx's addToCart validation.
    const requiredLineIndices = currentCat.requiredLineIndices || [0];
    // Resolved per school (SK/SJKC) — plain pass-through for every category
    // except OTHERS, whose labels are generic placeholders with real
    // translations (see catalog.js's *ByLanguage fields / getCategory*
    // resolvers).
    const catLinePlaceholders = getCategoryLinePlaceholders(currentCat, schoolLanguage);
    const catPositionLine2Placeholder = getCategoryPositionLine2Placeholder(currentCat, schoolLanguage);
    // Line 3's optional second box gets its own slotId ('2b') alongside
    // every other line's own index — flattened below (secondLine, if any,
    // right after its own first box) and numbered sequentially, so plain
    // categories (no second box) end up numbered 1..N exactly as before.
    const refOrderKey = `${catKey}::${b}::refOrder`;
    const rawLines = catLinePlaceholders.map((placeholder, i) => {
      const key = `${catKey}::${b}::${i}`;
      const line = {
        key, slotId: `${i}`, placeholder, value: lineValues[key] || '',
        required: requiredLineIndices.includes(i),
        // Line 3's own text renders red on some categories (OTHERS — see
        // catalog.js's positionFieldsRedText) since it's the position text
        // that actually gets engraved; every other line stays plain.
        redText: i === 2 && !!currentCat.positionFieldsRedText,
        onChange: (val) => updaters.onLine(key, val),
      };
      if (i === 2 && catPositionLine2Placeholder) {
        const key2 = `${catKey}::${b}::2b`;
        line.secondLine = {
          key: key2, slotId: '2b', placeholder: catPositionLine2Placeholder, value: lineValues[key2] || '',
          redText: !!currentCat.positionFieldsRedText,
          onChange: (val) => updaters.onLine(key2, val),
        };
      }
      return line;
    });
    let flatLines = rawLines.flatMap((ln) => (ln.secondLine ? [ln, ln.secondLine] : [ln]));
    // Draggable categories (OTHERS): the teacher can freely reorder these
    // rows on screen — purely a display/numbering convenience so Production
    // knows which row to expect where on the reference-sample artwork, not
    // a change to what each field means or where its value is stored (see
    // catalog.js's draggableReferenceSample). The chosen order is kept as a
    // plain lineValues entry (a comma-joined slotId list under refOrderKey)
    // so it rides along with every existing lineValues mechanism —
    // snapshot, reset, cart-to-order reconstruction — for free, with no new
    // state field or call-site plumbing needed. Unrecognized/missing
    // slotIds just fall back to the natural order.
    if (currentCat.draggableReferenceSample) {
      const storedOrder = (lineValues[refOrderKey] || '').split(',').filter(Boolean);
      if (storedOrder.length) {
        const bySlot = new Map(flatLines.map((ln) => [ln.slotId, ln]));
        const ordered = storedOrder.map((id) => bySlot.get(id)).filter(Boolean);
        const seen = new Set(ordered.map((ln) => ln.slotId));
        flatLines = [...ordered, ...flatLines.filter((ln) => !seen.has(ln.slotId))];
      }
    }
    const lines = flatLines.map((ln, i) => ({ ...ln, num: i + 1 }));

    let matrixRows = [], columns = [], colTotals = [], grandTotal = 0, rows = [], blockTotalQty = 0;
    let namaKelasRows = [], namaKelasCount = 0, tahunField = null;

    if (isMatrix) {
      // Columns are the fixed catalog list (MP THP 1/2's class levels) —
      // OTHERS used to add teacher-defined columns here too but has since
      // moved to `list` mode (see the final branch below), so every isMatrix
      // category left has fixed columns only.
      columns = getCategoryColumns(currentCat, schoolLanguage).map((col) => ({ colKey: col, label: col, custom: false, minQty: 1 }));
      colTotals = columns.map(() => 0);

      const buildMatrixRow = (rowKey, subject, custom, rowId) => {
        let rowTotal = 0;
        const cells = columns.map((col, ci) => {
          const key = matrixCellKey(catKey, rowKey, col.colKey);
          const val = Number(matrixValues[key]) || 0;
          rowTotal += val; colTotals[ci] += val;
          return {
            key, col: col.label, value: matrixValues[key] || '', minQty: col.minQty,
            onChange: (v) => updaters.onMatrix(key, v),
          };
        });
        return { id: rowId, subject, cells, rowTotal, custom };
      };

      matrixRows = getCategorySubjects(currentCat, schoolLanguage).map((subj) => buildMatrixRow(subj, subj, false));

      // Teacher-added rows for a subject/award not on the fixed list above
      // (see OrderCategoryBlock's matrix "+ Add Row") — same cell shape, just
      // sourced from getCustomMatrixRowIds instead of the catalog list, and
      // with an editable subject label instead of a fixed one.
      matrixRows.push(...getCustomMatrixRowIds(catKey, matrixValues).map((rowId) => {
        const labelKey = customMatrixLabelKey(catKey, rowId);
        const row = buildMatrixRow(`custom-${rowId}`, matrixValues[labelKey] || '', true, rowId);
        row.setSubject = (v) => updaters.onMatrix(labelKey, v);
        row.remove = () => updaters.onMatrixRowRemove(catKey, rowId);
        return row;
      }));

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
      // `hasNamaKelasList` categories (OTHERS) keep a second, qty-less list
      // of class names alongside the Description/QTY rows — reusing
      // dynamicMatrix's columnsByBlock storage slot, just with a simpler
      // {id, name} shape — plus one TAHUN value for the whole block
      // (`hasTahunField`, stored as a synthetic `${catKey}::${b}::tahun`
      // line key so snapshotDetail's generic line-copying picks it up for
      // free). Each Description row's QTY is meant to equal how many Nama
      // Kelas are filled in (one plaque per class) — `qtyMismatch` flags a
      // row whose QTY disagrees, for OrderCategoryBlock's red-bold warning
      // and AppState.jsx's addToCart guard.
      if (currentCat.hasNamaKelasList) {
        const rawNamaKelas = (columnsByBlockMap && columnsByBlockMap[rowsKey]) || [];
        namaKelasCount = rawNamaKelas.filter((nk) => (nk.name || '').trim()).length;
        namaKelasRows = rawNamaKelas.map((nk) => ({
          id: nk.id, name: nk.name,
          setName: (v) => updaters.onColumnField(rowsKey, nk.id, 'name', v),
          remove: () => updaters.onColumnRemove(rowsKey, nk.id),
        }));
      }
      if (currentCat.hasTahunField) {
        const tahunKey = `${catKey}::${b}::tahun`;
        tahunField = { value: lineValues[tahunKey] || '', onChange: (v) => updaters.onLine(tahunKey, v) };
      }
      rows = rawRows.map((row) => ({
        id: row.id, desc: row.desc, qty: row.qty,
        qtyMismatch: namaKelasCount > 0 && Number(row.qty) > 0 && Number(row.qty) !== namaKelasCount,
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
      // Add On) never set pr.unitPrice since no price exists yet there, so
      // they keep falling back to the catalog lookup as before.
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
      qtyColHeader: isMatrix ? 'QTY' : (currentCat.qtyColumnLabels ? currentCat.qtyColumnLabels[b] : 'QTY'),
      sampleSlotId: `sample-${catKey}-${b}`,
      lines, isMatrix, isDynamicMatrix,
      columns, matrixRows,
      colTotals: colTotals.map((v) => ({ value: v })), grandTotal,
      rows,
      hasNamaKelasList: !!currentCat.hasNamaKelasList,
      namaKelasRows, namaKelasCount, tahun: tahunField,
      namaKelasPlaceholder: getCategoryNamaKelasPlaceholder(currentCat, schoolLanguage),
      tahunPlaceholder: getCategoryTahunPlaceholder(currentCat, schoolLanguage),
      addRow: () => updaters.onAddRow(`${catKey}::${b}`),
      addRowSameQty: () => updaters.onAddRowSameQty(`${catKey}::${b}`),
      addColumn: () => updaters.onAddColumn(`${catKey}::${b}`),
      addColumnSameTahun: () => updaters.onAddColumnSameTahun(`${catKey}::${b}`),
      addNamaKelas: () => updaters.onAddNamaKelas(`${catKey}::${b}`),
      addMatrixRow: () => updaters.onAddMatrixRow(catKey),
      // Only the last currently-computed block can offer "Duplicate" (there's
      // nowhere further to duplicate into once every pre-allocated slot,
      // e.g. TAHUN 1-6 for OTHERS, is used) — see draftUpdaters.js's
      // onDuplicateBlock and NewOrderStep2/AddOn's visible-block slicing,
      // which is what actually reveals block b+1 once this copies into it.
      duplicateBlock: currentCat.hasNamaKelasList && b < blocksCount - 1 ? () => updaters.onDuplicateBlock(catKey, b) : null,
      // Draggable Reference Sample (OTHERS — see catalog.js): pass the full
      // new slotId order after a drag; OrderCategoryBlock derives it from
      // `lines` current order plus the moved item's new position.
      reorderReferenceSample: currentCat.draggableReferenceSample
        ? (newSlotIdOrder) => updaters.onLine(refOrderKey, newSlotIdOrder.join(','))
        : null,
      blockTotalQty, plakRows,
    });
  }

  // hasNamaKelasList categories (OTHERS) can have several duplicated Tahun
  // blocks that all share ONE Jenis Plak choice (see draftUpdaters.js's
  // onDuplicateBlock) — but only block 0's Jenis Plak/QTY/Harga table is
  // ever shown (showSharedSections in OrderCategoryBlock.jsx), so without
  // this its displayed QTY/Harga would look like just block 0's own Tahun
  // part, hiding however many more plaques the other duplicated blocks add.
  // Each block still becomes its OWN cart item with its own qty when added
  // (needed so every Tahun's own Description/Nama Kelas rows export
  // separately, see AppState.jsx's addToCart) — this combined figure is
  // display-only, attached to every block's own first plakRow so whichever
  // block is actually rendered shows the true grand total instead.
  if (currentCat.hasNamaKelasList) {
    const combinedQty = blocks.reduce((sum, blk) => sum + blk.blockTotalQty, 0);
    const pricedRows = blocks.flatMap((blk) => blk.plakRows).filter((pr) => pr.unitPrice != null);
    const combinedHargaLabel = pricedRows.length
      ? `RM ${pricedRows.reduce((sum, pr) => sum + pr.rawHarga, 0).toFixed(2)}`
      : '—';
    blocks.forEach((blk) => {
      blk.plakRows = blk.plakRows.map((pr, i) => (i === 0 ? { ...pr, combinedQty, combinedHargaLabel } : pr));
    });
  }

  return { blocks, isMatrix, isDynamicMatrix, blocksCount };
}

export const noopUpdaters = {
  onLine: () => {}, onMatrix: () => {}, onRowField: () => {}, onRowRemove: () => {},
  onAddRow: () => {}, onAddRowSameQty: () => {}, onPlakSelect: () => {},
  onColumnField: () => {}, onColumnRemove: () => {}, onAddColumn: () => {}, onAddColumnSameTahun: () => {},
  onAddNamaKelas: () => {}, onDuplicateBlock: () => {},
  onAddMatrixRow: () => {}, onMatrixRowRemove: () => {},
};

// Rebuilds read-only `blocks` (the same shape NewOrderStep2 renders live)
// for one category of an already-submitted order, straight from each
// item's stored `detail` snapshot — lets Sales/Production reuse
// OrderCategoryBlock to show exactly what the teacher filled in, instead
// of re-deriving a simplified summary. Groups items by blockIdx so a
// category with more than one block renders every block, not just one
// (every current category is single-block, but this stays generic).
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
// exported CSV) whenever a block spanned more than one round. dynamicMatrix
// (PBD/ALIRAN) categories have the same class of risk across their three
// detail pieces (rows = subjects, columns = classes, matrix = per-cell
// qty), so rows/columns are upserted by id (a later round's edit to a
// subject/class's own fields wins, but nothing already accumulated is
// dropped) and matrix values are summed by key rather than overwritten —
// this also covers the (fairly narrow) case where two rounds coincidentally
// reuse the same generated ids, since both New Order and Add On seed the
// same 13 default PBD subjects with the same deterministic ids.
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
        if (it.detail.matrix) {
          Object.keys(it.detail.matrix).forEach((k) => {
            matrixValues[k] = (Number(matrixValues[k]) || 0) + (Number(it.detail.matrix[k]) || 0);
          });
        }
        if (it.detail.rows) {
          if (!rowsByBlock[key]) {
            rowsByBlock[key] = it.detail.rows.map((r) => ({ ...r }));
          } else if (it.detail.matrix) {
            // dynamicMatrix (detail.matrix present): subjects have no qty of
            // their own (it lives in detail.matrix, summed above) — upsert
            // by id so a later round's edited desc/custom flag wins without
            // duplicating or dropping subjects only present in one round.
            // (Checked via detail.matrix rather than detail.columns — OTHERS'
            // hasNamaKelasList rows also carry a detail.columns [Nama Kelas]
            // but, like TOKOH/LONJAKAN, have no detail.matrix and need the
            // qty-summing branch below instead.)
            it.detail.rows.forEach((r) => {
              const existing = rowsByBlock[key].find((er) => er.id === r.id);
              if (existing) Object.assign(existing, r);
              else rowsByBlock[key].push({ ...r });
            });
          } else {
            it.detail.rows.forEach((r) => {
              const existing = rowsByBlock[key].find((er) => er.desc === r.desc);
              if (existing) existing.qty = (Number(existing.qty) || 0) + (Number(r.qty) || 0);
              else rowsByBlock[key].push({ ...r });
            });
          }
        }
        if (it.detail.columns) {
          if (!columnsByBlock[key]) {
            columnsByBlock[key] = it.detail.columns.map((c) => ({ ...c }));
          } else {
            it.detail.columns.forEach((c) => {
              const existing = columnsByBlock[key].find((ec) => ec.id === c.id);
              if (existing) Object.assign(existing, c);
              else columnsByBlock[key].push({ ...c });
            });
          }
        }
      }
      plakRows[key] = [...(plakRows[key] || []), { id: it.id, jenisPlak: it.jenisPlak, unitPrice: it.unitPrice }];
    });
    const result = computeBlocks(catKey, lineValues, matrixValues, rowsByBlock, plakRows, columnsByBlock, noopUpdaters, plakCatalog, schoolLanguage);
    isMatrix = result.isMatrix;
    // computeBlocks always computes every one of the category's
    // `blocksCount` slots (up to 6 for OTHERS — see catalog.js), not just
    // this iteration's own `blockIdx`, since the other slots' data (if any)
    // lives under a different order item entirely — take only the one that
    // actually matches, or every OTHERS review screen would show up to 6
    // blocks per real block, most of them blank.
    const matchedBlock = result.blocks.find((blk) => blk.idx === blockIdx);
    if (matchedBlock) allBlocks.push(matchedBlock);
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
    const columnsByBlock = {};
    const plakRows = {};
    const key = `${catKey}::${blockIdx}`;
    if (item.detail) {
      Object.assign(lineValues, item.detail.lines || {});
      if (item.detail.matrix) Object.assign(matrixValues, item.detail.matrix);
      if (item.detail.rows) rowsByBlock[key] = item.detail.rows;
      if (item.detail.columns) columnsByBlock[key] = item.detail.columns;
    }
    plakRows[key] = [{ id: item.id, jenisPlak: item.jenisPlak, unitPrice: item.unitPrice }];

    const result = computeBlocks(catKey, lineValues, matrixValues, rowsByBlock, plakRows, columnsByBlock, noopUpdaters, plakCatalog, schoolLanguage);
    return {
      blockIdx, batch, jenisPlak: item.jenisPlak, items: [item],
      label: batch === 0 ? 'Original Order' : `Tambahan #${batch}`,
      // computeBlocks computes every one of the category's `blocksCount`
      // slots (up to 6 for OTHERS), not just this item's own blockIdx — pick
      // the matching one out, same reasoning as reconstructBlocksForCategory
      // above (was a harmless `blocks[0]` when every category was
      // single-block; OTHERS no longer is).
      blk: result.blocks.find((blk) => blk.idx === blockIdx) || result.blocks[0],
      isMatrix: result.isMatrix,
    };
  }).sort((a, b) => (a.batch - b.batch) || (a.blockIdx - b.blockIdx));
}
