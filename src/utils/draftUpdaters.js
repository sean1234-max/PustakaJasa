import {
  customMatrixLabelKey, customMatrixColumnTahunKey, getCustomMatrixColumnIds,
} from '../data/catalog';

// Builds the block-editing callbacks (onLine, onMatrix, onRowField, ...) for
// a given "draft" namespace inside global state — the same set of fields is
// duplicated twice in state (main New Order draft, Add On draft), so this
// factory avoids writing the wiring twice.
export function createDraftUpdaters(patch, fields) {
  const {
    lineValues, matrixValues, rowsByBlock, plakRows, columnsByBlock,
    nextRowId, nextColumnId,
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
    // (LONJAKAN/TOKOH), which don't look at `custom` at all.
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
    // Kelas start blank for the teacher to fill in.
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
    // Matrix "+ Add Tahun" (`freeColumns` categories only — OTHERS) mirrors
    // onAddMatrixRow above, on the column axis (see
    // customMatrixColumnTahunKey/getCustomMatrixColumnIds in catalog.js) —
    // a genuinely new Tahun range, so both Tahun and Nama Kelas start blank.
    onAddMatrixColumn: (catKey) => patch((st) => ({
      [matrixValues]: { ...st[matrixValues], [customMatrixColumnTahunKey(catKey, st[nextColumnId])]: '' },
      [nextColumnId]: st[nextColumnId] + 1,
    })),
    // "+ Add Kelas" — another class under the same Tahun text as the last
    // custom column, so Tahun carries over automatically and only Nama
    // Kelas is left blank for the teacher to fill in. Every subject's qty
    // against that last column carries over too (most classes under the
    // same Tahun order the same spread) — the teacher only needs to type
    // the new Nama Kelas and double-check/adjust individual qty cells,
    // rather than re-typing the whole column from scratch.
    onAddMatrixColumnSameTahun: (catKey) => patch((st) => {
      const existingIds = getCustomMatrixColumnIds(catKey, st[matrixValues]);
      const lastId = existingIds[existingIds.length - 1];
      const newId = st[nextColumnId];
      const next = { ...st[matrixValues] };
      let lastTahun = '';
      if (lastId != null) {
        lastTahun = st[matrixValues][customMatrixColumnTahunKey(catKey, lastId)] || '';
        const lastSuffix = `::col-${lastId}`;
        const newSuffix = `::col-${newId}`;
        Object.keys(st[matrixValues]).forEach((k) => {
          if (k.endsWith(lastSuffix)) next[`${k.slice(0, -lastSuffix.length)}${newSuffix}`] = st[matrixValues][k];
        });
      }
      next[customMatrixColumnTahunKey(catKey, newId)] = lastTahun;
      return { [matrixValues]: next, [nextColumnId]: newId + 1 };
    }),
    // A custom column's own Tahun/Nama Kelas keys share the `${catKey}::
    // col-<id>::` prefix (matched here), but its per-subject cell keys carry
    // that `col-<id>` at the END instead (`${catKey}::<rowKey>::col-<id>`),
    // not right after catKey like a custom row's cells — so those need a
    // suffix match instead.
    onMatrixColumnRemove: (catKey, colId) => patch((st) => {
      const ownPrefix = `${catKey}::col-${colId}::`;
      const cellSuffix = `::col-${colId}`;
      const next = { ...st[matrixValues] };
      Object.keys(next).forEach((k) => { if (k.startsWith(ownPrefix) || k.endsWith(cellSuffix)) delete next[k]; });
      return { [matrixValues]: next };
    }),
  };
}
