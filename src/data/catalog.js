export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SUBJECTS_CORE = [
  'BAHASA MELAYU', 'BAHASA INGGERIS', 'MATEMATIK', 'SAINS', 'PENDIDIKAN ISLAM',
  'BAHASA ARAB', 'PENDIDIKAN SENI VISUAL', 'PENDIDIKAN JASMANI', 'PENDIDIKAN KESIHATAN',
  'PENDIDIKAN MUZIK', 'PENDIDIKAN MORAL', 'BAHASA CINA', 'BAHASA TAMIL',
];

// SJKC (Chinese-medium) equivalent of SUBJECTS_CORE, in the same order —
// engraved directly onto the medal via buildMatrixRows (src/utils/exportCsv.js),
// so these must be the CORRECT official SJKC subject names, not a rough
// translation. TODO(pustakajasa): have Production/an SJKC-fluent reviewer
// confirm every line here before any real SJKC order goes to production.
const SUBJECTS_CORE_CN = [
  '国语', '英语', '数学', '科学', '伊斯兰教育',
  '阿拉伯语', '视觉艺术教育', '体育教育', '健康教育',
  '音乐教育', '道德教育', '华文', '淡米尔语',
];

// MP THP 2's own sheet carries two extra subjects — SEJARAH and REKA BENTUK
// & TEKNOLOGI — and its sheet lists them right after PENDIDIKAN MORAL, before
// BAHASA CINA / BAHASA TAMIL. computeBlocks renders the matrix rows in this
// array's order, so it must match the sheet exactly or the teacher sees the
// subjects jump around relative to the Excel they filled.
const SUBJECTS_MP2 = [
  ...SUBJECTS_CORE.slice(0, 11), 'SEJARAH', 'REKA BENTUK & TEKNOLOGI',
  ...SUBJECTS_CORE.slice(11),
];
const SUBJECTS_MP2_CN = [
  ...SUBJECTS_CORE_CN.slice(0, 11), '历史', '设计与工艺',
  ...SUBJECTS_CORE_CN.slice(11),
];

// Which of SUBJECTS_CORE/SUBJECTS_CORE_CN is "Pendidikan Moral" — PPKI's own
// Nama Kelas breakdown (hasLevelBreakdown below) sums a level's Moral Kelas
// list into just this one subject's own KUANTITI cell, every other subject
// getting the level's plain Nama Kelas sum instead (see excelImport.js's
// parsePpkiSheet and draftUpdaters.js's recomputeLevelBreakdown).
export const MORAL_SUBJECT_BY_LANGUAGE = { SK: 'PENDIDIKAN MORAL', SJKC: '道德教育' };

// ALIRAN TERBAIK's KEDUDUKAN — Malay ordinals PERTAMA (1st) .. KESEPULUH
// (10th). The sheet's KEDUDUKAN column is a "DARI → HINGGA KE" range
// (excelImport.js's parseAliranSheet); a range PERTAMA→KESEPULUH means
// every place from 1st to 10th gets its own plaque. Its own JENIS PLAK
// footer maps position sub-ranges to plaque types (1st-3rd = one plak,
// 4th-10th = another).
export const MALAY_ORDINALS = [
  'PERTAMA', 'KEDUA', 'KETIGA', 'KEEMPAT', 'KELIMA',
  'KEENAM', 'KETUJUH', 'KELAPAN', 'KESEMBILAN', 'KESEPULUH',
];
// Word (or "KE-8" / "KE 8" / a bare "8") -> 1-based position, or null.
export function ordinalToNum(text) {
  const s = String(text || '').trim().toUpperCase();
  if (!s || s === '-') return null;
  const idx = MALAY_ORDINALS.indexOf(s);
  if (idx >= 0) return idx + 1;
  // also accept "KEDELAPAN" (Indonesian 8th) as an alias for KELAPAN
  if (s === 'KEDELAPAN') return 8;
  const m = s.match(/^KE[-\s]?(\d{1,2})$/) || s.match(/^(\d{1,2})$/);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= MALAY_ORDINALS.length) return n; }
  return null;
}
export function numToOrdinal(n) {
  return MALAY_ORDINALS[n - 1] || '';
}

// Same TODO applies: class-level labels for the MP THP 1/2 matrix columns,
// only PPKI kept untranslated (national programme name, used as-is).
// PRA PPKI/PPKI/PRASEKOLAH are their own separate PPKI category below —
// no established CN translation exists for the first two, so PPKI has no
// SJKC columnsByLanguage variant at all and falls back to SK (see
// getCategoryColumns).
const PPKI_LEVELS = ['PRA PPKI', 'PPKI', 'PRASEKOLAH'];
const MP_THP1_LEVELS_MY = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3'];
const MP_THP1_LEVELS_CN = ['一年级', '二年级', '三年级'];
const CLASS_LEVELS_MY_UPPER = ['TAHUN 4', 'TAHUN 5', 'TAHUN 6'];
const CLASS_LEVELS_CN_UPPER = ['四年级', '五年级', '六年级'];

const ALL_TAHUN = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'];

// Resolves a matrix category's subject/column labels for the given school
// language ('SK' | 'SJKC'), falling back to the Malay ('SK') list for any
// language the category doesn't have a variant for, or an order placed
// before school_language existed (null/undefined).
export function getCategorySubjects(cat, schoolLanguage) {
  return (cat.subjectsByLanguage && cat.subjectsByLanguage[schoolLanguage]) || cat.subjectsByLanguage.SK;
}
export function getCategoryColumns(cat, schoolLanguage) {
  return (cat.columnsByLanguage && cat.columnsByLanguage[schoolLanguage]) || cat.columnsByLanguage.SK;
}

