import {
  CATEGORIES, getCategorySubjects, getCategoryColumns, tahunRangeYears,
  getCustomMatrixRowIds, customMatrixLabelKey, customMatrixCellKey,
} from '../data/catalog';

export const CSV_COLUMNS = ['event_header', 'year', 'position', 'event_line_1', 'event_line_2'];

// Categories actually present in this order's items, in catalog order —
// gives Production stable, ordered tabs even for orders with legacy items
// that never got a categoryKey (those are simply excluded).
export function getOrderCategories(order) {
  return CATEGORIES.filter((cat) => (order.items || []).some((it) => it.categoryKey === cat.key));
}

// Reads one reference-sample line (index 0-3) straight by key — the
// Reference Sample section is a CONTOH (layout/sizing sample), so most of
// these are literal fixed text as typed, except where noted in
// buildMatrixRows below.
function getLine(item, lineIndex) {
  const key = `${item.categoryKey}::${item.blockIdx}::${lineIndex}`;
  return item.detail?.lines?.[key] || '';
}

function getPositionLine2(item) {
  const key = `${item.categoryKey}::${item.blockIdx}::2b`;
  return item.detail?.lines?.[key] || '';
}

// Matrix categories (MP THP 1/2): the reference sample's second position
// box and 4th line are only a CONTOH of layout — the real per-plaque data
// comes from the quantity matrix itself. Each (subject, column) cell with
// qty > 0 becomes its own row: subject fills in for the sample's second
// position line, column fills in for event_line_1, repeated `qty` times.
function buildMatrixRows(item, cat, header, year, positionPart1, schoolLanguage) {
  const rows = [];
  const matrix = item.detail?.matrix;
  if (!matrix) return rows;
  const columns = getCategoryColumns(cat, schoolLanguage);

  const emitRow = (subject, column, qty) => {
    if (qty <= 0) return;
    const position = positionPart1 ? `${positionPart1}\n${subject}` : subject;
    const row = [header, year, position, column, ''];
    for (let i = 0; i < qty; i++) rows.push(row);
  };

  getCategorySubjects(cat, schoolLanguage).forEach((subject) => {
    columns.forEach((column) => {
      emitRow(subject, column, Number(matrix[`${cat.key}::${subject}::${column}`]) || 0);
    });
  });

  // Teacher-added rows for a subject/award not on the fixed list above (see
  // OrderCategoryBlock's matrix "+ Add Row") — must be exported too, or
  // Production would never see what to actually engrave for them.
  getCustomMatrixRowIds(cat.key, matrix).forEach((rowId) => {
    const subject = matrix[customMatrixLabelKey(cat.key, rowId)] || '';
    if (!subject) return;
    columns.forEach((column) => {
      emitRow(subject, column, Number(matrix[customMatrixCellKey(cat.key, rowId, column)]) || 0);
    });
  });

  return rows;
}

// Fallback for a category matching neither `mode` ('matrix'/'dynamicMatrix')
// nor `positionFromRows` (defensively covers an unrecognized categoryKey):
// every reference-sample line is fixed as typed, repeated once per unit
// of the item's aggregate qty.
function buildFixedRows(item, header, year, positionPart1) {
  const position2 = getPositionLine2(item);
  const position = position2 ? (positionPart1 ? `${positionPart1}\n${position2}` : position2) : positionPart1;
  const eventLine1 = getLine(item, 3);
  const row = [header, year, position, eventLine1, ''];
  const qty = Number(item.qty) || 0;
  const rows = [];
  for (let i = 0; i < qty; i++) rows.push(row);
  return rows;
}

// LONJAKAN, TOKOH (`positionFromRows` categories): the reference sample's
// last "position" line is only a CONTOH — the real per-plaque position is
// each quantity-table row's own description (e.g. "TAHUN 3", "TOKOH
// NILAM"), repeated that row's own qty times. There's no event_line_1 (the
// quantity table only has one axis, unlike the matrix categories' two).
// LONJAKAN also has a fixed line 3 ("LONJAKAN SAUJANA") that prefixes the
// engraved position — `positionPart1` carries it in for that category only
// (TOKOH doesn't set positionPrefixFromLine3, so it stays row-desc-only,
// same as before).
function buildRowsFromDescriptionRows(item, header, year, positionPart1) {
  const rows = [];
  (item.detail?.rows || []).forEach((r) => {
    const qty = Number(r.qty) || 0;
    if (qty <= 0) return;
    const position = positionPart1 ? `${positionPart1}\n${r.desc || ''}` : (r.desc || '');
    const row = [header, year, position, '', ''];
    for (let i = 0; i < qty; i++) rows.push(row);
  });
  return rows;
}

