// Layout memory (Sean, 2026-10-17): the first time the AI maps an Excel
// sheet layout nobody has uploaded before, the layout is remembered — for
// every user and every school — so the next sheet laid out the same way is
// read from memory with no AI call and no cost.
//
// What is kept is only the layout: the column headers the AI pointed at
// (e.g. "NAMA KELAS" in B6, "KUANTITI" in D6) and which columns/cells play
// which part (schema.ts's block). Never a student's name, a class or a
// quantity: the rows are re-found on every new sheet, and every value is
// still read from that sheet by the browser (src/utils/aiMapping.js).
//
// A remembered layout is used only when every header it was learned from
// is in the same cell with the same text, every heading/title/code cell it
// points at has something in it, and the sheet has at least one row with a
// whole-number quantity where the layout says. Otherwise the sheet goes to
// the AI as before. Only answers the AI was sure of ("high", no note, no
// question about the sheet) are remembered.

export const LAYOUT_VERSION = '1';

type Cells = Map<string, string>;
export type IrSheet = { name: string; hidden: boolean; section: string; cells: Cells; maxRow: number; maxCol: number };

// A block as in schema.ts.
export type Block = {
  sheet: string; role: string; headingCells: string[]; titleCell: string | null; fixedCells: string[]; codeCell: string | null;
  headerRow: number | null; firstRow: number | null; lastRow: number | null;
  wordingColumns: string[]; qtyColumn: string | null; codeColumn: string | null;
  labelColumn: string | null; classColumns: string[]; confidence: string; note: string | null;
};

export type Layout = {
  role: 'award-list' | 'class-matrix';
  anchors: { ref: string; text: string }[];
  present: string[];
  template: Block;
};

const TOTAL_RE = /^(JUMLAH|TOTAL|JUMLAH BESAR|GRAND TOTAL)\b/i;
const COL_RE = /^[A-Z]{1,3}$/;

