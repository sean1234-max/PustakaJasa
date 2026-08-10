import { CATEGORIES } from '../data/catalog';

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
function buildMatrixRows(item, cat, header, year, positionPart1) {
  const rows = [];
  const matrix = item.detail?.matrix;
  if (!matrix) return rows;
  cat.subjects.forEach((subject) => {
    cat.columns.forEach((column) => {
      const qty = Number(matrix[`${cat.key}::${subject}::${column}`]) || 0;
      if (qty <= 0) return;
      const position = positionPart1 ? `${positionPart1}\n${subject}` : subject;
      const row = [header, year, position, column, ''];
      for (let i = 0; i < qty; i++) rows.push(row);
    });
  });
  return rows;
}

// Fallback for a category matching neither `positionFromRows` nor
// `eventLine1FromRows` (defensively covers an unrecognized categoryKey):
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
// "position" line is only a CONTOH — the real per-plaque position is each
// quantity-table row's own description (e.g. "TAHUN 3", "TOKOH NILAM"),
// repeated that row's own qty times. There's no event_line_1 (the
// quantity table only has one axis, unlike the matrix categories' two).
function buildRowsFromDescriptionRows(item, header, year) {
  const rows = [];
  (item.detail?.rows || []).forEach((r) => {
    const qty = Number(r.qty) || 0;
    if (qty <= 0) return;
    const row = [header, year, r.desc || '', '', ''];
    for (let i = 0; i < qty; i++) rows.push(row);
  });
  return rows;
}

// PBD (`eventLine1FromRows`): header/year/position are fixed as typed
// (including the optional second position box) — only event_line_1 is a
// CONTOH, its real value is each quantity-table row's own description
// (TAHUN 1..6), repeated that row's own qty times.
function buildPbdRows(item, header, year, positionPart1) {
  const position2 = getPositionLine2(item);
  const position = position2 ? (positionPart1 ? `${positionPart1}\n${position2}` : position2) : positionPart1;
  const rows = [];
  (item.detail?.rows || []).forEach((r) => {
    const qty = Number(r.qty) || 0;
    if (qty <= 0) return;
    const row = [header, year, position, r.desc || '', ''];
    for (let i = 0; i < qty; i++) rows.push(row);
  });
  return rows;
}

// Builds every CSV row for one category of one order. Items with no
// `detail` at all (legacy items predating the real submit flow) are
// skipped (reported via skippedItemIds) rather than producing blank rows.
export function buildCsvRows(order, categoryKey) {
  const cat = CATEGORIES.find((c) => c.key === categoryKey);
  const items = (order.items || []).filter((it) => it.categoryKey === categoryKey);
  const rows = [];
  const skippedItemIds = [];

  items.forEach((item) => {
    if (!item.detail || !item.detail.lines || Object.keys(item.detail.lines).length === 0) {
      skippedItemIds.push(item.id);
      return;
    }
    const header = getLine(item, 0);
    const year = getLine(item, 1);

    if (cat?.mode === 'matrix') {
      rows.push(...buildMatrixRows(item, cat, header, year, getLine(item, 2)));
    } else if (cat?.positionFromRows) {
      rows.push(...buildRowsFromDescriptionRows(item, header, year));
    } else if (cat?.eventLine1FromRows) {
      rows.push(...buildPbdRows(item, header, year, getLine(item, 2)));
    } else {
      rows.push(...buildFixedRows(item, header, year, getLine(item, 2)));
    }
  });

  return { rows, skippedItemIds };
}

// RFC4180-quoted CSV text. Any value containing a newline, comma, or quote
// gets wrapped in double quotes with embedded quotes doubled — critically,
// an embedded newline (the manual line break a teacher types into the
// "position" field) is preserved raw inside the quotes, which is what
// Excel/Illustrator render as an in-cell line break (the Alt+Enter result).
function quoteCsvValue(value) {
  const str = String(value ?? '');
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
