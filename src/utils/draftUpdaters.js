import { customMatrixLabelKey } from '../data/catalog';

// Builds the block-editing callbacks (onLine, onMatrix, onRowField, ...) for
// a given "draft" namespace inside global state — the same set of fields is
// duplicated three times in state (main New Order draft, Amend draft, Add On
// draft), so this factory avoids writing the wiring three times.
export function createDraftUpdaters(patch, fields, includeNamaKelas) {
  const {
    lineValues, matrixValues, rowsByBlock, plakRows,
    nextRowId, namaKelasRows, nextNamaKelasRowId,
  } = fields;

  const updaters = {
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
    onAddRow: (rowsKey) => patch((st) => ({
      [rowsByBlock]: {
        ...st[rowsByBlock],
        [rowsKey]: [...(st[rowsByBlock][rowsKey] || []), { id: st[nextRowId], desc: '', qty: '' }],
      },
      [nextRowId]: st[nextRowId] + 1,
    })),
    onPlakSelect: (rowsKey, id, val) => patch((st) => ({
      [plakRows]: {
        ...st[plakRows],
        [rowsKey]: st[plakRows][rowsKey].map((r) => (r.id === id ? { ...r, jenisPlak: val } : r)),
      },
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
  };

  if (includeNamaKelas) {
    updaters.onNamaKelas = (field, id, val) => patch((st) => ({
      [namaKelasRows]: st[namaKelasRows].map((r) => (r.id === id ? { ...r, [field]: val } : r)),
    }));
    updaters.onNamaKelasRemove = (id) => patch((st) => ({
      [namaKelasRows]: st[namaKelasRows].filter((r) => r.id !== id),
    }));
    updaters.onAddNamaKelas = () => patch((st) => ({
      [namaKelasRows]: [...st[namaKelasRows], { id: st[nextNamaKelasRowId], namaKelas: '', tahun: '' }],
      [nextNamaKelasRowId]: st[nextNamaKelasRowId] + 1,
    }));
  }

  return updaters;
}
