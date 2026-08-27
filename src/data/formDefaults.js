import { CATEGORIES, getCategorySubjects } from './catalog';

export function buildInitialRowsByBlock(schoolLanguage = 'SK') {
  const out = {};
  let id = 1;
  CATEGORIES.filter((c) => c.mode === 'list').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      // LONJAKAN seeds a fixed preset list; TOKOH has no fixed rows (`rows`
      // is omitted in catalog.js) — the teacher types every Description
      // themselves via "+ Add Row", starting from one blank row instead of
      // an irrelevant preset to delete around. OTHERS' own block 0 instead
      // pre-fills MP THP's 13-subject list (catalog.js's
      // seedRowsFromSubjects) — still freely editable/removable, just a
      // head start instead of typing every subject from scratch; every
      // OTHERS block past 0 only ever gets populated by Duplicate copying
      // block 0's rows forward (see draftUpdaters.js's onDuplicateBlock),
      // so seeding them here too would just be immediately overwritten —
      // cheapest to leave those as a single blank row like TOKOH.
      if (cat.rows && cat.rows.length > 0) {
        out[`${cat.key}::${b}`] = cat.rows.map((label) => ({ id: id++, desc: label, qty: '' }));
      } else if (cat.seedRowsFromSubjects && b === 0) {
        out[`${cat.key}::${b}`] = getCategorySubjects(cat, schoolLanguage).map((subject) => ({ id: id++, desc: subject, qty: '', custom: true }));
      } else {
        out[`${cat.key}::${b}`] = [{ id: id++, desc: '', qty: '', custom: true }];
      }
    }
  });
  // dynamicMatrix categories (PBD/ALIRAN): seed each block with the fixed
  // default subject rows (custom: false — locked, can't be renamed/removed;
  // a teacher can only add extra rows on top via +Add Subject, see
  // draftUpdaters.js onAddRow). KLAS_MATRIX opts out via
  // editableDefaultSubjects (custom: true) so its own default subjects stay
  // freely renamable/removable, matching OTHERS' own subject list behavior.
  CATEGORIES.filter((c) => c.mode === 'dynamicMatrix').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = getCategorySubjects(cat, schoolLanguage).map((subject) => ({ id: id++, desc: subject, custom: !!cat.editableDefaultSubjects }));
    }
  });
  return out;
}

// Column definitions for dynamicMatrix categories (Tahun range + Nama
// Kelas — PBD/ALIRAN) and for `hasNamaKelasList` list categories (a
// simpler {id, name} shape — OTHERS, see catalog.js/computeBlocks.js).
// Either way each block starts with one blank entry, same as a fresh
// "+ Add Tahun"/"+ Add Nama Kelas".
export function buildInitialColumnsByBlock() {
  const out = {};
  let id = 1;
  CATEGORIES.filter((c) => c.mode === 'dynamicMatrix').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = [{ id: id++, tahunFrom: '', tahunTo: '', namaKelas: '' }];
    }
  });
  CATEGORIES.filter((c) => c.mode === 'list' && c.hasNamaKelasList).forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = [{ id: id++, name: '' }];
    }
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
