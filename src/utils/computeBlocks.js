import {
  CATEGORIES, flattenPlakCatalog, getCategorySubjects, getCategoryColumns, tahunRangeYears,
  getCustomMatrixRowIds, customMatrixLabelKey, matrixCellKey, CUSTOM_MATRIX_LABEL_SUFFIX,
  getCategoryLinePlaceholders, getCategoryPositionLine2Placeholder,
  getCategoryTahunPlaceholder, getCategoryNamaKelasPlaceholder,
} from '../data/catalog';
import { findPossibleTypo } from './typoCheck';

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
    // Separate from requiredLineIndices — the ★ marker on Main
    // Template/Mata Pelajaran-Klas's YEAR line is purely visual ("this
    // wording matters, check it"), NOT a submission gate: the line's own
    // placeholder text explicitly tells the teacher to leave it blank
    // when the year is already part of line 1, so it must never block
    // Add to Cart the way an actually-required line does.
    const starredLineIndices = currentCat.starredLineIndices || requiredLineIndices;
    // Resolved per school (SK/SJKC) — plain pass-through for every category
    // except OTHERS, whose labels are generic placeholders with real
    // translations (see catalog.js's *ByLanguage fields / getCategory*
    // resolvers).
    let catLinePlaceholders = getCategoryLinePlaceholders(currentCat, schoolLanguage);
    // Main Template's "+ Add Reference Row" (extendableReferenceSample) —
    // the extra count rides along inside lineValues itself (a synthetic
    // `::extraRefLines` key per block, written by draftUpdaters.js's
    // onAddReferenceLine) rather than a new state field/computeBlocks
    // param, so it gets snapshotted/reconstructed/reset for free by every
    // mechanism that already treats lineValues as the source of truth
    // (snapshotDetail above, resetCategoryFields, buildDraftFromOrder) —
    // no call site of computeBlocks needs to change. Extra lines get a
    // blank placeholder (no fixed meaning) and flow through the exact same
    // rawLines/flatLines/numbering/drag-reorder/required-index logic below
    // as any catalog-defined line.
    const catPositionLine2Placeholder = getCategoryPositionLine2Placeholder(currentCat, schoolLanguage);
    // Captured outside the `if` below so the Kuantiti column-building
    // further down (extraRefColumns) can reuse the same base-length/count
    // without recomputing getCategoryLinePlaceholders a second time. Must
    // include the second-box line (e.g. Main Template's ACARA -> SUBJEK/
    // POSITION) in the count, matching draftUpdaters.js's onAddReferenceLine/
    // onRemoveReferenceLine — otherwise a category with a second box would
    // number its first extra row one too low (colliding with the second
    // box's own "Row N").
    const origLineLen = catLinePlaceholders.length;
    const baseLineLen = origLineLen + (catPositionLine2Placeholder ? 1 : 0);
    const extraRefCount = currentCat.extendableReferenceSample
      ? Number(lineValues[`${catKey}::${b}::extraRefLines`]) || 0
      : 0;
    if (extraRefCount > 0) {
      catLinePlaceholders = [...catLinePlaceholders, ...Array.from({ length: extraRefCount }, () => '( Additional Line )')];
    }
    // Mata Pelajaran/Klas only (catalog.js's deletableReferenceLines) — a
    // teacher can hide any single row (base or extra) via its own ✕, except
    // TAJUK BESAR (slotId '0') and the SUBJEK/POSITION second box (slotId
    // '2b'), which draftUpdaters.js's onDeleteReferenceLine refuses to add
    // to this set in the first place. Filtered out of `lines`/
    // `extraRefColumns` below — a hidden line is simply absent from
    // `blk.lines`, so it drops out of required-line validation for free.
    const hiddenLineSlots = currentCat.deletableReferenceLines
      ? new Set((lineValues[`${catKey}::${b}::hiddenLines`] || '').split(',').filter(Boolean))
      : null;
    // Line 3's optional second box gets its own slotId ('2b') alongside
    // every other line's own index — flattened below (secondLine, if any,
    // right after its own first box) and numbered sequentially, so plain
    // categories (no second box) end up numbered 1..N exactly as before.
    const refOrderKey = `${catKey}::${b}::refOrder`;
    const rawLines = catLinePlaceholders.map((placeholder, i) => {
      const key = `${catKey}::${b}::${i}`;
      const slotId = `${i}`;
      const line = {
        key, slotId, placeholder, value: lineValues[key] || '',
        required: requiredLineIndices.includes(i),
        starred: starredLineIndices.includes(i),
        // Line 3's own text renders red on some categories (OTHERS — see
        // catalog.js's positionFieldsRedText) since it's the position text
        // that actually gets engraved; every other line stays plain.
        redText: i === 2 && !!currentCat.positionFieldsRedText,
        onChange: (val) => updaters.onLine(key, val),
        // Flags a likely typo (e.g. "ANIGERAH" for "ANUGERAH") against a
        // small curated word list — see src/utils/typoCheck.js. Purely a
        // hint shown near the input; never blocks Add to Cart.
        typoHint: findPossibleTypo(lineValues[key]),
        // TAJUK BESAR (i === 0) can never be deleted even on a
        // deletableReferenceLines category — every other row (including any
        // teacher-added extra) gets its own ✕.
        deletable: !!currentCat.deletableReferenceLines && i !== 0,
        onDelete: () => updaters.onDeleteReferenceLine(catKey, b, slotId),
      };
      if (i === 2 && catPositionLine2Placeholder) {
        const key2 = `${catKey}::${b}::2b`;
        line.secondLine = {
          key: key2, slotId: '2b', placeholder: catPositionLine2Placeholder, value: lineValues[key2] || '',
          redText: !!currentCat.positionFieldsRedText,
          onChange: (val) => updaters.onLine(key2, val),
          typoHint: findPossibleTypo(lineValues[key2]),
        };
      }
      return line;
    });
    let flatLines = rawLines.flatMap((ln) => (ln.secondLine ? [ln, ln.secondLine] : [ln]));
    // Each line's displayed number is assigned from its ORIGINAL
    // (catalog-defined) order, BEFORE any drag-reorder below — a dragged
    // row keeps its own number wherever it's moved to, rather than
    // renumbering by new position. Two things depend on a row's number
    // staying stable: Main Template's Kuantiti column labels
    // (extraRefColumns further down — "Row 4"/"Row 5" is computed from a
    // line's original position, not its current on-screen order), and
    // simply not confusing the teacher by having a box they know as
    // "Row 4" suddenly relabel itself "Row 2" just because they dragged
    // it earlier in the list.
    flatLines = flatLines.map((ln, i) => ({ ...ln, num: i + 1 }));
    // Draggable categories (Main Template, OTHERS): the teacher can freely
    // reorder these rows on screen — purely a display-ORDER convenience so
    // Production knows which row to expect where on the reference-sample
    // artwork, not a change to what each field means, where its value is
    // stored, or its own number (see catalog.js's draggableReferenceSample).
    // The chosen order is kept as a plain lineValues entry (a comma-joined
    // slotId list under refOrderKey) so it rides along with every existing
    // lineValues mechanism — snapshot, reset, cart-to-order reconstruction
    // — for free, with no new state field or call-site plumbing needed.
    // Unrecognized/missing slotIds just fall back to the natural order.
    if (currentCat.draggableReferenceSample) {
      const storedOrder = (lineValues[refOrderKey] || '').split(',').filter(Boolean);
      if (storedOrder.length) {
        const bySlot = new Map(flatLines.map((ln) => [ln.slotId, ln]));
        const ordered = storedOrder.map((id) => bySlot.get(id)).filter(Boolean);
        const seen = new Set(ordered.map((ln) => ln.slotId));
        flatLines = [...ordered, ...flatLines.filter((ln) => !seen.has(ln.slotId))];
      }
    }
    // Hidden rows are dropped only after numbering/reordering above so a
    // deleted row's siblings keep their own original numbers rather than
    // closing the gap (matches the drag-reorder comment above: a row's
    // number is a stable identity, not a sequential display index).
    const lines = hiddenLineSlots && hiddenLineSlots.size
      ? flatLines.filter((ln) => !hiddenLineSlots.has(ln.slotId))
      : flatLines;

    let matrixRows = [], columns = [], colTotals = [], grandTotal = 0, rows = [], blockTotalQty = 0;
    let namaKelasRows = [], namaKelasCount = 0, tahunField = null, extraRefColumns = [];

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
          // Secondary-school (SMK) rows only — see excelImport.js's
          // splitTingkatanCode/AppState.jsx's classColumns. `tingkatanMode`
          // swaps OrderCategoryBlock.jsx's Tahun Dari/Hingga dropdown pair
          // for a single free-text box (there's no Tingkatan-equivalent
          // dropdown), imported per-row rather than a whole-category
          // setting, since one salesman's KLAS_MATRIX category can hold
          // both a primary and a secondary school's own sections.
          tingkatan: cls.tingkatan || '', tingkatanMode: !!cls.tingkatanMode,
          setTingkatan: (v) => updaters.onColumnField(colsKey, cls.id, 'tingkatan', v),
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
      // Main Template only (extendableReferenceSample): each Reference
      // Sample row added past the base 3 (via "+ Add Reference Row") gets
      // its own Kuantiti column too — `refCol{N}` on the row, N being the
      // 1-based Reference Sample row number it corresponds to (matches the
      // "Row N" header shown on both sections). Stored directly on the
      // Kuantiti row object (rowsByBlockMap) via the existing onRowField
      // updater — no new updater needed, same mechanism `desc`/`qty` use.
      extraRefColumns = currentCat.extendableReferenceSample
        ? Array.from({ length: extraRefCount }, (_, i) => {
          const num = baseLineLen + i + 1;
          const slotId = `${origLineLen + i}`;
          return { key: `refCol${num}`, label: `Row ${num}`, slotId };
        // A hidden extra row (deletableReferenceLines — Mata Pelajaran/Klas)
        // drops its matching Kuantiti column too, same as any hidden base row.
        }).filter((col) => !(hiddenLineSlots && hiddenLineSlots.has(col.slotId)))
        : [];
      rows = rawRows.map((row) => ({
        id: row.id, desc: row.desc, qty: row.qty,
        qtyMismatch: namaKelasCount > 0 && Number(row.qty) > 0 && Number(row.qty) !== namaKelasCount,
        // See Reference Sample's own typoHint above — same word-list hint,
        // just for the Description field (subject names in particular).
        typoHint: findPossibleTypo(row.desc),
        setDesc: (v) => updaters.onRowField(rowsKey, row.id, 'desc', v),
        setQty: (v) => updaters.onRowField(rowsKey, row.id, 'qty', v),
        remove: () => updaters.onRowRemove(rowsKey, row.id),
        extraRefValues: extraRefColumns.map((col) => ({
          key: col.key, value: row[col.key] || '',
          onChange: (v) => updaters.onRowField(rowsKey, row.id, col.key, v),
        })),
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
      qtyLabel: currentCat.hideQtyLabelSuffix ? '' : currentCat.label,
      qtyColHeader: isMatrix ? 'QTY' : (currentCat.qtyColumnLabels ? currentCat.qtyColumnLabels[b] : 'QTY'),
      sampleSlotId: `sample-${catKey}-${b}`,
      lines, isMatrix, isDynamicMatrix,
      // Main Template's "+ Add Reference Row" (see the extraRefLines note
      // above) and the matching cap on Kuantiti's own "+ Add Row" — capped
      // at `cat.maxReferenceLines` (falls back to 5) total VISIBLE lines.
      addReferenceLine: currentCat.extendableReferenceSample ? () => updaters.onAddReferenceLine(catKey, b) : null,
      canAddReferenceLine: !!currentCat.extendableReferenceSample && lines.length < (currentCat.maxReferenceLines || 5),
      // "Delete Reference Row" — removes the LAST added Reference Sample
      // row and its matching Kuantiti column together (draftUpdaters.js's
      // onRemoveReferenceLine); only ever offered once at least one has
      // actually been added (extraRefCount > 0) — the base lines are never
      // removable this way. Superseded by each line's own `deletable`/
      // `onDelete` on a deletableReferenceLines category (Mata Pelajaran/
      // Klas) — OrderCategoryBlock only renders this button when that flag
      // is off (TOKOH).
      removeReferenceLine: currentCat.extendableReferenceSample ? () => updaters.onRemoveReferenceLine(catKey, b) : null,
      canRemoveReferenceLine: extraRefCount > 0,
      deletableReferenceLines: !!currentCat.deletableReferenceLines,
      plakPerBlock: !!currentCat.plakPerBlock,
      descColumnLabel: currentCat.descColumnLabel,
      extraRefColumns,
      canAddRow: !currentCat.capRowsAt5 || rows.length < 5,
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
      // `multiBlock` (KLAS_MATRIX) opts in the same way `hasNamaKelasList`
      // (OTHERS) already does — the two categories just differ in whether
      // Reference Sample/Jenis Plak are shared across sections or
      // independent per section (see showSharedSections below).
      duplicateBlock: (currentCat.hasNamaKelasList || currentCat.multiBlock) && b < blocksCount - 1 ? () => updaters.onDuplicateBlock(catKey, b) : null,
      // "Delete section" — only ever offered for a duplicated block (never
      // block 0, the original section); same isLastBlock gating the caller
      // (NewOrderStep2/AddOn) already applies to duplicateBlock above
      // decides whether this is actually the one to show it on.
      removeBlock: (currentCat.hasNamaKelasList || currentCat.multiBlock) && b > 0 ? () => updaters.onRemoveBlock(catKey, b) : null,
      // Draggable Reference Sample (OTHERS — see catalog.js): pass the full
      // new slotId order after a drag; OrderCategoryBlock derives it from
      // `lines` current order plus the moved item's new position.
      reorderReferenceSample: currentCat.draggableReferenceSample
        ? (newSlotIdOrder) => updaters.onLine(refOrderKey, newSlotIdOrder.join(','))
        : null,
      blockTotalQty, plakRows,
    });
  }

  return { blocks, isMatrix, isDynamicMatrix, blocksCount };
}

