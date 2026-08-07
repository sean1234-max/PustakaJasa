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
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID 2025',
      'e.g. TERBAIK MATA PELAJARAN',
      'e.g. BAHASA MELAYU',
      'e.g. TAHUN 1',
    ],
  },
  {
    key: 'MP2', label: 'MP THP 2', mode: 'matrix', blocksCount: 1,
    columns: ['TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
    subjects: [...SUBJECTS_CORE, 'SEJARAH', 'REKA BENTUK & TEKNOLOGI'],
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID 2025',
      'e.g. TERBAIK MATA PELAJARAN',
      'e.g. MATEMATIK',
      'e.g. TAHUN 4',
    ],
  },
  {
    key: 'PBD', label: 'PBD', mode: 'list', blocksCount: 2,
    rows: ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID 2025',
      'e.g. ANUGERAH KECEMERLANGAN PBD',
      'e.g. TAHUN 1 ADIL',
    ],
    variantLabels: ['PBD — Mengikut Kuantiti', 'PBD — Mengikut Kedudukan'],
    qtyColumnLabels: ['KUANTITI', 'KEDUDUKAN'],
  },
  {
    key: 'LONJAKAN', label: 'LONJAKAN SAUJANA', mode: 'list', blocksCount: 1,
    rows: ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
    linePlaceholders: [
      'e.g. HARI ANUGERAH LONJAKAN SAUJANA',
      'e.g. TAHUN 1',
      'e.g. KEDUDUKAN PERTAMA',
    ],
  },
  {
    key: 'TOKOH', label: 'TOKOH', mode: 'list', blocksCount: 1,
    rows: ['TOKOH MURID', 'TOKOH NILAM', 'TOKOH KURIKULUM', 'TOKOH KOKURIKULUM', 'TOKOH AKADEMIK'],
    linePlaceholders: [
      'e.g. HARI ANUGERAH TOKOH 2026',
      'e.g. TOKOH AKADEMIK',
    ],
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
  'Submitted to Sales', 'Sales Approved', 'In Production', 'Out for Delivery', 'Completed',
];

export const STATUS_BG = ['#e4ecf2', '#c3d5e3', '#5980a6', '#2f5878', '#1d1f20'];
export const STATUS_TEXT = ['#1d1f20', '#1d1f20', '#fff', '#fff', '#fff'];

export function formatDate(d) {
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}
