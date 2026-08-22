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
const CUSTOM_MATRIX_LABEL_SUFFIX = '::__label__';
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
    // Line 3 ("LONJAKAN SAUJANA") is fixed/typed, same as PBD's line 3 —
    // it prefixes the engraved position (see positionPrefixFromLine3 in
    // exportCsv.js). Line 4 ("TAHUN 1") is a CONTOH only — the real
    // per-plaque position is each row's own description (TAHUN 1..6),
    // appended after line 3, see exportCsv.js.
    linePlaceholders: [
      'e.g. HARI ANUGERAH LONJAKAN SAUJANA',
      'e.g. 2026',
      'e.g. LONJAKAN SAUJANA',
      'e.g. TAHUN 1',
    ],
    positionFromRows: true,
    positionPrefixFromLine3: true,
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
  {
    key: 'OTHERS', label: 'LAIN-LAIN (OTHERS)', mode: 'list', blocksCount: 6,
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
    // AppState.jsx's addToCart guard. `blocksCount: 6` pre-allocates one
    // block per Malaysian primary grade (TAHUN 1-6); only 1 is shown until
    // the teacher clicks "Duplicate" to reveal the next (see
    // draftUpdaters.js's onDuplicateBlock and NewOrderStep2/AddOn's visible-
    // block slicing) — Duplicate copies only this block's Kuantiti (TAHUN +
    // rows + Nama Kelas) into the new one; Reference Sample and Jenis Plak
    // start blank there, same as any other new block.
    hasTahunField: true,
    hasNamaKelasList: true,
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
      SK: ['TAJUK BESAR', 'YEAR', 'ACARA', '( TAHUN ? )'],
      SJKC: ['大标题', '年份', '活动', '（年级？）'],
    },
    // Line 1 is always required for every category (computeBlocks.js
    // defaults to [0]) — OTHERS additionally requires line 3's first box
    // (index 2), since that's the fixed-wording award text every plaque
    // needs regardless of category. Drives both the ★ marker in
    // OrderCategoryBlock and the addToCart validation in AppState.jsx.
    requiredLineIndices: [0, 2],
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
  { id: 'sample-OTHERS-0', label: 'Lain-lain (Others)' },
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
