export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const SALES_NAMES = [
  'Guoh', 'Fatt', 'Joyce', 'Bong', 'Wendy', 'Harriet', 'Kent', 'Maggie',
  'Keith', 'Foo', 'Adam', 'Rex', 'CY', 'Fidah', 'Ikmal', 'Aina', 'Nazrin',
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

// Some codes (SM-13187, SM-13230, and each Eastern Trophy model) share the
// exact same GOLD/SILVER/BRONZE → BASE A/B/C addon structure, only the base
// code's own price differs — factored out so the four copies can't drift.
function colorBaseVariants() {
  const bases = [
    { code: 'BASE A', price: 6 },
    { code: 'BASE B', price: 5 },
    { code: 'BASE C', price: 4 },
  ];
  return ['GOLD', 'SILVER', 'BRONZE'].map((color) => ({ code: color, children: bases }));
}

// The Jenis Plak catalog, as a tree: a leaf (no `children`) is a directly
// selectable code; a node with `children` is a group you drill into. Each
// node's own `price` (default 0) is additive down the path to whichever leaf
// is finally picked — e.g. SM-13187 (RM6) → GOLD (RM0) → BASE A (RM6) prices
// at RM12. This lets one shape cover flat codes (57166 A), sibling variants
// with their own absolute price (CPH's A/B/C), and base-price-plus-addon
// codes (SM-13187, Eastern Trophy) without special-casing any of them.
export const PLAK_CATALOG = [
  { code: 'CPH', children: [{ code: 'A', price: 7.50 }, { code: 'B', price: 7.50 }, { code: 'C', price: 7.50 }] },
  { code: 'VB', children: [{ code: 'A', price: 65 }, { code: 'B', price: 60 }, { code: 'C', price: 50 }, { code: 'D', price: 45 }] },
  { code: 'SONGKET', children: [{ code: 'A', price: 75 }, { code: 'B', price: 70 }, { code: 'C', price: 65 }] },
  { code: '57166 A', price: 85 },
  { code: 'DECO LIGHT', price: 20 },
  { code: 'CRYSTAL MEDAL', price: 15 },
  { code: 'SOLID GOLD', children: [{ code: '4942', price: 59 }, { code: '4943', price: 59 }] },
  { code: 'FD 251', price: 6.50 },
  { code: '18059', price: 6 },
  { code: 'SM-13187', price: 6, children: colorBaseVariants() },
  { code: 'SM-13230', price: 6, children: colorBaseVariants() },
  {
    code: 'EASTERN TROPHY',
    children: [
      { code: 'MP393', price: 6, children: colorBaseVariants() },
      { code: 'MP399', price: 6, children: colorBaseVariants() },
    ],
  },
  { code: '13228', price: 16 },
  { code: 'JZ 19821', price: 19 },
  { code: 'H25', price: 19 },
  { code: 'YK', children: [{ code: '628', price: 25 }, { code: '1370', price: 33 }] },
  { code: 'W038', children: [{ code: 'A', price: 33 }, { code: 'B', price: 29 }, { code: 'C', price: 27 }] },
  { code: 'SR-116 A', price: 34 },
  { code: 'SL245#3', price: 42 },
  { code: 'SL243#3', price: 45 },
  { code: 'TSL232#3', price: 45 },
  {
    code: 'CRYSTAL',
    children: [
      { code: '80-B', price: 15, children: [{ code: 'DESIGN 1' }, { code: 'DESIGN 2' }, { code: 'DESIGN 3' }] },
      { code: 'R-100', price: 19, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: '10030', price: 29, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: 'AK-7', price: 39, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: '00S', price: 39, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: '0011A', price: 39, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: 'SA4', price: 45, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: 'R-7', price: 49, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: 'CA-15', price: 59, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: 'PSA-3', price: 59, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: 'CM-27', price: 62, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: '11-3', price: 72, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: '0171', price: 82, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
      { code: 'XB-5A', price: 89, children: [{ code: 'DESIGN A' }, { code: 'DESIGN B' }, { code: 'DESIGN C' }] },
    ],
  },
];

// Flattens the tree into { code: fullPathString, price: totalPrice } for
// every leaf — fullPathString (joined with " / ") is exactly what gets
// stored as an order line's jenisPlak once a teacher finishes picking down
// a path, so this is also the lookup table standardUnitPrice searches.
function flattenPlakCatalog(nodes, prefix = [], priceSoFar = 0) {
  return nodes.flatMap((node) => {
    const path = [...prefix, node.code];
    const total = priceSoFar + (node.price || 0);
    if (!node.children || node.children.length === 0) {
      return [{ code: path.join(' / '), price: total }];
    }
    return flattenPlakCatalog(node.children, path, total);
  });
}

const PLAK_PRICES = flattenPlakCatalog(PLAK_CATALOG);

// Standard list price for a plaque code (its full " / "-joined path) — the
// baseline Sales compares an order's (possibly negotiated) unit price
// against to flag a discount/markup.
export function standardUnitPrice(code) {
  const entry = PLAK_PRICES.find((p) => p.code === code);
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

export function addDays(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}
