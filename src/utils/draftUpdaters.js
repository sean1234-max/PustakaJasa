import { CATEGORIES, customMatrixLabelKey } from '../data/catalog';

// Builds the block-editing callbacks (onLine, onMatrix, onRowField, ...) for
// a given "draft" namespace inside global state — the same set of fields is
// duplicated twice in state (main New Order draft, Add On draft), so this
// factory avoids writing the wiring twice.
export function createDraftUpdaters(patch, fields) {
  const {
    lineValues, matrixValues, rowsByBlock, plakRows, columnsByBlock,
    nextRowId, nextColumnId, visibleBlocksByCategory,
  } = fields;

  return {
    onLine: (key, val) => patch((st) => ({ [lineValues]: { ...st[lineValues], [key]: val } })),
    onMatrix: (key, val) => patch((st) => ({ [matrixValues]: { ...st[matrixValues], [key]: val } })),
    onRowField: (rowsKey, id, field, val) => patch((st) => ({
      [rowsByBlock]: {
        ...st[rowsByBlock],
        [rowsKey]: st[rowsByBlock][rowsKey].map((r) => (r.id === id ? { ...r, [field]: val } : r)),
      },
    })),
    onRowRemove: (rowsKey, id) => patch((st) => ({
      [rowsByBlock]: { ...st[rowsByBlock], [rowsKey]: st[rowsByBlock][rowsKey].filter((r) => r.id !== id) },
    })),
    // `custom: true` marks a row added by the teacher rather than seeded by
    // default (e.g. PBD's fixed 13 subjects) — OrderCategoryBlock only lets
    // custom rows be renamed/removed. Harmless for plain list categories
    // (LONJAKAN/TOKOH/OTHERS), which don't look at `custom` at all.
    onAddRow: (rowsKey) => patch((st) => ({
      [rowsByBlock]: {
        ...st[rowsByBlock],
        [rowsKey]: [...(st[rowsByBlock][rowsKey] || []), { id: st[nextRowId], desc: '', qty: '', custom: true }],
      },
      [nextRowId]: st[nextRowId] + 1,
    })),
    onPlakSelect: (rowsKey, id, val) => patch((st) => ({
      [plakRows]: {
        ...st[plakRows],
        [rowsKey]: st[plakRows][rowsKey].map((r) => (r.id === id ? { ...r, jenisPlak: val } : r)),
      },
    })),
    // Columns (Tahun + Nama Kelas) — dynamicMatrix categories only (PBD).
    // "+ Add Tahun" — a genuinely new Tahun range, so both Tahun and Nama
    // Kelas start blank for the teacher to fill in. Also reused as-is for
    // `hasNamaKelasList` categories' Nama Kelas list (OTHERS) via
    // onAddNamaKelas below — this generic field-merge/remove pair doesn't
    // care which shape ({tahunFrom,tahunTo,namaKelas} vs {name}) lives in
    // the array.
    onColumnField: (colsKey, id, field, val) => patch((st) => ({
      [columnsByBlock]: {
        ...st[columnsByBlock],
        [colsKey]: st[columnsByBlock][colsKey].map((c) => (c.id === id ? { ...c, [field]: val } : c)),
      },
    })),
    onColumnRemove: (colsKey, id) => patch((st) => ({
      [columnsByBlock]: { ...st[columnsByBlock], [colsKey]: st[columnsByBlock][colsKey].filter((c) => c.id !== id) },
    })),
    onAddColumn: (colsKey) => patch((st) => ({
      [columnsByBlock]: {
        ...st[columnsByBlock],
        [colsKey]: [...(st[columnsByBlock][colsKey] || []), { id: st[nextColumnId], tahunFrom: '', tahunTo: '', namaKelas: '' }],
      },
      [nextColumnId]: st[nextColumnId] + 1,
    })),
    // "+ Add Kelas" — another class under the same Tahun range as the last
    // row, so Tahun carries over automatically and only Nama Kelas is left
    // blank for the teacher to fill in.
    onAddColumnSameTahun: (colsKey) => patch((st) => {
      const existing = st[columnsByBlock][colsKey] || [];
      const last = existing[existing.length - 1];
      return {
        [columnsByBlock]: {
          ...st[columnsByBlock],
          [colsKey]: [...existing, {
            id: st[nextColumnId],
            tahunFrom: last ? last.tahunFrom : '',
            tahunTo: last ? last.tahunTo : '',
            namaKelas: '',
          }],
        },
        [nextColumnId]: st[nextColumnId] + 1,
      };
    }),
    // "+ Add Nama Kelas" (`hasNamaKelasList` categories only — OTHERS): a
    // fresh, blank class-name entry — see onColumnField/onColumnRemove above
    // for editing/removing it.
    onAddNamaKelas: (colsKey) => patch((st) => ({
      [columnsByBlock]: {
        ...st[columnsByBlock],
        [colsKey]: [...(st[columnsByBlock][colsKey] || []), { id: st[nextColumnId], name: '' }],
      },
      [nextColumnId]: st[nextColumnId] + 1,
    })),
    // Matrix "+ Add Row" (see OrderCategoryBlock / getCustomMatrixRowIds in
    // src/data/catalog.js): a custom row's existence is just its
    // `__label__` key being present in matrixValues, so adding one is a
    // plain onMatrix write with a fresh id — no separate row-list state to
    // keep in sync. Removing deletes every key under that row's id
    // (label + every column cell) in one pass.
    onAddMatrixRow: (catKey) => patch((st) => ({
      [matrixValues]: { ...st[matrixValues], [customMatrixLabelKey(catKey, st[nextRowId])]: '' },
      [nextRowId]: st[nextRowId] + 1,
    })),
    onMatrixRowRemove: (catKey, rowId) => patch((st) => {
      const prefix = `${catKey}::custom-${rowId}::`;
      const next = { ...st[matrixValues] };
      Object.keys(next).forEach((k) => { if (k.startsWith(prefix)) delete next[k]; });
      return { [matrixValues]: next };
    }),
    // "Duplicate" (`hasNamaKelasList` categories only — OTHERS, see
    // catalog.js's blocksCount: 6 pre-allocating one slot per Malaysian
    // primary grade): clones only the Kuantiti part of block `fromBlockIdx`
    // — its TAHUN value, Description/QTY rows, and Nama Kelas list — into
    // the next block, then reveals that block (see NewOrderStep2/AddOn's
    // visible-block slicing). Reference Sample and Jenis Plak are left
    // blank for the teacher to fill in fresh on the new block; only TAHUN
    // needs changing afterward. IDs are carried over as-is rather than
    // reminted — each block's rowsByBlock/columnsByBlock entry is its own
    // independently-keyed array, so ids only ever need to be unique within
    // one block's own array, never across blocks.
    onDuplicateBlock: (catKey, fromBlockIdx) => patch((st) => {
      const cat = CATEGORIES.find((c) => c.key === catKey);
      const toBlockIdx = fromBlockIdx + 1;
      if (!cat || toBlockIdx >= (cat.blocksCount || 1)) return {};
      const tahunKey = `${catKey}::${fromBlockIdx}::tahun`;
      const newLineValues = { ...st[lineValues], [`${catKey}::${toBlockIdx}::tahun`]: st[lineValues][tahunKey] || '' };
      const fromKey = `${catKey}::${fromBlockIdx}`;
      const toKey = `${catKey}::${toBlockIdx}`;
      const newRowsByBlock = {
        ...st[rowsByBlock],
        [toKey]: JSON.parse(JSON.stringify(st[rowsByBlock][fromKey] || [])),
      };
      const newColumnsByBlock = {
        ...st[columnsByBlock],
        [toKey]: JSON.parse(JSON.stringify((st[columnsByBlock] && st[columnsByBlock][fromKey]) || [])),
      };
      const currentVisible = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
      const newVisibleBlocksByCategory = {
        ...st[visibleBlocksByCategory],
        [catKey]: Math.min(cat.blocksCount || 1, Math.max(currentVisible, toBlockIdx + 1)),
      };
      return {
        [lineValues]: newLineValues, [rowsByBlock]: newRowsByBlock, [columnsByBlock]: newColumnsByBlock,
        [visibleBlocksByCategory]: newVisibleBlocksByCategory,
      };
    }),
  };
}
