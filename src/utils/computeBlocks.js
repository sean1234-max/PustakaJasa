import {
  CATEGORIES, flattenPlakCatalog, getCategorySubjects, getCategoryColumns, tahunRangeYears,
  getCustomMatrixRowIds, customMatrixLabelKey, matrixCellKey, CUSTOM_MATRIX_LABEL_SUFFIX, TOKOH_ROW_FIELDS,
  getCategoryLinePlaceholders, getCategoryPositionLine2Placeholder,
  getCategoryTahunPlaceholder, getCategoryNamaKelasPlaceholder,
  resolveSelempangWarna, SELEMPANG_CODE, SELEMPANG_UNIT_PRICE, getStockStatus,
} from '../data/catalog';
import { findPossibleTypo } from './typoCheck';

export function snapshotDetail(catKey, blockIdx, isMatrix, isDynamicMatrix, lineValues, matrixValues, rowsByBlockMap, columnsByBlockMap) {
  const detail = { lines: {}, matrix: null, rows: null, columns: null };
  const linePrefix = `${catKey}::${blockIdx}::`;
  Object.keys(lineValues).forEach((k) => {
    if (!k.startsWith(linePrefix)) return;
    // An empty slot-0b (the teacher clicked "+ Tajuk besar 2 baris" but
    // typed nothing) must not travel into the submitted order — it would
    // render as a blank numbered line on every read-only review screen.
    if (k.endsWith('::0b') && !String(lineValues[k]).trim()) return;
    detail.lines[k] = lineValues[k];
  });
  if (isMatrix) {
    detail.matrix = {};
    const matPrefix = `${catKey}::`;
    Object.keys(matrixValues).forEach((k) => { if (k.startsWith(matPrefix)) detail.matrix[k] = matrixValues[k]; });
    // PPKI's own Nama Kelas + Moral Kelas breakdown (catalog.js's
    // hasLevelBreakdown) lives in rowsByBlockMap under composite keys
    // (`${catKey}::${blockIdx}::${level}::main`/`::moral`), not the single
    // `${catKey}::${blockIdx}` key every other mode uses — snapshot every
    // key under this block's own prefix so a submitted order's review
    // screens can still show the exact breakdown behind its KUANTITI totals.
    const breakdown = {};
    Object.keys(rowsByBlockMap).forEach((k) => { if (k.startsWith(linePrefix)) breakdown[k] = JSON.parse(JSON.stringify(rowsByBlockMap[k])); });
    if (Object.keys(breakdown).length) detail.namaKelasBreakdown = breakdown;
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
    // ALIRAN TERBAIK (Kalau ada kelas) — its per-Tahun Nama Kelas lists live
    // under composite keys like the matrix breakdown does; capture them too.
    const breakdown = {};
    Object.keys(rowsByBlockMap).forEach((k) => { if (k.startsWith(linePrefix) && k.endsWith('::main')) breakdown[k] = JSON.parse(JSON.stringify(rowsByBlockMap[k])); });
    if (Object.keys(breakdown).length) detail.namaKelasBreakdown = breakdown;
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
    // A slot an IMPORT skipped (e.g. no standalone YEAR line in the
    // source, or PPKI/MP THP's box never having one to begin with) is
    // hidden the same way regardless of category — not just on Mata
    // Pelajaran/Klas (catalog.js's deletableReferenceLines, which ALSO
    // gives every row its own ✕ to hide one by hand; unrelated to whether
    // an already-hidden slot from data stays hidden). Filtered out of
    // `lines`/`extraRefColumns` below — a hidden line is simply absent from
    // `blk.lines`, so it drops out of required-line validation for free.
    // SUBJEK/POSITION (slotId '2b') hidden this way is re-addable via its
    // own button on a deletableReferenceLines category — see
    // `addSubjekPosition` below.
    const hiddenLineSlots = new Set((lineValues[`${catKey}::${b}::hiddenLines`] || '').split(',').filter(Boolean));
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
          // Deletable now (a named-recipient roster import — see
          // excelImport.js's buildRosterSectionLines — never has a real
          // SUBJEK/POSITION value to begin with, and hides it outright),
          // unlike TAJUK BESAR which stays permanently required.
          deletable: !!currentCat.deletableReferenceLines,
          onDelete: () => updaters.onDeleteReferenceLine(catKey, b, '2b'),
        };
      }
      // TAJUK BESAR can carry a second engraved line (school on line 1,
      // event title on line 2) — an Alt+Enter line break in the source
      // cell (excelImport.js's splitTwoLineTajuk), an AI pre-write, or a
      // roster import splits it into its own single-line field; the teacher
      // can also add one by hand ("+ Tajuk besar 2 baris" — sets slot 0b to
      // an empty string, so the box shows even before anything is typed).
      // Rejoined into one event_header column on export (exportCsv.js).
      if (i === 0 && lineValues[`${catKey}::${b}::0b`] !== undefined) {
        const key0b = `${catKey}::${b}::0b`;
        line.secondLine = {
          key: key0b, slotId: '0b', placeholder: 'Baris kedua tajuk besar',
          value: lineValues[key0b] || '',
          // Same ★ as TAJUK BESAR itself — it's still locked event wording,
          // just carried on a second engraved line.
          starred: starredLineIndices.includes(0),
          onChange: (val) => updaters.onLine(key0b, val),
          typoHint: findPossibleTypo(lineValues[key0b]),
          deletable: true,
          onDelete: () => updaters.onDeleteReferenceLine(catKey, b, '0b'),
        };
      }
      return line;
    });
    let flatLines = rawLines.flatMap((ln) => (ln.secondLine ? [ln, ln.secondLine] : [ln]));
    // The YEAR row (slot 1) is retired — the year rides on a two-line TAJUK
    // BESAR now (slot 0 + 0b, an Alt+Enter break). The slot index stays in
    // the data model (parked, not renumbered — old orders' `::2`/`::3` keys
    // are untouched) and the CSV keeps its `year` column, but the row is
    // never shown to the teacher and exportCsv.js never reads it. Dropped
    // here before numbering so the visible list stays gapless (1, 2, 3…).
    if (/^YEAR\b/i.test(catLinePlaceholders[1] || '')) {
      flatLines = flatLines.filter((ln) => ln.slotId !== '1');
    }
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
    let lines = hiddenLineSlots && hiddenLineSlots.size
      ? flatLines.filter((ln) => !hiddenLineSlots.has(ln.slotId))
      : flatLines;
    // KLAS_MATRIX (dynamicMatrix) and the fixed-matrix categories (PPKI,
    // MP THP 1/2) are the exception: an import here auto-hides the
    // reference-sample slots its source file skipped — YEAR and/or
    // SUBJEK/POSITION (see AppState.jsx's deriveKlasMatrixSectionLines) —
    // so the teacher would otherwise see "1, 3, 5". Renumber what's left
    // 1..N for a gapless list. Safe only in these branches: unlike Main
    // Template / OTHERS, neither layout has a "Row N" Kuantiti column keyed
    // off a line's own number.
    if (isDynamicMatrix || isMatrix) lines = lines.map((ln, i) => ({ ...ln, num: i + 1 }));

    let matrixRows = [], columns = [], colTotals = [], grandTotal = 0, rows = [], blockTotalQty = 0, levelBreakdown = null;
    let aliranPlakQty = null;
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

      // `subjectsFromImport` categories (PPKI, MP THP 1/2 and variants):
      // once a file has been imported, EVERY subject row is an editable
      // `custom-<id>` row rebuilt from the sheet's own subject list (renamed
      // / added / blank rows and all) — the fixed catalog list is only the
      // pre-import default, so it's suppressed the moment imported rows exist.
      const importedRowIds = getCustomMatrixRowIds(catKey, matrixValues);
      const useImportedSubjects = !!currentCat.subjectsFromImport && importedRowIds.length > 0;
      matrixRows = useImportedSubjects
        ? []
        : getCategorySubjects(currentCat, schoolLanguage).map((subj) => buildMatrixRow(subj, subj, false));

      // Teacher-added rows for a subject/award not on the fixed list above
      // (see OrderCategoryBlock's matrix "+ Add Row") — same cell shape, just
      // sourced from getCustomMatrixRowIds instead of the catalog list, and
      // with an editable subject label instead of a fixed one.
      matrixRows.push(...importedRowIds.map((rowId) => {
        const labelKey = customMatrixLabelKey(catKey, rowId);
        const row = buildMatrixRow(`custom-${rowId}`, matrixValues[labelKey] || '', true, rowId);
        row.setSubject = (v) => updaters.onMatrix(labelKey, v);
        row.remove = () => updaters.onMatrixRowRemove(catKey, rowId);
        return row;
      }));

      grandTotal = colTotals.reduce((a, b2) => a + b2, 0);
      blockTotalQty = grandTotal;

      // Nama Kelas (+ optional Moral Kelas) breakdown, one entry per level
      // (catalog.js's hasLevelBreakdown) — only present once an import
      // actually found one to read (excelImport.js's parsePpkiSheet /
      // parsePbdSheet); a level filled in by hand (no breakdown at all)
      // simply has neither list, so nothing extra renders for it. Editing
      // any row here re-sums straight back into this SAME level's own
      // KUANTITI cell above — see draftUpdaters.js's onLevelKelasField
      // family. `levelBreakdownAxis: 'subject'` (PBD) — the levels are the
      // subject ROWS (TAHUN 1-6), not the single column;
      // `levelBreakdownNoMoral` (PBD) — Nama Kelas only.
      if (currentCat.hasLevelBreakdown) {
        const noMoral = !!currentCat.levelBreakdownNoMoral;
        const axisItems = currentCat.levelBreakdownAxis === 'subject'
          ? matrixRows.map((r) => r.subject)
          : columns.map((c) => c.colKey);
        levelBreakdown = axisItems.map((level) => {
          const mainKey = `${catKey}::${b}::${level}::main`;
          const moralKey = `${catKey}::${b}::${level}::moral`;
          const buildRows = (listKey) => (rowsByBlockMap[listKey] || []).map((r) => ({
            id: r.id, desc: r.desc || '', qty: r.qty || '',
            setDesc: (v) => updaters.onLevelKelasField(listKey, r.id, 'desc', v),
            setQty: (v) => updaters.onLevelKelasField(listKey, r.id, 'qty', v),
            remove: () => updaters.onRemoveLevelKelasRow(listKey, r.id),
          }));
          return {
            level,
            mainRows: buildRows(mainKey),
            moralRows: noMoral ? [] : buildRows(moralKey),
            addMain: () => updaters.onAddLevelKelasRow(mainKey),
            addMoral: noMoral ? undefined : () => updaters.onAddLevelKelasRow(moralKey),
          };
        }).filter((lb) => lb.mainRows.length > 0 || lb.moralRows.length > 0);
      }
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
          // A named-recipient roster import (excelImport.js's
          // scanSheetForRosters) tracks each person's own role/position as
          // its own field — distinct from Nama Kelas/Nama Murid, and from
          // Tingkatan above, which is a class code rather than a role.
          // Blank/absent for every other KLAS_MATRIX shape.
          jawatan: cls.jawatan || '',
          setJawatan: (v) => updaters.onColumnField(colsKey, cls.id, 'jawatan', v),
          // A recipient's own class, tracked separately only when the
          // source had a real "NAMA KELAS" column alongside its own
          // person-name column — see excelImport.js's groupRosterHeaders.
          kelasName: cls.kelasName || '',
          setKelasName: (v) => updaters.onColumnField(colsKey, cls.id, 'kelasName', v),
          // A fixed engraved line below the per-plaque line (CSV
          // event_line_2) — a "TAHAP 1" / "TAHAP 2" from a parallel-class-
          // list sheet (excelImport.js's readParallelClassLists); shown here
          // as a free box so the teacher can adjust it. Blank for every
          // other KLAS_MATRIX shape.
          eline2: cls.eline2 || '',
          setEline2: (v) => updaters.onColumnField(colsKey, cls.id, 'eline2', v),
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
      rows = rawRows.map((row) => {
        // LONJAKAN (catalog.js's plakPerRow) — each row picks its own Jenis
        // Plak and is priced on its own (one cart item per row); there's no
        // single block-level Jenis Plak table.
        let plakFields = {};
        if (currentCat.plakPerRow) {
          const rowUnitPrice = row.unitPrice != null ? row.unitPrice : priceFor(row.jenisPlak);
          const rowHarga = rowUnitPrice != null ? (Number(row.qty) || 0) * rowUnitPrice : 0;
          plakFields = {
            jenisPlak: row.jenisPlak || '',
            unitPrice: rowUnitPrice,
            rawHarga: rowHarga,
            hargaLabel: rowUnitPrice != null ? `RM ${rowHarga.toFixed(2)}` : '—',
            setJenisPlak: (v) => updaters.onRowField(rowsKey, row.id, 'jenisPlak', v),
          };
        }
        // TOKOH_SHEET (catalog.js's tokohRowFields) — NAMA MURID / GAMBAR /
        // DESIGN per-row metadata, editable, stored via the generic
        // onRowField updater like desc/qty.
        const tokohFields = currentCat.tokohRowFields
          ? TOKOH_ROW_FIELDS.map((f) => ({
            ...f, value: row[f.key] || '',
            onChange: (v) => updaters.onRowField(rowsKey, row.id, f.key, v),
          }))
          : null;
        // SELEMPANG (catalog.js's `selempang`) — each row is ACARA + WARNA +
        // KUANTITI, no Jenis Plak picker. The colour is free text resolved
        // to a canonical WARNA/code (resolveSelempangWarna); price is the
        // flat SELEMPANG_UNIT_PRICE (fall back if the catalog node isn't
        // seeded yet). One shared stock pool, so every row's jenisPlak is
        // the single SELEMPANG_CODE — set on the cart item, not shown here.
        let selempangFields = null;
        if (currentCat.selempang) {
          const resolved = resolveSelempangWarna(row.warna);
          const unitPrice = priceFor(SELEMPANG_CODE) ?? SELEMPANG_UNIT_PRICE;
          const qtyN = Number(row.qty) || 0;
          const rowHarga = unitPrice * qtyN;
          selempangFields = {
            acara: row.acara || '',
            warna: row.warna || '',
            warnaResolved: resolved,
            warnaValid: !row.warna || !!resolved,
            unitPrice,
            rawHarga: rowHarga,
            hargaLabel: `RM ${rowHarga.toFixed(2)}`,
            setAcara: (v) => updaters.onRowField(rowsKey, row.id, 'acara', v),
            setWarna: (v) => updaters.onRowField(rowsKey, row.id, 'warna', v),
          };
        }
        return {
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
          tokohFields,
          ...plakFields,
          ...(selempangFields || {}),
        };
      });
      blockTotalQty = rawRows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

      // ALIRAN TERBAIK (catalog.js's aliranKedudukan) — each TAHUN row's
      // QTY is DERIVED: a KEDUDUKAN "hingga" place N means N plaques (1st
      // to Nth), so QTY = N; a blank KEDUDUKAN keeps the teacher-typed flat
      // QTY. The JENIS PLAK footer's per-row QTY (see the plakRows map
      // below) is each position sub-range crossed with the TAHUNs that
      // ordered it.
      if (currentCat.aliranKedudukan) {
        const nk = !!currentCat.aliranNamaKelas;
        // "Kalau ada kelas": each Tahun's own Nama Kelas list (stored the
        // PPKI way — `${catKey}::${b}::${tahun}::main`). classQty = sum of
        // its QTY; when a Tahun has a list, its own TOTAL is
        // classQty × range size (range = 1 with no KEDUDUKAN), auto-computed
        // and read-only. A Tahun with no list falls back to plain ALIRAN.
        const classQtyFor = (row) => {
          if (!nk) return 0;
          const list = rowsByBlockMap[`${catKey}::${b}::${row.desc}::main`] || [];
          return list.reduce((s, r) => s + ((r.desc || '').trim() ? (Number(r.qty) || 0) : 0), 0);
        };
        const rangeSizeFor = (row) => {
          const hingga = Number(row.kedudukanHingga) || 0;
          return hingga > 0 ? hingga : 1;
        };
        const derivedFor = (row) => {
          const hingga = Number(row.kedudukanHingga) || 0;
          const cq = classQtyFor(row);
          if (cq > 0) return cq * rangeSizeFor(row);
          return hingga > 0 ? hingga : (Number(row.qty) || 0);
        };
        rows = rawRows.map((row) => {
          const hingga = Number(row.kedudukanHingga) || 0;
          const cq = classQtyFor(row);
          const derivedQty = derivedFor(row);
          return {
            id: row.id, desc: row.desc,
            kedudukanHingga: hingga,
            qty: derivedQty ? String(derivedQty) : '',
            qtyReadOnly: hingga > 0 || cq > 0,
            setKedudukanHingga: (v) => updaters.onAliranKedudukan(rowsKey, row.id, v),
            setQty: (v) => updaters.onRowField(rowsKey, row.id, 'qty', v),
          };
        });
        blockTotalQty = rows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

        if (nk) {
          // Per-Tahun Nama Kelas breakdown, same UI shape as PPKI/PBD's
          // (levelBreakdownNoMoral — Nama Kelas only). Every Tahun row gets
          // one (even empty) so the teacher can add classes to a Tahun the
          // import didn't fill — unlike PPKI/PBD (matrix), this list IS the
          // only way to enter a "Kalau ada kelas" quantity.
          levelBreakdown = rawRows.map((row) => {
            const listKey = `${catKey}::${b}::${row.desc}::main`;
            return {
              level: row.desc,
              mainRows: (rowsByBlockMap[listKey] || []).map((r) => ({
                id: r.id, desc: r.desc || '', qty: r.qty || '',
                setDesc: (v) => updaters.onLevelKelasField(listKey, r.id, 'desc', v),
                setQty: (v) => updaters.onLevelKelasField(listKey, r.id, 'qty', v),
                remove: () => updaters.onRemoveLevelKelasRow(listKey, r.id),
              })),
              moralRows: [],
              addMain: () => updaters.onAddLevelKelasRow(listKey),
            };
          });
        }

        // Per-footer-row QTY: for a plak covering places [d..h], count
        // every (TAHUN, place[, class]) it wins — place p counts for a TAHUN
        // whose own KEDUDUKAN reaches at least p, multiplied by that TAHUN's
        // classQty for the "Kalau ada kelas" variant. A footer row with no
        // range (posDari null) takes the flat-KEDUDUKAN TAHUNs' own totals.
        const flatTotal = rawRows.reduce((s, r) => s + ((Number(r.kedudukanHingga) || 0) > 0 ? 0 : derivedFor(r)), 0);
        aliranPlakQty = (pr) => {
          if (!pr.posDari) return flatTotal;
          const d = Number(pr.posDari);
          const h = Number(pr.posHingga) || d;
          return rawRows.reduce((sum, r) => {
            const n = Number(r.kedudukanHingga) || 0;
            const places = Math.max(0, Math.min(h, n) - d + 1);
            const mult = nk ? Math.max(1, classQtyFor(r)) : 1;
            return sum + places * mult;
          }, 0);
        };
      }
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
      // ALIRAN's footer rows each carry a DERIVED qty (a position sub-range
      // crossed with the ranked TAHUNs that ordered it). The teacher can
      // OVERRIDE it with a typed `pr.qty` for the mixed ranked/flat cases
      // the derivation can't express (e.g. one gold medal for the combined
      // senior stream, not one per TAHUN). Every other category's plak row
      // is just the whole block's total, no override.
      const derivedQty = aliranPlakQty ? aliranPlakQty(pr) : blockTotalQty;
      const qtyOverridden = !!aliranPlakQty && pr.qty != null && pr.qty !== '';
      const qty = qtyOverridden ? Math.max(0, Number(pr.qty) || 0) : derivedQty;
      const harga = unitPrice != null ? qty * unitPrice : 0;
      return {
        id: pr.id, jenisPlak: pr.jenisPlak, qty, derivedQty, qtyOverridden, rawHarga: harga,
        unitPrice,
        posDari: pr.posDari, posHingga: pr.posHingga,
        hargaLabel: unitPrice != null ? `RM ${harga.toFixed(2)}` : '—',
        setJenisPlak: (v) => updaters.onPlakSelect(plakRowsKey, pr.id, v),
        setPosField: (field, v) => updaters.onAliranPlakField(plakRowsKey, pr.id, field, v),
        setPlakQty: (v) => updaters.onAliranPlakQty(plakRowsKey, pr.id, v),
        remove: () => updaters.onAliranRemovePlak(plakRowsKey, pr.id),
      };
    });

    blocks.push({
      idx: b,
      qtyLabel: currentCat.hideQtyLabelSuffix ? '' : currentCat.label,
      qtyColHeader: isMatrix ? 'QTY' : (currentCat.qtyColumnLabels?.[b] || currentCat.qtyColumnLabels?.[0] || 'QTY'),
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
      // SUBJEK/POSITION deleted (its own ✕ — see the secondLine object
      // above) leaves nothing on screen to click to bring it back except
      // this — shown next to "+ Add Reference Row" only while it's
      // actually missing, since offering to "add" something already there
      // would be confusing.
      addSubjekPosition: currentCat.deletableReferenceLines && catPositionLine2Placeholder && hiddenLineSlots?.has('2b')
        ? () => updaters.onRestoreReferenceLine(catKey, b, '2b') : null,
      // "+ Tajuk besar 2 baris" — reveals the optional slot-0b line for a
      // teacher who wants a two-line TAJUK BESAR (an imported Alt+Enter
      // already fills it — see excelImport.js's splitTwoLineTajuk). Only
      // offered for reference-sample categories (not SELEMPANG) that don't
      // already have it.
      addTajukLine2: catLinePlaceholders.length > 0 && lineValues[`${catKey}::${b}::0b`] === undefined
        ? () => updaters.onLine(`${catKey}::${b}::0b`, '') : null,
      plakPerBlock: !!currentCat.plakPerBlock,
      descColumnLabel: currentCat.descColumnLabel,
      extraRefColumns,
      canAddRow: !currentCat.capRowsAt5 || rows.length < 5,
      columns, matrixRows, levelBreakdown,
      levelBreakdownNoMoral: !!currentCat.levelBreakdownNoMoral || !!currentCat.aliranNamaKelas,
      aliranNamaKelas: !!currentCat.aliranNamaKelas,
      matrixRowLabel: currentCat.matrixRowLabel || 'Subjek',
      colTotals: colTotals.map((v) => ({ value: v })), grandTotal,
      rows,
      hasNamaKelasList: !!currentCat.hasNamaKelasList,
      plakPerRow: !!currentCat.plakPerRow,
      tokohRowFields: !!currentCat.tokohRowFields,
      tokohFieldCols: currentCat.tokohRowFields ? TOKOH_ROW_FIELDS : [],
      aliranKedudukan: !!currentCat.aliranKedudukan,
      addAliranPlak: () => updaters.onAliranAddPlak(`${catKey}::${b}`),
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
      // SELEMPANG (catalog.js): which half of an order view this block
      // belongs in ('anugerah' default / 'selempang'), and whether to
      // render the plain ACARA/WARNA/KUANTITI table instead of the normal
      // Reference Sample + Jenis Plak + Kuantiti layout.
      section: currentCat.section || 'anugerah',
      selempang: !!currentCat.selempang,
      selempangUnitPrice: priceFor(SELEMPANG_CODE) ?? SELEMPANG_UNIT_PRICE,
      // Looked up from the FULL catalog (not the teacher-picker's
      // hidden-filtered copy) — the SELEMPANG node is hidden so it never
      // shows in the anugerah Jenis Plak picker, but its stock still counts.
      selempangStock: currentCat.selempang ? getStockStatus(SELEMPANG_CODE, plakCatalog) : null,
      addSelempangRow: () => updaters.onAddRow(`${catKey}::${b}`),
      // A named-recipient roster import (excelImport.js's
      // scanSheetForRosters) has no Tahun axis at all — an always-blank
      // Tahun Dari/Hingga column on every one of its rows would just be
      // noise, so the whole column disappears instead of making the
      // teacher notice and delete it by hand. Purely content-derived
      // (not a stored per-import flag), so it also self-corrects the
      // moment the teacher types a real Tahun/Tingkatan into a
      // manually-added row.
      hasTahun: isDynamicMatrix && matrixRows.some((r) => r.tahunFrom || r.tahunTo || r.tingkatanMode),
      hasNamaKelas: isDynamicMatrix && matrixRows.some((r) => r.namaKelas),
      // A flat-quantity section (a TOKOH award, ANUGERAH IKON MURID — one
      // class, no Tahun / Nama Kelas / role axis at all, a real quantity):
      // there is nothing for a row-identity column to hold, so the Nama
      // Kelas column is dropped rather than shown as an empty placeholder
      // the teacher has to ✕. Guarded to exactly one filled-in row so a
      // teacher starting a fresh matrix by hand still gets the column.
      matrixNoRowAxis: isDynamicMatrix && grandTotal > 0 && matrixRows.length === 1
        && !matrixRows[0].tahunFrom && !matrixRows[0].tahunTo && !matrixRows[0].namaKelas
        && !matrixRows[0].jawatan && !matrixRows[0].kelasName && !matrixRows[0].eline2
        && !matrixRows[0].tingkatanMode,
      // Only one subject column and it is blank / the synthetic "KUANTITI"
      // stand-in (a TAHAP class list, a grade×class expansion, a plain
      // Tahun quantity list — every row just gets N, there is no subject
      // axis): render that column as a fixed "KUANTITI" header, not an
      // editable "e.g. KEMAHIRAN HIDUP" box the teacher has to make sense of.
      matrixNoSubjectAxis: isDynamicMatrix && columns.length === 1
        && ['', 'KUANTITI', 'KEDUDUKAN'].includes((columns[0].subject || '').trim().toUpperCase()),
      hasJawatan: isDynamicMatrix && matrixRows.some((r) => r.jawatan),
      hasKelasName: isDynamicMatrix && matrixRows.some((r) => r.kelasName),
      hasEline2: isDynamicMatrix && matrixRows.some((r) => r.eline2),
      // "Nama Kelas" by default, but a roster import's own column header
      // text (NAMA MURID/NAMA GURU/NAMA PELAJAR) rides along as a
      // synthetic lineValues entry the same way hiddenLines/refOrder do,
      // overriding it here — see excelImport.js's namaKelasLabel /
      // AppState.jsx's merge into lineValues.
      namaKelasLabel: lineValues[`${catKey}::${b}::namaKelasLabel`] || 'Nama Kelas',
      // Which sheet this section was imported from ("PPKI", "MP THP 1", ...)
      // — see excelImport.js's `sourceSheet` / AppState.jsx's merge into
      // lineValues. Blank for a hand-added or hand-duplicated block that
      // never came from a file.
      sourceSheet: lineValues[`${catKey}::${b}::sourceSheet`] || '',
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
  onAddReferenceLine: () => {}, onRemoveReferenceLine: () => {}, onDeleteReferenceLine: () => {}, onRestoreReferenceLine: () => {},
  onLevelKelasField: () => {}, onAddLevelKelasRow: () => {}, onRemoveLevelKelasRow: () => {},
  onAliranKedudukan: () => {}, onAliranPlakField: () => {}, onAliranAddPlak: () => {}, onAliranRemovePlak: () => {}, onAliranPlakQty: () => {},
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
    // SELEMPANG rows carry no `desc` (they're ACARA/WARNA/KUANTITI), so the
    // sum-by-desc path below would collapse every row onto the first
    // (undefined === undefined). Upsert by id instead, like the matrix case.
    const selempangCat = CATEGORIES.find((c) => c.key === it.categoryKey)?.selempang;
    if (!rowsByBlock[key]) {
      rowsByBlock[key] = it.detail.rows.map((r) => ({ ...r }));
    } else if (it.detail.matrix || selempangCat) {
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
  // PPKI's own Nama Kelas + Moral Kelas breakdown (catalog.js's
  // hasLevelBreakdown, snapshotDetail above) — each of its own composite
  // keys (`${catKey}::${blockIdx}::${level}::main`/`::moral`) restores
  // straight into rowsByBlock under that SAME key, not `key` (the plain
  // `${catKey}::${blockIdx}` this function's other branches use), since a
  // level's own two lists are keyed more specifically than that.
  if (it.detail.namaKelasBreakdown) {
    Object.entries(it.detail.namaKelasBreakdown).forEach(([k, rows]) => {
      if (!rowsByBlock[k]) {
        rowsByBlock[k] = rows.map((r) => ({ ...r }));
      } else {
        rows.forEach((r) => {
          const existing = rowsByBlock[k].find((er) => er.id === r.id);
          if (existing) Object.assign(existing, r);
          else rowsByBlock[k].push({ ...r });
        });
      }
    });
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
      // posDari/posHingga/qty carried through for ALIRAN (harmless nulls for
      // every other category) so the rebuilt footer row shows the same qty
      // and harga that was actually ordered, not a re-derived guess.
      plakRows[key] = [...(plakRows[key] || []), { id: it.id, jenisPlak: it.jenisPlak, unitPrice: it.unitPrice, posDari: it.posDari, posHingga: it.posHingga, qty: it.qty }];
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
      // posDari/posHingga restore the ALIRAN footer's position ranges so the
      // qty re-derives correctly; a bare `qty` override is deliberately NOT
      // carried — a reorder/amend draft re-derives fresh, and the teacher
      // re-enters an override if they still need one.
      plakRows[key] = blockItems.map((it) => ({ id: it.id, jenisPlak: it.jenisPlak, posDari: it.posDari, posHingga: it.posHingga }));
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
    plakRows[key] = [{ id: item.id, jenisPlak: item.jenisPlak, unitPrice: item.unitPrice, posDari: item.posDari, posHingga: item.posHingga, qty: item.qty }];

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
