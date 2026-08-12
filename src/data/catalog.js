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
      return [{ code: path.join(' / '), price: total }];
    }
    return flattenPlakCatalog(node.children, path, total);
  });
}

// Standard list price for a plaque code (its full " / "-joined path) —
// the baseline Sales compares an order's (possibly negotiated) unit price
// against to flag a discount/markup. Takes the live catalog tree since
// prices are Production-editable, not fixed at build time.
export function standardUnitPrice(code, plakCatalogTree) {
  const entry = flattenPlakCatalog(plakCatalogTree).find((p) => p.code === code);
  return entry ? entry.price : null;
}

// One reference-sample image slot per category (+ PBD variant), keyed by
// the exact sampleSlotId computeBlocks.js generates (`sample-${catKey}-${b}`)
// — Production manages these directly by slot, teachers only ever see them.
export const REFERENCE_IMAGE_SLOTS = [
  { id: 'sample-MP1-0', label: 'MP THP 1' },
  { id: 'sample-MP2-0', label: 'MP THP 2' },
  { id: 'sample-PBD-0', label: 'PBD — Mengikut Kuantiti' },
  { id: 'sample-PBD-1', label: 'PBD — Mengikut Kedudukan' },
  { id: 'sample-LONJAKAN-0', label: 'Lonjakan Saujana' },
  { id: 'sample-TOKOH-0', label: 'Tokoh' },
];

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
    if (!hadChildren) return [node];
    const children = filterHiddenPlakCatalog(node.children);
    if (children.length === 0) return [];
    return [{ ...node, children }];
  });
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