export const noopUpdaters = {
  onLine: () => {}, onMatrix: () => {}, onRowField: () => {}, onRowRemove: () => {},
  onAddRow: () => {}, onAddRowSameQty: () => {}, onPlakSelect: () => {},
  onColumnField: () => {}, onColumnRemove: () => {}, onAddColumn: () => {}, onAddColumnSameTahun: () => {},
  onAddNamaKelas: () => {}, onDuplicateBlock: () => {}, onRemoveBlock: () => {},
  onAddMatrixRow: () => {}, onMatrixRowRemove: () => {},
  onAddReferenceLine: () => {}, onRemoveReferenceLine: () => {}, onDeleteReferenceLine: () => {},
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
// Merges one order item's `detail` snapshot into the accumulating
// lineValues/matrixValues/rowsByBlock/columnsByBlock maps for its own
// block key — shared by reconstructBlocksForCategory (read-only review)
// and buildDraftFromOrder (the "Reorder" button's draft rebuild, see
// AppState.jsx), so the two never drift apart on how multiple items
// sharing one block get combined. See reconstructBlocksForCategory's own
// comment below for why upsert-by-id vs sum-by-desc is chosen per detail
// shape.
function mergeItemDetailIntoMaps(it, key, lineValues, matrixValues, rowsByBlock, columnsByBlock) {
  if (!it.detail) return;
  Object.assign(lineValues, it.detail.lines || {});
  if (it.detail.matrix) {
    Object.keys(it.detail.matrix).forEach((k) => {
      // A custom matrix row's own `__label__` key holds the teacher-typed
      // subject text, not a quantity — numeric-summing it (like every real
      // cell key below) silently corrupted it to 0 the moment two rounds
      // shared a block, or even on a single round once read back. Same
      // text every round writes it as, so the latest copy simply wins.
      if (k.endsWith(CUSTOM_MATRIX_LABEL_SUFFIX)) {
        matrixValues[k] = it.detail.matrix[k];
      } else {
        matrixValues[k] = (Number(matrixValues[k]) || 0) + (Number(it.detail.matrix[k]) || 0);
      }
    });
  }
  if (it.detail.rows) {
    if (!rowsByBlock[key]) {
      rowsByBlock[key] = it.detail.rows.map((r) => ({ ...r }));
    } else if (it.detail.matrix) {
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
    // dynamicMatrix (detail.matrix present): subjects have no qty of their
    // own (it lives in detail.matrix, summed inside the shared helper) —
    // upserted by id so a later round's edited desc/custom flag wins
    // without duplicating or dropping subjects only present in one round.
    // Every other list-mode category (including OTHERS' hasNamaKelasList,
    // which also carries detail.columns but no detail.matrix) sums rows by
    // desc instead — see mergeItemDetailIntoMaps above.
    blockItems.forEach((it) => {
      mergeItemDetailIntoMaps(it, key, lineValues, matrixValues, rowsByBlock, columnsByBlock);
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

// Rebuilds a fresh New Order draft from an already-submitted order's
// `items` — backs the "Reorder" button (Dashboard.jsx/AppState.jsx's
// reorderOrder) for a teacher placing essentially the same order again
// (a new school year, a repeat function) with a few edits. The order's
// own `snapshot` field looked like it would do this, but it's captured
// from the live draft at Submit time — and addToCart always resets that
// category's fields back to blank the moment it's added (see
// AppState.jsx's resetCategoryFields), so by Submit the snapshot is
// whatever was left over, not what was actually ordered. Reading straight
// from `items` (the same reliable source reconstructBlocksForCategory
// already uses for read-only review) restores every category actually in
// the order, not just whichever tab happened to be open.
//
// Every category in the order gets its own lineValues/rowsByBlock/etc
// merged in (same per-block merge as reconstructBlocksForCategory, via
// mergeItemDetailIntoMaps), plus visibleBlocksByCategory so a
// hasNamaKelasList category's duplicated blocks (OTHERS' extra Tahun
// parts) come back revealed instead of collapsed to just the first one.
// next*Id counters are pushed past every restored row/column id so a
// freshly-added row in the new draft can never collide with a restored
// one's id.
export function buildDraftFromOrder(order) {
  const categories = CATEGORIES.filter((cat) => (order.items || []).some((it) => it.categoryKey === cat.key));
  const lineValues = {};
  const matrixValues = {};
  const rowsByBlock = {};
  const columnsByBlock = {};
  const plakRows = {};
  const visibleBlocksByCategory = {};
  let maxId = 999;

  const trackMaxId = (list) => {
    (list || []).forEach((item) => {
      const n = Number(item.id);
      if (Number.isFinite(n)) maxId = Math.max(maxId, n);
    });
  };

  categories.forEach((cat) => {
    const items = (order.items || []).filter((it) => it.categoryKey === cat.key);
    const blockIdxs = [...new Set(items.map((it) => it.blockIdx ?? 0))];
    let maxBlockIdx = 0;
    blockIdxs.forEach((blockIdx) => {
      maxBlockIdx = Math.max(maxBlockIdx, blockIdx);
      const key = `${cat.key}::${blockIdx}`;
      const blockItems = items.filter((it) => (it.blockIdx ?? 0) === blockIdx);
      blockItems.forEach((it) => {
        mergeItemDetailIntoMaps(it, key, lineValues, matrixValues, rowsByBlock, columnsByBlock);
      });
      plakRows[key] = blockItems.map((it) => ({ id: it.id, jenisPlak: it.jenisPlak }));
      trackMaxId(rowsByBlock[key]);
      trackMaxId(columnsByBlock[key]);
    });
    visibleBlocksByCategory[cat.key] = Math.min(cat.blocksCount || 1, maxBlockIdx + 1);
    // A matrix category's teacher-added rows (MP THP's "+ Add Row") live
    // as a synthetic `custom-<id>` id embedded in matrixValues' own keys,
    // not in rowsByBlock/columnsByBlock — trackMaxId alone would miss
    // them, letting a freshly-added row reuse (and silently merge into)
    // a restored custom row's id.
    getCustomMatrixRowIds(cat.key, matrixValues).forEach((rowId) => {
      const n = Number(rowId);
      if (Number.isFinite(n)) maxId = Math.max(maxId, n);
    });
  });

  return {
    category: categories[0]?.key || null,
    lineValues, matrixValues, rowsByBlock, columnsByBlock, plakRows, visibleBlocksByCategory,
    nextId: maxId + 1,
  };
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