export const colIndex = (col: string) => [...col].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
export const colName = (idx: number) => {
  let s = '';
  for (let n = idx; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const isQty = (s: string | undefined) => !!s && /^\d{1,5}$/.test(s.trim()) && Number(s) > 0;

// renderIrText (src/utils/fileIr.js) back into sheets: "=== SHEET "x" ===",
// then "r<N>: A=… | C=…" lines, then merged / formula lines.
export function parseIrSheets(irText: string): IrSheet[] {
  const sheets: IrSheet[] = [];
  let cur: IrSheet | null = null;
  const lines: string[] = [];
  const flush = () => { if (cur) { cur.section = lines.join('\n').trimEnd(); sheets.push(cur); } lines.length = 0; };
  for (const line of irText.split('\n')) {
    const head = line.match(/^=== SHEET "(.*)"( \(hidden\))? ===$/);
    if (head) {
      flush();
      cur = { name: head[1], hidden: !!head[2], section: '', cells: new Map(), maxRow: 0, maxCol: 0 };
      lines.push(line);
      continue;
    }
    if (!cur) continue;
    lines.push(line);
    const row = line.match(/^r(\d+): (.*)$/);
    if (!row) continue;
    const r = Number(row[1]);
    for (const part of row[2].split(' | ')) {
      const eq = part.indexOf('=');
      const col = part.slice(0, eq);
      if (eq < 1 || !COL_RE.test(col)) continue;
      cur.cells.set(`${col}${r}`, part.slice(eq + 1));
      cur.maxRow = Math.max(cur.maxRow, r);
      cur.maxCol = Math.max(cur.maxCol, colIndex(col));
    }
  }
  flush();
  return sheets;
}

const cell = (sheet: IrSheet, ref: string) => sheet.cells.get(ref) ?? '';
const refsOf = (b: Block) => [b.titleCell, b.codeCell, ...(b.headingCells || []), ...(b.fixedCells || [])].filter((r): r is string => !!r);

// What the AI's sure answer for one sheet teaches: null when there is
// nothing safe to remember.
export function layoutFromBlock(b: Block, sheet: IrSheet): Layout | null {
  if (b.confidence !== 'high' || b.note || !Number.isInteger(b.headerRow) || !Number.isInteger(b.firstRow)) return null;
  const hr = b.headerRow as number;
  if ((b.firstRow as number) <= hr) return null;
  const present = refsOf(b);
  if (present.some((ref) => !cell(sheet, ref))) return null;
  const base = { ...b, sheet: '', lastRow: null, note: null };
  if (b.role === 'award-list') {
    if (!b.qtyColumn || !b.wordingColumns?.length) return null;
    const cols = [...b.wordingColumns, b.qtyColumn, ...(b.codeColumn ? [b.codeColumn] : [])];
    const anchors = cols.map((c) => ({ ref: `${c}${hr}`, text: norm(cell(sheet, `${c}${hr}`)) })).filter((a) => a.text);
    // The quantity column's own header, plus at least one more.
    if (anchors.length < 2 || !anchors.some((a) => a.ref === `${b.qtyColumn}${hr}`)) return null;
    return { role: 'award-list', anchors, present, template: base };
  }
  if (b.role === 'class-matrix') {
    if (!b.labelColumn || !b.classColumns?.length) return null;
    const label = norm(cell(sheet, `${b.labelColumn}${hr}`));
    // A matrix's class names change from school to school, so they are
    // found again each time; the row-label header must be a real word.
    if (label.length < 3 || !present.length) return null;
    return { role: 'class-matrix', anchors: [{ ref: `${b.labelColumn}${hr}`, text: label }], present, template: { ...base, classColumns: [] } };
  }
  return null;
}

// One key per distinct layout, so the same layout is stored once.
export function layoutKey(l: Layout): string {
  const t = l.template;
  return JSON.stringify([LAYOUT_VERSION, l.role, l.anchors, l.present, t.headingCells, t.titleCell, t.fixedCells, t.codeCell,
    t.headerRow, t.firstRow, t.wordingColumns, t.qtyColumn, t.codeColumn, t.labelColumn]);
}

// A remembered layout applied to a new sheet: the block for it, or null
// when the sheet doesn't fit.
export function matchLayout(l: Layout, sheet: IrSheet): Block | null {
  const t = l.template;
  if (!l.anchors.length || l.anchors.some((a) => norm(cell(sheet, a.ref)) !== a.text)) return null;
  if (l.present.some((ref) => !cell(sheet, ref))) return null;
  const hr = t.headerRow as number;
  const first = t.firstRow as number;
  if (first > sheet.maxRow) return null;

  let classColumns: string[] = [];
  let dataCols: string[];
  if (l.role === 'class-matrix') {
    const from = colIndex(t.labelColumn as string) + 1;
    // The classes run from the label column to the JUMLAH/TOTAL column (or
    // to the first column with no header): anything after that — HARGA,
    // CATATAN — is not a class.
    for (let c = from; c <= sheet.maxCol; c++) {
      const h = cell(sheet, `${colName(c)}${hr}`);
      if (!h || TOTAL_RE.test(h)) break;
      classColumns.push(colName(c));
    }
    if (!classColumns.length) return null;
    dataCols = [t.labelColumn as string, ...classColumns];
  } else {
    dataCols = [...t.wordingColumns, t.qtyColumn as string];
  }

  // The rows: from the learned first row down to a JUMLAH/TOTAL row, or to
  // three empty rows in a row (the order table has ended).
  const lead = l.role === 'class-matrix' ? t.labelColumn as string : t.wordingColumns[0];
  let last = 0;
  let gap = 0;
  for (let r = first; r <= sheet.maxRow; r++) {
    const filled = dataCols.some((c) => cell(sheet, `${c}${r}`));
    if (!filled) { if (++gap >= 3) break; continue; }
    gap = 0;
    last = r;
    if (TOTAL_RE.test(cell(sheet, `${lead}${r}`))) break;
  }
  if (!last) return null;
  const qtyCols = l.role === 'class-matrix' ? classColumns : [t.qtyColumn as string];
  let rows = 0;
  for (let r = first; r <= last; r++) {
    if (TOTAL_RE.test(cell(sheet, `${lead}${r}`))) continue;
    if (qtyCols.some((c) => isQty(cell(sheet, `${c}${r}`)))) rows++;
  }
  if (!rows) return null;
  return { ...t, sheet: sheet.name, lastRow: last, classColumns: l.role === 'class-matrix' ? classColumns : t.classColumns, confidence: 'high', note: null };
}
