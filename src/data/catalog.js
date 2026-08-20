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

// Same TODO applies: class-level labels for the MP THP 1/2 matrix columns,
// only PPKI kept untranslated (national programme name, used as-is).
const CLASS_LEVELS_MY = ['PPKI', 'PRASEKOLAH', 'TAHUN 1', 'TAHUN 2', 'TAHUN 3'];
const CLASS_LEVELS_MY_UPPER = ['TAHUN 4', 'TAHUN 5', 'TAHUN 6'];
const CLASS_LEVELS_CN = ['PPKI', '学前班', '一年级', '二年级', '三年级'];
const CLASS_LEVELS_CN_UPPER = ['四年级', '五年级', '六年级'];

// Shared by both PBD TERBAIK and ALIRAN TERBAIK below (same subject list,
// only "Kuantiti" vs "Kedudukan" differs between them).
const SUBJECTS_PBD = {
  SK: [
    'BAHASA MELAYU', 'BAHASA INGGERIS', 'MATEMATIK', 'SAINS', 'PENDIDIKAN ISLAM',
    'BAHASA ARAB', 'PENDIDIKAN SENI VISUAL', 'SEJARAH', 'REKA BENTUK & TEKNOLOGI',
    'PENDIDIKAN JASMANI', 'PENDIDIKAN KESIHATAN', 'PENDIDIKAN MUZIK', 'PENDIDIKAN MORAL',
  ],
  SJKC: [
    '国语', '英语', '数学', '科学', '伊斯兰教育',
    '阿拉伯语', '视觉艺术教育', '历史', '设计与工艺',
    '体育教育', '健康教育', '音乐教育', '道德教育',
  ],
};

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

export const CATEGORIES = [
  {
    key: 'MP1', label: 'MP THP 1', mode: 'matrix', blocksCount: 1,
    columnsByLanguage: { SK: CLASS_LEVELS_MY, SJKC: CLASS_LEVELS_CN },
    subjectsByLanguage: { SK: SUBJECTS_CORE, SJKC: SUBJECTS_CORE_CN },
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
    columnsByLanguage: { SK: CLASS_LEVELS_MY_UPPER, SJKC: CLASS_LEVELS_CN_UPPER },
    subjectsByLanguage: {
      SK: [...SUBJECTS_CORE, 'SEJARAH', 'REKA BENTUK & TEKNOLOGI'],
      SJKC: [...SUBJECTS_CORE_CN, '历史', '设计与工艺'],
    },
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID',
      'e.g. 2025',
      'e.g. TERBAIK MATA PELAJARAN',
      'e.g. TAHUN 4',
    ],
    positionLine2Placeholder: 'e.g. MATEMATIK',
  },
  {
    key: 'PBD', label: 'PBD TERBAIK', mode: 'dynamicMatrix', blocksCount: 1,
    // Subject columns are seeded from this list (editable per-order: teachers
    // can add extra custom subject columns on top, but can't rename/remove
    // these 13 — see computeBlocks.js/formDefaults.js). Rows (Tahun + Nama
    // Kelas) are entirely teacher-defined per order, unlike MP THP's fixed
    // columnsByLanguage, so PBD TERBAIK has no columnsByLanguage at all.
    subjectsByLanguage: SUBJECTS_PBD,
    // Line 3's second box is a CONTOH only (like MP THP) — the real value
    // is each matrix column's own subject, see exportCsv.js buildPbdMatrixRows.
    // Unlike MP THP's single fixed subject, PBD has up to 13+ subjects per
    // order, so forcing a teacher to type one example subject name here adds
    // friction without adding real data — the "(pilihan)" prefix opts this
    // field out of AppState.jsx's addToCart "engaged" reference-line
    // requirement (see secondLineRequired there). The year line (index 1)
    // carries the same "(pilihan)" prefix on its own placeholder so it's
    // likewise optional (see linePlaceholderOptional in AppState.jsx).
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID',
      '(pilihan) e.g. 2025',
      'e.g. ANUGERAH KECEMERLANGAN PBD',
      'e.g. TAHUN 1 ADIL',
    ],
    positionLine2Placeholder: '(pilihan) e.g. BAHASA MELAYU',
    qtyColumnLabels: ['KUANTITI'],
  },
  {
    key: 'ALIRAN', label: 'ALIRAN TERBAIK', mode: 'dynamicMatrix', blocksCount: 1,
    // Same shape as PBD TERBAIK above, just "Kedudukan" (ranking) instead of
    // "Kuantiti" (count) — used to be the same PBD category's second variant,
    // split into its own tab so there's no variant dropdown to pick between.
    subjectsByLanguage: SUBJECTS_PBD,
    linePlaceholders: [
      'e.g. HARI ANUGERAH KECEMERLANGAN MURID',
      '(pilihan) e.g. 2025',
      'e.g. ANUGERAH KECEMERLANGAN PBD',
      'e.g. TAHUN 1 ADIL',
    ],
    positionLine2Placeholder: '(pilihan) e.g. BAHASA MELAYU',
    qtyColumnLabels: ['KEDUDUKAN'],
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
  { id: 'sample-PBD-0', label: 'PBD Terbaik' },
  { id: 'sample-ALIRAN-0', label: 'Aliran Terbaik' },
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
  'Submitted to Sales', 'In Production', 'Waiting for Delivery', 'Completed',
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