// Same fallback-to-SK pattern as getCategorySubjects/getCategoryColumns
// above, for OTHERS' Reference Sample field labels — the only category
// whose labels are generic placeholders rather than a single worked
// example, so per-language text is worth having (see catalog.js's OTHERS
// entry). Every other category keeps a plain `linePlaceholders`/
// `positionLine2Placeholder`/etc. (no *ByLanguage variant), so these just
// fall through to that unchanged.
export function getCategoryLinePlaceholders(cat, schoolLanguage) {
  if (!cat.linePlaceholdersByLanguage) return cat.linePlaceholders;
  return cat.linePlaceholdersByLanguage[schoolLanguage] || cat.linePlaceholdersByLanguage.SK;
}
export function getCategoryPositionLine2Placeholder(cat, schoolLanguage) {
  if (!cat.positionLine2PlaceholderByLanguage) return cat.positionLine2Placeholder;
  return cat.positionLine2PlaceholderByLanguage[schoolLanguage] || cat.positionLine2PlaceholderByLanguage.SK;
}
export function getCategoryTahunPlaceholder(cat, schoolLanguage) {
  if (!cat.tahunPlaceholderByLanguage) return cat.tahunPlaceholder;
  return cat.tahunPlaceholderByLanguage[schoolLanguage] || cat.tahunPlaceholderByLanguage.SK;
}
export function getCategoryNamaKelasPlaceholder(cat, schoolLanguage) {
  if (!cat.namaKelasPlaceholderByLanguage) return cat.namaKelasPlaceholder;
  return cat.namaKelasPlaceholderByLanguage[schoolLanguage] || cat.namaKelasPlaceholderByLanguage.SK;
}

const TAHUN_ORDER = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'];

// Expands a PBD TERBAIK / ALIRAN TERBAIK class row's Tahun range into every
// individual "TAHUN N" it covers — e.g. ('TAHUN 3', 'TAHUN 6') -> ['TAHUN 3',
// 'TAHUN 4', 'TAHUN 5', 'TAHUN 6']. `to` may be blank/equal to `from` for a
// single-year row; either order (from > to) is tolerated. Returns [] if
// `from` isn't a recognized Tahun (row not filled in yet).
export function tahunRangeYears(from, to) {
  const fromIdx = TAHUN_ORDER.indexOf(from);
  if (fromIdx === -1) return [];
  const toIdx = to ? TAHUN_ORDER.indexOf(to) : fromIdx;
  if (toIdx === -1) return [from];
  const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  return TAHUN_ORDER.slice(lo, hi + 1);
}

// A matrix category's subject rows (MP THP 1/2) come from a fixed catalog
// list, but the teacher can add extra rows for a subject/award not on that
// list (see OrderCategoryBlock's matrix "+ Add Row"). Those live in the same
// flat matrixValues store as the fixed rows, just under a synthetic
// `custom-<id>` slot instead of a real subject name, with the typed label
// text stored alongside the quantity cells under a parallel `__label__` key
// — so a custom row's very existence, and which id backs it, can be read
// straight off whichever `__label__` keys are present, with no separate
// list of "active custom rows" to keep in sync.
export const CUSTOM_MATRIX_LABEL_SUFFIX = '::__label__';
function customMatrixPrefix(catKey) {
  return `${catKey}::custom-`;
}
export function customMatrixLabelKey(catKey, rowId) {
  return `${customMatrixPrefix(catKey)}${rowId}${CUSTOM_MATRIX_LABEL_SUFFIX}`;
}
export function getCustomMatrixRowIds(catKey, matrixValues) {
  const prefix = customMatrixPrefix(catKey);
  return Object.keys(matrixValues || {})
    .filter((k) => k.startsWith(prefix) && k.endsWith(CUSTOM_MATRIX_LABEL_SUFFIX))
    .map((k) => k.slice(prefix.length, k.length - CUSTOM_MATRIX_LABEL_SUFFIX.length));
}

// Canonical matrix cell-key builder — `rowKey` is a fixed subject's own text
// or `custom-<rowId>` for a teacher-added row (see getCustomMatrixRowIds
// above); `colKey` is always a fixed column's own text (MP THP 1/2 — the
// only isMatrix categories left, now that OTHERS has moved to `list` mode
// below). Matches the exact key shape MP THP always used
// (`${catKey}::${subject}::${column}`) so existing orders' stored keys
// still resolve.
export function matrixCellKey(catKey, rowKey, colKey) {
  return `${catKey}::${rowKey}::${colKey}`;
}

// Shared reference-sample shape for the four matrix-style categories
// (MP THP 1/2, PBD/ALIRAN TERBAIK) — TAJUK BESAR / YEAR / ACARA (★, red —
// the position text that actually gets engraved) / a CONTOH-only "( TAHUN
// ? )" line, same generic-label style OTHERS uses rather than each
// category's own worked "e.g. ..." example. The old subject/position
// second box (e.g. "BAHASA MELAYU") is dropped entirely — it was already
// only ever a CONTOH (the real per-cell/per-column subject always comes
// from the fixed subject list or the teacher's own PBD columns, see
// exportCsv.js's buildMatrixRows/buildPbdMatrixRows — the reference-sample
// text was never read), so losing it doesn't change what exports — true
// for PBD/ALIRAN below, which still use this bare 4-line set. PPKI and MP
// THP 1 add their own `positionLine2Placeholder` back on top of it (same
// "( SUBJEK/POSITION )" second box Main Template already uses after its own
// ACARA) — their own imported file's reference box genuinely has this line
// (a worked example of ACARA + a real subject name), and the teacher should
// see it, even though what actually gets engraved is still each cell's own
// real subject, never this preview text (see exportCsv.js's buildMatrixRows).
const STANDARD_REFERENCE_LINES = ['TAJUK BESAR', 'YEAR', 'ACARA', '( TAHUN ? )'];

// TOKOH_SHEET's per-row metadata columns (catalog.js's tokohRowFields).
// `place` says which side of the KUANTITI/JENIS PLAK columns each renders
// on, so the review table matches the source sheet's column order. Stored
// per row in rowsByBlock via the generic onRowField updater (same as
// desc/qty) — no dedicated updater needed.
export const TOKOH_ROW_FIELDS = [
  { key: 'namaMurid', label: 'NAMA MURID', place: 'beforeQty' },
  { key: 'gambar', label: 'GAMBAR', place: 'beforeQty', yesNo: true },
  { key: 'design', label: 'DESIGN', place: 'afterPlak' },
];

