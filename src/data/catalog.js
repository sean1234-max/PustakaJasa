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

export const CATEGORIES = [
  {
    key: 'MP1', label: 'MP THP 1', mode: 'matrix', blocksCount: 1,
    columns: ['PPKI', 'PRASEKOLAH', 'TAHUN 1', 'TAHUN 2', 'TAHUN 3'],
    subjects: SUBJECTS_CORE,
    // Line 3 (index 2) is "position" — rendered as two stacked boxes (both
    // numbered "3") so the teacher doesn't need to know to press Enter to
    // split it; see OrderCategoryBlock's secondLine rendering. Combined with
    // a line break when exported.
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID',
      'e.g. 2025',
      'e.g. TERBAIK MATA PELAJARAN',
      'e.g. TAHUN 1',
    ],
    positionLine2Placeholder: 'e.g. BAHASA MELAYU',
  },
  {
    key: 'MP2', label: 'MP THP 2', mode: 'matrix', blocksCount: 1,
    columns: ['TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
    subjects: [...SUBJECTS_CORE, 'SEJARAH', 'REKA BENTUK & TEKNOLOGI'],
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID',
      'e.g. 2025',
      'e.g. TERBAIK MATA PELAJARAN',
      'e.g. TAHUN 4',
    ],
    positionLine2Placeholder: 'e.g. MATEMATIK',
  },
  {
    key: 'PBD', label: 'PBD', mode: 'list', blocksCount: 2,
    rows: ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
    // Lines 1-3 (header/year/position) are fixed as typed — only line 4
    // (event_line_1) is a CONTOH: the real value is each quantity-table
    // row's own description (TAHUN 1..6), see exportCsv.js.
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID',
      'e.g. 2025',
      'e.g. ANUGERAH KECEMERLANGAN PBD',
      'e.g. TAHUN 1 ADIL',
    ],
    positionLine2Placeholder: '(pilihan) sambung baris ke-2',
    eventLine1FromRows: true,
    variantLabels: ['PBD — Mengikut Kuantiti', 'PBD — Mengikut Kedudukan'],
    qtyColumnLabels: ['KUANTITI', 'KEDUDUKAN'],
  },
  {
    key: 'LONJAKAN', label: 'LONJAKAN SAUJANA', mode: 'list', blocksCount: 1,
    rows: ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
    // No 4th line — like TOKOH, the quantity table only has one axis
    // (TAHUN), so there's no second axis to source an event_line_1 from.
    // "position" (index 2) is a CONTOH only — the real per-plaque position
    // is each row's own description (TAHUN 1..6), see exportCsv.js.
    linePlaceholders: [
      'e.g. HARI ANUGERAH LONJAKAN SAUJANA',
      'e.g. 2026',
      'e.g. TAHUN 1',
    ],
    positionFromRows: true,
  },
  {
    key: 'TOKOH', label: 'TOKOH', mode: 'list', blocksCount: 1,
    rows: ['TOKOH MURID', 'TOKOH NILAM', 'TOKOH KURIKULUM', 'TOKOH KOKURIKULUM', 'TOKOH AKADEMIK'],
    // No 4th line for TOKOH — "position" (index 2) is its last line, and is
    // itself only a CONTOH — the real per-plaque position is each row's own
    // description (TOKOH MURID, TOKOH NILAM, ...), see exportCsv.js.
    linePlaceholders: [
      'e.g. HARI ANUGERAH TOKOH',
      'e.g. 2026',
      'e.g. TOKOH AKADEMIK',
    ],
    positionFromRows: true,
  },
];

export const PLAK_CATALOG = [
  { code: 'SM-134624 (GOLD)', price: 6.20 },
  { code: 'SM-13473 (SILVER)', price: 4.80 },
  { code: 'SM-138812 (BRONZE)', price: 3.90 },
];

// Standard list price for a plaque code — the baseline Sales compares an
// order's (possibly negotiated) unit price against to flag a discount/markup.
export function standardUnitPrice(code) {
  const entry = PLAK_CATALOG.find((p) => p.code === code);
  return entry ? entry.price : null;
}

export const STATUS_STAGES = [
  'Submitted to Sales', 'In Production', 'Out for Delivery', 'Completed',
];

export const STATUS_BG = ['#e4ecf2', '#5980a6', '#2f5878', '#1d1f20'];
export const STATUS_TEXT = ['#1d1f20', '#fff', '#fff', '#fff'];

export function formatDate(d) {
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}
