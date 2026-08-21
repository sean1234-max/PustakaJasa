import { CATEGORIES, getCategorySubjects, customMatrixColumnTahunKey } from './catalog';

export function buildInitialRowsByBlock(schoolLanguage = 'SK') {
  const out = {};
  let id = 1;
  CATEGORIES.filter((c) => c.mode === 'list').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = cat.rows.map((label) => ({ id: id++, desc: label, qty: '' }));
    }
  });
  // dynamicMatrix categories (PBD): seed each block with the fixed default
  // subject rows (custom: false — locked, can't be renamed/removed; a
  // teacher can only add extra rows on top via +Add Subject, see
  // draftUpdaters.js onAddRow).
  CATEGORIES.filter((c) => c.mode === 'dynamicMatrix').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = getCategorySubjects(cat, schoolLanguage).map((subject) => ({ id: id++, desc: subject, custom: false }));
    }
  });
  return out;
}

// Column definitions (Tahun range + Nama Kelas) for dynamicMatrix
// categories — each block starts with one blank column, same as a fresh
// +Add Kelas. tahunFrom/tahunTo let one row cover several year levels at
// once (e.g. TAHUN 3 - TAHUN 6) sharing the same Nama Kelas and subject
// quantities, split back out per-year on export — see exportCsv.js.
export function buildInitialColumnsByBlock() {
  const out = {};
  let id = 1;
  CATEGORIES.filter((c) => c.mode === 'dynamicMatrix').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = [{ id: id++, tahunFrom: '', tahunTo: '', namaKelas: '' }];
    }
  });
  return out;
}

// `freeColumns` matrix categories (OTHERS) keep their columns in the flat
// matrixValues store, not columnsByBlock (see catalog.js/computeBlocks.js),
// so their "start with one blank column" seed lives here instead — one
// blank Tahun key (existence marker, same as a fresh "+ Add Tahun") per
// category, so a teacher opening the tab for the first time already has a
// column ready to fill instead of an empty table.
export function buildInitialMatrixValues() {
  const out = {};
  let id = 1;
  CATEGORIES.filter((c) => c.mode === 'matrix' && c.freeColumns).forEach((cat) => {
    out[customMatrixColumnTahunKey(cat.key, id)] = '';
    id += 1;
  });
  return out;
}

export function buildInitialPlakRows() {
  const out = {};
  let id = 1;
  CATEGORIES.forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = [{ id: id++, jenisPlak: '' }];
    }
  });
  return out;
}