// PPKI / MP THP 1 / MP THP 2 (and their "Kalau ada kelas" variants) — the
// subject rows aren't a fixed engraving list: the teacher can rename a
// subject on the source sheet ("PENDIDIKAN JASMANI" -> "PENDIDIKAN JASMANI &
// HIPPO"), add one, or leave one blank, and the website must show exactly
// what the sheet has, editable. `subjectsFromImport` tells computeBlocks /
// exportCsv / draftUpdaters to build the matrix rows off the imported list
// (stored as editable `custom-<id>` rows — see getCustomMatrixRowIds) instead
// of subjectsByLanguage. The catalog list below is still the pre-import
// default so the tab is usable before any file is dropped.
const SUBJECTS_FROM_IMPORT = true;

// SELEMPANG (sash) — its own small category. The source sheet only has
// ACARA / WARNA / KUANTITI: no engraving/Reference Sample, no per-colour
// Jenis Plak. All four colours draw from ONE shared stock pool and cost the
// same, so every selempang line is one catalog code — `SELEMPANG_CODE` (a
// real plak_catalog_nodes leaf seeded by migration 0057) — priced at
// `SELEMPANG_UNIT_PRICE`. The colour a teacher types (name in Malay or
// English, or the numeric code) is recorded on the order line for the
// office/Production to see, but never affects stock or price.
export const SELEMPANG_CODE = 'SELEMPANG';
export const SELEMPANG_UNIT_PRICE = 40;
export const SELEMPANG_WARNA = [
  { warna: 'BIRU', code: '0053', aliases: ['BLUE'] },
  { warna: 'HIJAU', code: '0052', aliases: ['GREEN'] },
  { warna: 'KUNING', code: '0051', aliases: ['YELLOW'] },
  { warna: 'MERAH', code: '0050', aliases: ['RED'] },
];
// Normalises whatever the teacher typed into a WARNA cell — "blue", "Biru",
// "BIRU", or the numeric "0053" all resolve to the same entry. Returns null
// for anything unrecognised (caller surfaces it as a fix-it error, never a
// silent drop).
export function resolveSelempangWarna(input) {
  const s = String(input || '').trim().toUpperCase();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return SELEMPANG_WARNA.find((w) => (
    w.warna === s || w.aliases.includes(s)
    || w.code === s || (digits && w.code === digits.padStart(4, '0'))
  )) || null;
}

