import * as XLSX from 'xlsx';

// The "file structure map" (Document IR) for the AI sheet reader — see
// /mnt/project-files/ai-agent-design (section 3 ②). Built in the browser
// from the same SheetJS workbook excelImport.js already reads, for ONLY the
// sheets the rule-based reader skipped. The AI sees this map and answers
// with cell references (aiMapping.js); every value that ends up in an order
// is then read back from this same map by code, never typed by the AI.
//
// Per sheet: every non-empty cell by its A1 ref, merged ranges (value lives
// in the top-left cell only, as in Excel), and formula cells that have no
// cached value (an openpyxl-generated template the school never re-saved —
// SheetJS can't compute them, so they read as blank and must be asked
// about, not silently treated as 0).

export const IR_VERSION = 1;
const MAX_ROWS_PER_SHEET = 400;
const MAX_COLS = 60;

const isPlaceholder = (s) => /^[-_\s]+$/.test(s);

function cellValue(cell) {
  if (!cell) return '';
  if (cell.v == null || cell.v === '') return '';
  const raw = cell.t === 'd' && cell.w ? cell.w : cell.v;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return isPlaceholder(s) ? '' : s;
}

export function buildSheetIr(ws, name, { hidden = false } = {}) {
  const cells = {};
  const formulaNoValue = [];
  let maxRow = 0;
  let maxCol = 0;
  let truncated = false;
  Object.keys(ws).forEach((ref) => {
    if (ref[0] === '!') return;
    const cell = ws[ref];
    const { r, c } = XLSX.utils.decode_cell(ref);
    const v = cellValue(cell);
    if (c >= MAX_COLS || r >= MAX_ROWS_PER_SHEET) { if (v) truncated = true; return; }
    if (cell && cell.f && (cell.v == null || cell.v === '')) formulaNoValue.push(ref);
    if (!v) return;
    cells[ref] = v;
    maxRow = Math.max(maxRow, r + 1);
    maxCol = Math.max(maxCol, c + 1);
  });
  const merges = (ws['!merges'] || [])
    .filter((m) => m.s.r < MAX_ROWS_PER_SHEET && m.s.c < MAX_COLS)
    .map((m) => XLSX.utils.encode_range(m))
    .filter((range) => cells[range.split(':')[0]]);
  return { id: `S:${name}`, kind: 'sheet', name, hidden, maxRow, maxCol, cells, merges, formulaNoValue, truncated };
}

// `sheetNames` = the sheets to include (the ones the rule reader skipped).
export function buildWorkbookIr(wb, sheetNames) {
  const hiddenByName = new Map((wb.Workbook?.Sheets || []).map((s) => [s.name, !!s.Hidden]));
  const blocks = sheetNames
    .filter((name) => wb.Sheets[name])
    .map((name) => buildSheetIr(wb.Sheets[name], name, { hidden: hiddenByName.get(name) || false }))
    .filter((b) => Object.keys(b.cells).length > 0);
  return { irVersion: IR_VERSION, blocks };
}

// Plain-text view the model reads: one line per row, "r<N>: A=… | C=…",
// then the merged ranges and blank formula cells. Deterministic order, so
// the same sheets always render to the same text (and the same cache key).
export function renderIrText(ir) {
  return ir.blocks.map((b) => {
    const byRow = new Map();
    Object.entries(b.cells).forEach(([ref, v]) => {
      const { r, c } = XLSX.utils.decode_cell(ref);
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r).push([c, v]);
    });
    const rows = [...byRow.keys()].sort((a, b2) => a - b2).map((r) => {
      const parts = byRow.get(r).sort((a, b2) => a[0] - b2[0]).map(([c, v]) => `${XLSX.utils.encode_col(c)}=${v.replace(/\|/g, '/')}`);
      return `r${r + 1}: ${parts.join(' | ')}`;
    });
    const extra = [];
    if (b.merges.length) extra.push(`merged: ${b.merges.join(', ')}`);
    if (b.formulaNoValue.length) extra.push(`formula cells with no saved value (read as blank): ${b.formulaNoValue.join(', ')}`);
    return [`=== SHEET "${b.name}"${b.hidden ? ' (hidden)' : ''} ===`, ...rows, ...extra].join('\n');
  }).join('\n\n');
}

// SHA-256 hex of a string or ArrayBuffer (browser + node 20 both have
// crypto.subtle) — the cache key for "same file, same answer".
export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