// PBD TERBAIK / ALIRAN TERBAIK (dynamicMatrix): same shape as
// buildMatrixRows above, except both axes are per-order data instead of
// catalog-fixed — subject rows (default 13 + any teacher-added extras)
// come from item.detail.rows, and columns (a Tahun range + Nama Kelas,
// entirely teacher-defined) from item.detail.columns. Each (row, column)
// cell's qty is the total across every Tahun the column's range covers
// (e.g. TAHUN 3 - TAHUN 6 needs at least 4 — one per year, enforced at Add
// to Cart time) — split back out as evenly as possible per individual year
// here (any remainder going to the earliest years), each becoming its own
// CSV row: subject fills in for the sample's second position line same as
// MP THP, that year + Nama Kelas joined together fill in event_line_1.
// Tahun is optional (a teacher may leave a class row's Dari/Hingga blank)
// — in that case there's nothing to split by, so the full qty goes into a
// single set of rows using just Nama Kelas for event_line_1, instead of
// being dropped entirely.
function buildPbdMatrixRows(item, header, year, positionPart1) {
  const rows = [];
  const subjectRows = item.detail?.rows || [];
  const columns = item.detail?.columns || [];
  const matrix = item.detail?.matrix || {};
  subjectRows.forEach((subjectRow) => {
    columns.forEach((col) => {
      const key = `${item.categoryKey}::${item.blockIdx}::${subjectRow.id}::${col.id}`;
      const qty = Number(matrix[key]) || 0;
      if (qty <= 0) return;
      const position = positionPart1 ? `${positionPart1}\n${subjectRow.desc}` : subjectRow.desc;
      const tahunLabels = tahunRangeYears(col.tahunFrom, col.tahunTo);
      if (tahunLabels.length === 0) {
        const eventLine1 = col.namaKelas || '';
        const row = [header, year, position, eventLine1, ''];
        for (let n = 0; n < qty; n++) rows.push(row);
        return;
      }
      const base = Math.floor(qty / tahunLabels.length);
      const remainder = qty % tahunLabels.length;
      tahunLabels.forEach((tahunLabel, i) => {
        const count = base + (i < remainder ? 1 : 0);
        const eventLine1 = [tahunLabel, col.namaKelas].filter(Boolean).join(' ');
        const row = [header, year, position, eventLine1, ''];
        for (let n = 0; n < count; n++) rows.push(row);
      });
    });
  });
  return rows;
}

// Builds every CSV row for one category of one order — or, when `items` is
// passed explicitly, just that subset. `items` doesn't have to share one
// category (each item's own category is looked up individually below), so
// the same function also backs a Jenis-Plak-combined export that spans
// multiple categories — see getOrderJenisPlakGroups and
// reconstructOrderDetailGroups (computeBlocks.js) / ProductionOrderDetail.jsx.
// Items with no `detail` at all (legacy items predating the real submit
// flow) are skipped (reported via skippedItemIds) rather than producing
// blank rows.
export function buildCsvRows(order, categoryKey, items) {
  const schoolLanguage = order.schoolLanguage === 'SJKC' ? 'SJKC' : 'SK';
  const scopedItems = items || (order.items || []).filter((it) => it.categoryKey === categoryKey);
  const rows = [];
  const skippedItemIds = [];

  scopedItems.forEach((item) => {
    if (!item.detail || !item.detail.lines || Object.keys(item.detail.lines).length === 0) {
      skippedItemIds.push(item.id);
      return;
    }
    const cat = CATEGORIES.find((c) => c.key === item.categoryKey);
    const header = getLine(item, 0);
    const year = getLine(item, 1);

    if (cat?.mode === 'matrix') {
      rows.push(...buildMatrixRows(item, cat, header, year, getLine(item, 2), schoolLanguage));
    } else if (cat?.mode === 'dynamicMatrix') {
      rows.push(...buildPbdMatrixRows(item, header, year, getLine(item, 2)));
    } else if (cat?.positionFromRows) {
      rows.push(...buildRowsFromDescriptionRows(item, header, year, cat.positionPrefixFromLine3 ? getLine(item, 2) : ''));
    } else {
      rows.push(...buildFixedRows(item, header, year, getLine(item, 2)));
    }
  });

  return { rows, skippedItemIds };
}

// Groups an order's items by Jenis Plak, regardless of which category or
// batch each came from — the CSV's own columns (event_header, year,
// position, event_line_1, event_line_2) carry no Jenis Plak info at all,
// so two items sharing the same Jenis Plak are, for export purposes,
// interchangeable rows bound for the exact same physical AI file. Lets
// Production export one combined CSV per Jenis Plak instead of one per
// category/order-detail, when the same Jenis Plak was ordered in more than
// one place.
export function getOrderJenisPlakGroups(order) {
  const byPlak = new Map();
  (order.items || []).forEach((item) => {
    if (!item.jenisPlak) return;
    if (!byPlak.has(item.jenisPlak)) byPlak.set(item.jenisPlak, []);
    byPlak.get(item.jenisPlak).push(item);
  });
  return [...byPlak.entries()].map(([jenisPlak, items]) => ({ jenisPlak, items }));
}

// RFC4180-quoted CSV text. Any value containing a newline, comma, or quote
// gets wrapped in double quotes with embedded quotes doubled — critically,
// an embedded newline (the manual line break a teacher types into the
// "position" field) is preserved raw inside the quotes, which is what
// Excel/Illustrator render as an in-cell line break (the Alt+Enter result).
function quoteCsvValue(value) {
  let str = String(value ?? '');
  // A leading =, +, -, or @ makes Excel/Sheets read the cell as a formula
  // instead of text — a teacher-typed field (e.g. a plaque line) starting
  // with one of these would otherwise execute as a formula for whoever
  // opens the exported CSV. Prefixing with a tab neutralizes it while
  // staying invisible in the cell.
  if (/^[=+\-@]/.test(str)) str = `\t${str}`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function rowsToCsv(rows) {
  const lines = [CSV_COLUMNS, ...rows].map((row) => row.map(quoteCsvValue).join(','));
  return lines.join('\r\n');
}

const WINDOWS_RESERVED_CHARS = /[\\/:*?"<>|]/g;

function sanitizeFilenamePart(part) {
  return part.replace(WINDOWS_RESERVED_CHARS, '-').replace(/\s+/g, ' ').trim();
}

export function buildCategoryCsvFilename(order, categoryLabel) {
  const invoice = sanitizeFilenamePart(order.invoiceId || order.id);
  const category = sanitizeFilenamePart(categoryLabel);
  return `(${invoice}) - ${category}.csv`;
}