export const CATEGORIES = [
  {
    key: 'PPKI', label: 'PPKI', mode: 'matrix', blocksCount: 1, active: true,
    columnsByLanguage: { SK: PPKI_LEVELS },
    subjectsByLanguage: { SK: SUBJECTS_CORE, SJKC: SUBJECTS_CORE_CN },
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    subjectsFromImport: SUBJECTS_FROM_IMPORT,
    // Each of the 3 levels (PRA PPKI/PPKI/PRASEKOLAH) can carry its own
    // Nama Kelas + Moral Kelas breakdown, same shape as the source Excel —
    // see computeBlocks.js's levelBreakdown / draftUpdaters.js's
    // onLevelKelasField family. A KUANTITI cell filled by hand (no
    // breakdown at all) is untouched; this only appears once a level
    // actually has one.
    hasLevelBreakdown: true,
  },
  {
    key: 'MP1', label: 'MP THP 1', mode: 'matrix', blocksCount: 1, active: true,
    columnsByLanguage: { SK: MP_THP1_LEVELS_MY, SJKC: MP_THP1_LEVELS_CN },
    subjectsByLanguage: { SK: SUBJECTS_CORE, SJKC: SUBJECTS_CORE_CN },
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    subjectsFromImport: SUBJECTS_FROM_IMPORT,
  },
  {
    // Its own separate category from MP1 above, even though it's the same
    // TAHUN 1/2/3 × subject matrix underneath — a school fills in ONE of
    // these two source sheets, never both, and keeping them as distinct
    // categories means whichever one a file actually used gets its own tab
    // rather than the two competing for one shared slot (see
    // excelImport.js's SOURCE_SHEET_TO_CATEGORY).
    key: 'MP1_KELAS', label: 'MP THP 1 (Kalau ada kelas)', mode: 'matrix', blocksCount: 1, active: true,
    columnsByLanguage: { SK: MP_THP1_LEVELS_MY, SJKC: MP_THP1_LEVELS_CN },
    subjectsByLanguage: { SK: SUBJECTS_CORE, SJKC: SUBJECTS_CORE_CN },
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    subjectsFromImport: SUBJECTS_FROM_IMPORT,
    // A per-Tahun Nama Kelas + Moral Kelas breakdown instead of typing each
    // Tahun's total straight in (see catalog.js's PPKI entry for the same
    // mechanism, computeBlocks.js's levelBreakdown).
    hasLevelBreakdown: true,
  },
  {
    key: 'MP2', label: 'MP THP 2', mode: 'matrix', blocksCount: 1, active: true,
    columnsByLanguage: { SK: CLASS_LEVELS_MY_UPPER, SJKC: CLASS_LEVELS_CN_UPPER },
    subjectsByLanguage: {
      SK: SUBJECTS_MP2,
      SJKC: SUBJECTS_MP2_CN,
    },
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    subjectsFromImport: SUBJECTS_FROM_IMPORT,
  },
  {
    // Its own separate category from MP2 above, same reasoning as MP1_KELAS
    // — a school fills in ONE of the two source sheets, never both.
    key: 'MP2_KELAS', label: 'MP THP 2 (Kalau ada kelas)', mode: 'matrix', blocksCount: 1, active: true,
    columnsByLanguage: { SK: CLASS_LEVELS_MY_UPPER, SJKC: CLASS_LEVELS_CN_UPPER },
    subjectsByLanguage: {
      SK: SUBJECTS_MP2,
      SJKC: SUBJECTS_MP2_CN,
    },
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    subjectsFromImport: SUBJECTS_FROM_IMPORT,
    hasLevelBreakdown: true,
  },
  {
    // PBD TERBAIK's real sheet has NO subject axis at all — just one
    // KUANTITI total per TAHUN 1-6, optionally broken down into a Nama
    // Kelas list per Tahun (no Moral Kelas). Modelled as a 1-column matrix
    // whose "subject" rows ARE the six Tahuns, so the display reads as six
    // vertical Tahun/QTY rows. `levelBreakdownAxis: 'subject'` tells
    // computeBlocks.js/draftUpdaters.js the breakdown levels are those
    // rows, not the (single) column.
    key: 'PBD', label: 'PBD TERBAIK', mode: 'matrix', blocksCount: 1, active: true,
    columnsByLanguage: { SK: ['KUANTITI'] },
    subjectsByLanguage: { SK: ALL_TAHUN },
    matrixRowLabel: 'Tahun',
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    hasLevelBreakdown: true,
    levelBreakdownAxis: 'subject',
    levelBreakdownNoMoral: true,
  },
  {
    // ALIRAN TERBAIK — six fixed TAHUN rows, each carrying a KEDUDUKAN
    // "hingga" place (DARI is always 1st): its QTY = that count (1st..Nth =
    // N plaques, one per place). A blank KEDUDUKAN + a typed QTY is a flat
    // "ikut sample, tukar TAHUN" count instead. Its own JENIS PLAK footer
    // maps position sub-ranges to plaque types, each footer row's QTY
    // derived by crossing its range with the TAHUNs that ordered it — but
    // the teacher can OVERRIDE that QTY (footer row's `qty`, computeBlocks
    // `qtyOverridden`) for the mixed ranked/flat cases the derivation can't
    // express, with a red "jumlah tak sama" warning if the footer total then
    // drifts from the TAHUN total. See excelImport.js's parseAliranSheet,
    // computeBlocks.js's ALIRAN handling, draftUpdaters.js's onAliran* family.
    key: 'ALIRAN', label: 'ALIRAN TERBAIK', mode: 'list', blocksCount: 1, active: true,
    rows: ALL_TAHUN,
    aliranKedudukan: true,
    descColumnLabel: 'Tahun',
    hideQtyLabelSuffix: true,
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
  },
  {
    // LONJAKAN SAUJANA — six fixed TAHUN rows, each with its OWN KUANTITI
    // and its OWN Jenis Plak (plakPerRow: one cart item per TAHUN row, no
    // single block-level Jenis Plak). Each plaque engraves ACARA + that
    // row's own TAHUN (positionFromRows + positionPrefixFromLine3,
    // exportCsv.js).
    key: 'LONJAKAN', label: 'LONJAKAN SAUJANA', mode: 'list', blocksCount: 1, active: true,
    rows: ALL_TAHUN,
    descColumnLabel: 'Tahun',
    hideQtyLabelSuffix: true,
    plakPerRow: true,
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    positionFromRows: true,
    positionPrefixFromLine3: true,
  },
  {
    // KEHADIRAN PENUH — same shape as LONJAKAN SAUJANA above.
    key: 'KEHADIRAN', label: 'KEHADIRAN PENUH', mode: 'list', blocksCount: 1, active: true,
    rows: ALL_TAHUN,
    descColumnLabel: 'Tahun',
    hideQtyLabelSuffix: true,
    plakPerRow: true,
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    positionFromRows: true,
    positionPrefixFromLine3: true,
  },
  {
    // TOKOH's own FORM ANUGERAH sheet — a per-honour list the teacher fills
    // straight from the sheet: TOKOH (award name, the engraved position) |
    // NAMA MURID | GAMBAR (yes/no) | KUANTITI | JENIS PLAK | DESIGN | HARGA.
    // Rows aren't a fixed preset (`rows` omitted) — they come from the
    // sheet on import (excelImport.js's parseTokohAnugerahSheet /
    // `isTokohList`) or the teacher adds them by hand. plakPerRow: each
    // honour row carries its own Jenis Plak + Harga (one cart item per
    // row), same as LONJAKAN. NAMA MURID / GAMBAR / DESIGN are per-row
    // metadata shown on the review table (tokohRowFields) — NAMA MURID and
    // GAMBAR sit before KUANTITI, DESIGN after JENIS PLAK, matching the
    // sheet's own column order. The per-plaque engraved position is just
    // the row's own TOKOH name (positionFromRows, no line-3 prefix).
    key: 'TOKOH_SHEET', label: 'TOKOH', mode: 'list', blocksCount: 1, active: true,
    descColumnLabel: 'TOKOH',
    hideQtyLabelSuffix: true,
    plakPerRow: true,
    tokohRowFields: true,
    linePlaceholders: STANDARD_REFERENCE_LINES,
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    requiredLineIndices: [0, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    positionFromRows: true,
  },
  {
    // SELEMPANG (sash) — ACARA / WARNA / KUANTITI rows, no engraving. Its
    // own `section: 'selempang'` puts it in the lower half of every order
    // view (anugerah on top). `noCsv` keeps it out of Production's CSV
    // export and manual-make lists — Production only needs to SEE that a
    // selempang order exists. Still priced (RM40 each) and stock-tracked
    // (one shared SELEMPANG pool), so it rides the normal cart / submit /
    // amount-guard / stock-deduct flow like any other line.
    key: 'SELEMPANG', label: 'Selempang', mode: 'list', blocksCount: 1, active: true,
    selempang: true,
    section: 'selempang',
    noCsv: true,
    hideQtyLabelSuffix: true,
    linePlaceholders: [],
  },
  {
    // Retired from new-order selection (active: false) — every FORM ANUGERAH
    // sheet now has its own dedicated category, so the generic "Main
    // Template" / "Mata Pelajaran / Klas" / "...(Matrix)" catch-alls are no
    // longer offered. Kept in CATEGORIES (not deleted) so existing orders
    // that used one still resolve everywhere else — same as the other
    // active:false entries.
    key: 'TOKOH', label: 'Main Template', mode: 'list', blocksCount: 1, active: false,
    // Line 3 is CONTOH-only (red, like OTHERS/LONJAKAN's own flexible
    // field). `rows` is deliberately omitted (like OTHERS below) — Main
    // Template no longer ships a fixed preset Description list; the
    // teacher types every Kuantiti row's Description themselves, starting
    // from one blank row (see formDefaults.js's buildInitialRowsByBlock).
    // defaultRowDescFromPosition seeds each newly-added row's Description
    // with "Row N" (still freely editable) so it visually lines up with
    // the correspondingly-numbered Reference Sample row; capRowsAt5 caps
    // both Kuantiti rows and Reference Sample lines at 5 total, per spec.
    // Matches Mata Pelajaran/Klas's own shape: TAJUK BESAR / YEAR / ACARA
    // as the three numbered lines, plus SUBJEK/POSITION as ACARA's own
    // "second box" (positionLine2Placeholder) — computeBlocks.js flattens
    // that into its own numbered row right after ACARA (num 4), and both
    // ACARA (index 2) and the SUBJEK/POSITION second box render red
    // automatically via the exact same positionFieldsRedText mechanism
    // OTHERS already uses below — no new logic needed for either.
    linePlaceholders: ['TAJUK BESAR', 'YEAR (KALAU YEAR SUDAH INCLUDE DI LINE 1 KOSONGKAN SAHAJA)', 'ACARA (PBD Terbaik/Mata Pelajaran Terbaik)'],
    positionLine2Placeholder: '( SUBJEK/POSITION )',
    // YEAR is starred (shown as important) but deliberately NOT required —
    // its own placeholder tells the teacher to leave it blank when the
    // year is already part of line 1, so Add to Cart must never block on
    // it being empty the way a genuinely required line does. ACARA is
    // both starred and required, matching Mata Pelajaran/Klas's own ACARA.
    requiredLineIndices: [0, 2],
    starredLineIndices: [0, 1, 2],
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    positionFromRows: true,
    extendableReferenceSample: true,
    capRowsAt5: true,
    defaultRowDescFromPosition: true,
    hideQtyLabelSuffix: true,
    // Kuantiti's Description column always corresponds to Reference
    // Sample's own row 4 (SUBJEK/POSITION, ACARA's second box — see
    // linePlaceholders/positionLine2Placeholder above) — this category's
    // positionFromRows already reads each Kuantiti row's `desc` as the
    // actual engraved position text, so the header spells that
    // relationship out for the teacher instead of a generic "Description".
    descColumnLabel: 'Row 4 Subjek/Position',
  },
  {
    key: 'OTHERS', label: 'Mata Pelajaran / Klas', mode: 'list', blocksCount: 200, active: false,
    // A catch-all for any award/plaque shape not covered by the 5 categories
    // above. Kuantiti is a per-Tahun "part": one TAHUN value (hasTahunField)
    // + a Description/QTY list (plain `rows`, same mechanism as
    // TOKOH/LONJAKAN — `rows` is deliberately omitted below so
    // formDefaults.js seeds one blank teacher-typed row instead of a fixed
    // preset list) + a separate Nama Kelas name list (hasNamaKelasList,
    // reusing dynamicMatrix's columnsByBlock storage with a simpler {id,
    // name} shape — see computeBlocks.js). Each Description row's QTY is
    // meant to equal the Nama Kelas count (one plaque per class) — computeBlocks
    // flags a mismatch for OrderCategoryBlock's red-bold warning and
    // AppState.jsx's addToCart guard. `blocksCount: 200` pre-allocates a
    // generous pool of blocks so "Duplicate" is never artificially capped
    // (only 1 is shown until the teacher clicks "Duplicate" to reveal the
    // next — see draftUpdaters.js's onDuplicateBlock and NewOrderStep2/
    // AddOn's visible-block slicing) — Duplicate copies only this block's
    // Kuantiti (TAHUN + rows + Nama Kelas) into the new one; Reference
    // Sample and Jenis Plak start blank there, same as any other new block.
    hasTahunField: true,
    hasNamaKelasList: true,
    // Block 0's Description/QTY rows start pre-filled with MP THP's own
    // 13-subject list (same SUBJECTS_CORE/SUBJECTS_CORE_CN used for
    // MP1/MP2's matrix rows above) instead of one blank teacher-typed row —
    // see formDefaults.js's buildInitialRowsByBlock (seedRowsFromSubjects,
    // block 0 only: every later block is populated by Duplicate copying
    // block 0's own rows forward, so seeding them independently would just
    // be immediately overwritten). Every row stays a normal editable/
    // removable row (`custom: true`, same as the old single blank row) —
    // the teacher can rename, remove, or add to this list freely; it's a
    // starting point, not a locked preset.
    subjectsByLanguage: { SK: SUBJECTS_CORE, SJKC: SUBJECTS_CORE_CN },
    seedRowsFromSubjects: true,
    // *ByLanguage — resolved per school via getCategoryTahunPlaceholder/
    // getCategoryLinePlaceholders/getCategoryPositionLine2Placeholder/
    // getCategoryNamaKelasPlaceholder above, same SK/SJKC fallback pattern
    // getCategorySubjects already uses for MP THP/PBD's subject names.
    // Every field here is teacher-typed free text already (no restriction
    // on what language they type), so this only affects which language
    // the field LABELS themselves show in — not what a school can enter.
    // No fixed "TAHUN:" label on this field (see OrderCategoryBlock.jsx) —
    // not every block is a Tahun grade (PRASEKOLAH/PPKI are common too), so
    // the teacher just types whatever should appear on the plaque for this
    // block, e.g. "TAHUN 1" or "PRASEKOLAH". Whether the exported text gets
    // a literal "TAHUN " prefix depends only on whether the teacher's own
    // Reference Sample row 5 text contains that word (see exportCsv.js's
    // buildOthersRows) — typing "PRASEKOLAH" here with that row left blank
    // exports as-is, with no prefix forced on.
    tahunPlaceholderByLanguage: { SK: 'e.g. TAHUN 1 / PRASEKOLAH / PPKI', SJKC: '例如 一年级 / 学前班 / PPKI' },
    namaKelasPlaceholderByLanguage: { SK: 'e.g. ADIF', SJKC: '例如 甲班' },
    // Line 3 (index 2) gets the same optional second box as MP THP/PBD —
    // box 1 is required, same as line 1 (see requiredLineIndices below);
    // what box 2 should ultimately reflect is still TBD (placeholder only
    // for now, and stays optional). Placeholders here are short field
    // labels (TAJUK BESAR/YEAR/ACARA/...) rather than the "e.g. ..."
    // worked examples every other category uses, since OTHERS has no
    // single representative example to show.
    linePlaceholdersByLanguage: {
      SK: ['TAJUK BESAR', 'YEAR (KALAU YEAR SUDAH INCLUDE DI LINE 1 KOSONGKAN SAHAJA)', 'ACARA', '( TAHUN ? )'],
      SJKC: ['大标题', '年份（如果第一行已包含年份，此栏留空即可）', '活动', '（年级？）'],
    },
    // Line 1 and ACARA (line 3's first box) are required, matching every
    // other category's own ACARA line. YEAR is starred but deliberately
    // NOT required — see TOKOH's own note above; its placeholder tells
    // the teacher to leave it blank when the year is already in line 1.
    // Note exportCsv.js's buildOthersRows still falls back to just each
    // Kuantiti row's own desc if ACARA somehow ends up blank on an older
    // order — this just stops a *new* order from being added to cart
    // that way.
    requiredLineIndices: [0, 2],
    starredLineIndices: [0, 1, 2],
    positionLine2PlaceholderByLanguage: { SK: '( SUBJEK/POSITION )', SJKC: '（科目/位置）' },
    // Line 3's two boxes (ACARA / SUBJEK-POSITION) render in red — a pale
    // tint for the placeholder, solid once the teacher actually types
    // something — see computeBlocks.js's `redText` and OrderCategoryBlock's
    // `.input-red` class (index.css).
    positionFieldsRedText: true,
    // Every order's plaque layout can differ (some need only TAJUK
    // BESAR/TAHUN/ACARA, others all five) — rather than a fixed catalog
    // order, the teacher can drag each numbered row into whatever position
    // matches their own plaque design, and Production follows that same
    // numbering on the artwork. This only reorders the DISPLAY/numbering —
    // see computeBlocks.js: each field's underlying key/meaning never
    // changes, so exportCsv.js needs no changes at all.
    draggableReferenceSample: true,
    // Same "+Add Reference Row" mechanism as TOKOH, but capped at 6 total
    // lines instead of TOKOH's 5 (maxReferenceLines, read by
    // computeBlocks.js/draftUpdaters.js instead of the generic 5-line
    // fallback) — an added row also grows the Kuantiti table below with a
    // matching "Row N" column (see OrderCategoryBlock.jsx's hasNamaKelasList
    // branch), same as TOKOH's own Kuantiti table already does.
    extendableReferenceSample: true,
    maxReferenceLines: 6,
    // Every row except TAJUK BESAR (always line 1) and the SUBJEK/POSITION
    // second box can be individually removed via its own "✕" (not just the
    // last-added extra row, unlike TOKOH) — see computeBlocks.js's
    // hiddenLines handling and draftUpdaters.js's onDeleteReferenceLine.
    deletableReferenceLines: true,
  },
  {
    // A separate category rather than changing OTHERS in place — same
    // Reference Sample shape (TAJUK BESAR/YEAR/ACARA/SUBJEK-POSITION/TAHUN,
    // draggable, 6-row cap, per-row delete) copied field-for-field from
    // OTHERS above, but Kuantiti is a subject-by-class MATRIX (mode:
    // 'dynamicMatrix', reusing PBD TERBAIK/ALIRAN TERBAIK's own matrix
    // machinery wholesale — computeBlocks.js/OrderCategoryBlock.jsx/
    // exportCsv.js's buildPbdMatrixRows already handle this generically for
    // any dynamicMatrix category, not just PBD) instead of OTHERS' flat
    // Description/QTY list + separate Nama Kelas list. Solves OTHERS' "one
    // QTY number per subject, split evenly across however many classes are
    // filled in" limitation — a subject-class matrix lets every (subject,
    // class) pair carry its own independent quantity (e.g. Class A needs 5
    // of a subject, Class B only needs 2), which a single shared number per
    // subject can never represent. Each class row already carries its own
    // Tahun range + Nama Kelas (same shape PBD/ALIRAN use), so there's no
    // separate Duplicate-per-Tahun mechanism needed here — one block, add as
    // many class rows as needed via "+ Add Tahun"/"+ Add Kelas".
    // `blocksCount: 200` + `multiBlock: true`: a teacher can "Duplicate" into
    // an independent extra section — unlike OTHERS' own Duplicate (which
    // shares ONE Reference Sample/Jenis Plak across every section, since
    // OTHERS' sections are just different Tahun parts of the SAME event),
    // KLAS_MATRIX's Reference Sample and Jenis Plak are already independent
    // per block (see plakPerBlock below, and OrderCategoryBlock.jsx's
    // showSharedSections, which only ever hides them for hasNamaKelasList
    // categories — KLAS_MATRIX isn't one) — so each duplicated section can
    // be a genuinely different award (own title/ACARA, own Jenis Plak), the
    // shape real multi-award Excel/Word imports need (see excelImport.js/
    // docxImport.js). There's no way to make this genuinely unlimited —
    // computeBlocks.js builds every one of a category's `blocksCount` slots
    // on every render regardless of how many are actually revealed, so the
    // number is a real (if generous) ceiling, not just a display cap;
    // matches OTHERS' own already-proven-fine 200 above.
    key: 'KLAS_MATRIX', label: 'Mata Pelajaran / Klas (Matrix)', mode: 'dynamicMatrix', blocksCount: 200, multiBlock: true, active: false,
    // Seeded with the same 13-subject list as OTHERS (editableDefaultSubjects
    // — unlike PBD/ALIRAN's own locked `custom: false` seed, see
    // formDefaults.js/AppState.jsx's resetCategoryFields) so the teacher can
    // rename/remove/add subjects freely, matching OTHERS' own behavior.
    subjectsByLanguage: { SK: SUBJECTS_CORE, SJKC: SUBJECTS_CORE_CN },
    editableDefaultSubjects: true,
    qtyColumnLabels: ['KUANTITI'],
    // Jenis Plak renders above this category's own matrix table (not the
    // single shared top-of-page table PBD/ALIRAN use) and its total
    // QTY/Harga render at the bottom of that same table — same "moved
    // closer to the Kuantiti it belongs to" layout as OTHERS' own
    // hasNamaKelasList branch, just for the matrix branch instead (see
    // OrderCategoryBlock.jsx). PBD/ALIRAN are untouched, both retired
    // (`active: false`) legacy categories that were never asked to change.
    plakPerBlock: true,
    linePlaceholdersByLanguage: {
      SK: ['TAJUK BESAR', 'YEAR (KALAU YEAR SUDAH INCLUDE DI LINE 1 KOSONGKAN SAHAJA)', 'ACARA', '( TAHUN ? )'],
      SJKC: ['大标题', '年份（如果第一行已包含年份，此栏留空即可）', '活动', '（年级？）'],
    },
    requiredLineIndices: [0, 2],
    starredLineIndices: [0, 1, 2],
    positionLine2PlaceholderByLanguage: { SK: '( SUBJEK/POSITION )', SJKC: '（科目/位置）' },
    positionFieldsRedText: true,
    draggableReferenceSample: true,
    extendableReferenceSample: true,
    maxReferenceLines: 6,
    deletableReferenceLines: true,
  },
];

// New order/add-on category pickers (NewOrderStep2.jsx, AddOn.jsx) only
// ever offer these — TOKOH ("Main Template"), OTHERS ("Mata Pelajaran /
// Klas") and KLAS_MATRIX ("...(Matrix)") are retired from new selection
// (`active: false` above), now that every FORM ANUGERAH sheet has its own
// dedicated category — but deliberately kept in CATEGORIES itself so every
// existing order that already used one still resolves correctly everywhere
// else (reconstructBlocksForCategory, exportCsv's getOrderCategories,
// print/production/admin pages) — those all read the full CATEGORIES list,
// unfiltered.
export const ACTIVE_CATEGORIES = CATEGORIES.filter((c) => c.active !== false);

// Production splits each order by Jenis Plak — one physical Adobe
// Illustrator file per Jenis Plak. When a Jenis Plak's TOTAL quantity
// across the whole order is this small, hand-typing the few plaques
// straight into Illustrator is faster than exporting a CSV and importing
// it, so Production is told to "BUAT MANUAL" instead of getting an export
// button. Aggregate per Jenis Plak (matching the school's own FRONT PG
// grand totals), not per order line. `qty <= MANUAL_MAX_QTY` → manual;
// `qty >= MANUAL_MAX_QTY + 1` → CSV. See getPlakProductionMode in
// src/utils/exportCsv.js.
export const MANUAL_MAX_QTY = 10;

// A teacher-typed catch-all pick (PlakPicker.jsx's "OTHER" leaf, committed
// as "OTHER - <whatever the teacher typed>") is never a real catalog path,
// so it can't resolve to a plak_catalog_nodes row at all — stock tracking
// simply doesn't apply to it, same as a code with stockQty left null.
// Filtered out of every stock deduct/restore payload in catalogAdminApi.js
// (calling plak_stock_deduct with an unresolvable path raises "Unknown
// Jenis Plak code" — see supabase/migrations/0032_add_plak_stock.sql).
export function isCustomPlakCode(code) {
  return /^OTHERS?\s*-/i.test((code || '').trim());
}

// The Jenis Plak catalog now lives in Supabase (plak_catalog_nodes —
// see supabase/migrations/0006_catalog_admin.sql) so Production can add,
// remove, edit prices, and hide/unhide codes live, without a code deploy.
// AppState fetches the flat rows and rebuilds this same tree shape client
// side: a leaf (no `children`) is a directly selectable code; a node with
// `children` is a group you drill into. Each node's own `price` (default
// 0) is additive down the path to whichever leaf is finally picked — e.g.
// SM-13187 (RM6) → GOLD (RM0) → BASE A (RM6) prices at RM12. Everything
// below operates on that tree, whatever its current shape.

// Flattens the tree into { code: fullPathString, price: totalPrice } for
// every leaf — fullPathString (joined with " / ") is exactly what gets
// stored as an order line's jenisPlak once a teacher finishes picking down
// a path, so this is also the lookup table standardUnitPrice searches.
export function flattenPlakCatalog(nodes, prefix = [], priceSoFar = 0) {
  return (nodes || []).flatMap((node) => {
    const path = [...prefix, node.code];
    const total = priceSoFar + (Number(node.price) || 0);
    if (!node.children || node.children.length === 0) {
      return [{
        code: path.join(' / '), price: total,
        stockQty: node.stockQty ?? null, stockBaseline: node.stockBaseline ?? null,
      }];
    }
    return flattenPlakCatalog(node.children, path, total);
  });
}

// Shared by getStockStatus below (teacher-facing, looks a leaf up by its
// full path) and the catalog admin pages (already holding the node
// object directly, no path lookup needed) — one formula so the colour
// shown to Production/Admin and the cap enforced on teachers can never
// drift apart.
export function stockZoneFor(stockQty, stockBaseline) {
  if (stockQty == null) return 'normal';
  if (stockBaseline > 0) {
    const lowThreshold = stockBaseline * 0.15;
    const highThreshold = stockBaseline * 0.25;
    if (stockQty <= lowThreshold) return 'red';
    if (stockQty <= highThreshold) return 'orange';
  }
  return 'normal';
}

// Stock status for one leaf code (its full " / "-joined path) — the single
// source of truth both the teacher-facing qty warning (OrderCategoryBlock)
// and the Cart/AddOnSummary submit guard read, so they can never disagree
// about where the line is. The server-side plak_stock_deduct function
// (supabase/migrations/0032_add_plak_stock.sql) enforces the same formula
// atomically at submit time — this is only a live preview against
// whatever catalog snapshot the client last fetched.
//
// Returns null when stock isn't tracked for this code (stockQty is null —
// e.g. Production hasn't entered a count yet) or the code isn't found, in
// which case no stock UI/limit applies at all.
export function getStockStatus(code, plakCatalogTree) {
  const entry = flattenPlakCatalog(plakCatalogTree).find((p) => p.code === code);
  if (!entry || entry.stockQty == null) return null;
  const { stockQty, stockBaseline } = entry;
  const zone = stockZoneFor(stockQty, stockBaseline);
  let maxOrderable = stockQty;
  if (zone === 'red') {
    const reserve = Math.ceil(stockBaseline * 0.15 * 0.10);
    maxOrderable = Math.max(stockQty - reserve, 0);
  }
  return { stockQty, stockBaseline, zone, maxOrderable };
}

// Standard list price for a plaque code (its full " / "-joined path) —
// the baseline Sales compares an order's (possibly negotiated) unit price
// against to flag a discount/markup. Takes the live catalog tree since
// prices are Production-editable, not fixed at build time.
export function standardUnitPrice(code, plakCatalogTree) {
  const entry = flattenPlakCatalog(plakCatalogTree).find((p) => p.code === code);
  return entry ? entry.price : null;
}

// Prunes any node marked `hidden` (Production, out of stock) — hiding a
// whole code or just one branch inside it both work, since this checks
// every node at every depth. If hiding leaves a group with no selectable
// variants left, the group itself is dropped too rather than left as a
// bogus empty leaf. Only used for the teacher-facing picker — Production's
// own catalog admin view renders the raw, unfiltered tree.
export function filterHiddenPlakCatalog(nodes) {
  return (nodes || []).flatMap((node) => {
    if (node.hidden) return [];
    const hadChildren = Array.isArray(node.children) && node.children.length > 0;
    if (!hadChildren) {
      // stockQty === 0 (not null — null means stock isn't tracked for this
      // code) auto-hides it from teachers the moment it sells out, same as
      // Production manually flipping `hidden`. It naturally reappears once
      // restocked since this is computed live, not a stored flag.
      if (node.stockQty === 0) return [];
      return [node];
    }
    const children = filterHiddenPlakCatalog(node.children);
    if (children.length === 0) return [];
    return [{ ...node, children }];
  });
}

// 'Shipped' and 'Completed' are both reached purely from the calendar, not
// a button: the day an order's Shipment Date (order.dueDate) arrives it
// becomes 'Shipped', and the day after it becomes 'Completed'. Production's
// "Mark as Done" (markProductionDone in src/state/AppState.jsx) applies the
// same rule at click time, and a daily job (sweep_shipped_orders, see
// supabase/migrations/0056) advances orders already past those dates.
export const STATUS_STAGES = [
  'Submitted to Sales', 'In Production', 'Waiting for Delivery', 'Shipped', 'Completed',
];

// 'Cancelled' is a terminal OFF-RAMP, not a pipeline stage — kept out of
// STATUS_STAGES (which drives the progress steppers and the
// stage-tab dashboards) but included here for status filter dropdowns.
export const ORDER_STATUSES = [...STATUS_STAGES, 'Cancelled'];

export const STATUS_BG = ['#e4ecf2', '#5980a6', '#2f5878', '#2f6b4f', '#1d1f20'];
export const STATUS_TEXT = ['#1d1f20', '#fff', '#fff', '#fff', '#fff'];

// Inline style object for an order-status pill. Handles the pipeline
// stages plus 'Cancelled' (STATUS_STAGES.indexOf returns -1 for it, which
// would otherwise render a pill with no background). Every status pill in
// the app goes through this so the fallback/`Cancelled` styling can't drift.
export function statusPillStyle(status) {
  if (status === 'Cancelled') return { background: '#e7d3d0', color: '#7a2f27' };
  const i = STATUS_STAGES.indexOf(status);
  return { background: STATUS_BG[i] ?? '#e4ecf2', color: STATUS_TEXT[i] ?? '#1d1f20' };
}

export function formatDate(d) {
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export function addDays(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

// The calendar-driven part of the pipeline. Given an order's Shipment Date
// (order.dueDate, stored as an ISO string) and today, returns which of the
// three post-production stages the order belongs in:
//   Shipment Date in the future -> 'Waiting for Delivery'
//   Shipment Date is today       -> 'Shipped'
//   Shipment Date has passed     -> 'Completed'
// Kept in one place so markProductionDone (the "Mark as Done" click) and
// the daily sweep_shipped_orders job (supabase/migrations/0056) can't drift
// apart. A missing/unparseable date falls back to 'Waiting for Delivery' —
// nothing should auto-ship an order with no real Shipment Date on record.
export function deliveryStageForShipmentDate(dueDate, today) {
  if (!dueDate) return 'Waiting for Delivery';
  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) return 'Waiting for Delivery';
  const ship = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (ship > now) return 'Waiting for Delivery';
  if (ship.getTime() === now.getTime()) return 'Shipped';
  return 'Completed';
}

// Formats an ISO timestamp (e.g. orders.printed_at) in Malaysia time
// regardless of the viewing device's own timezone/locale, so "Order
// Printed" always reads the same no matter who opens the printout.
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}
