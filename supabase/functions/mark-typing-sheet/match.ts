// Pure helpers for mark-typing-sheet (kept apart from index.ts so vitest can load them).

// The website's own selempang code (src/data/catalog.js SELEMPANG_CODE — an Edge Function can't
// import from src/, change both together).
export const SELEMPANG_CODE = 'SELEMPANG';

// Who goes into column I. Only these accounts do Done Typing (Sean, 2026-11-06); anyone else
// gets the part of their email before @, in capitals.
const NAME_BY_EMAIL: Record<string, string> = {
  'sean@pjsb.com': 'SEAN',
  'production@pjsb.com': 'SITI',
  'kesin@pjsb.com': 'KESIN',
};
export function markerName(email: string): string {
  const e = String(email || '').trim().toLowerCase();
  return NAME_BY_EMAIL[e] || e.split('@')[0].toUpperCase();
}

// "NOV" — the month in Malaysia, now.
export function monthTag(now: Date): string {
  return now.toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', month: 'short' }).toUpperCase().slice(0, 3);
}

// The sheet's QTY is the trophy + plak count: every item of the order except selempang.
export function sheetQty(items: { jenisPlak?: string; qty?: unknown }[]): number {
  return (items || []).filter((it) => it?.jenisPlak !== SELEMPANG_CODE).reduce((s, it) => s + (Number(it?.qty) || 0), 0);
}

export const normalizeName = (s: unknown) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

// One row of the sheet as read: column F (school), H (QTY), I (who typed it).
export type SheetRow = { row: number; school: unknown; qty: unknown; mark: unknown };

const nameMatches = (sheetSchool: unknown, school: string) => {
  const want = normalizeName(school);
  return !!want && normalizeName(sheetSchool).includes(want);
};
const qtyMatches = (sheetQtyCell: unknown, qty: number) => {
  const n = Number(String(sheetQtyCell ?? '').trim());
  return String(sheetQtyCell ?? '').trim() !== '' && Number.isFinite(n) && n === qty;
};

// Rows not marked yet whose school contains the order's school (case and spaces ignored) and whose QTY
// is the same. The caller fills only when there is exactly one.
export function findRows(rows: SheetRow[], school: string, qty: number): number[] {
  return rows
    .filter((r) => String(r.mark ?? '').trim() === '' && nameMatches(r.school, school) && qtyMatches(r.qty, qty))
    .map((r) => r.row);
}

// The row this order was marked on, for clearing: the remembered row if it still holds the order's mark,
// else the one row that does (rows moved). null when it can't be told.
export function findMarkedRow(rows: SheetRow[], school: string, qty: number, value: string, remembered: number): number | null {
  const holds = (r: SheetRow) => normalizeName(r.mark) === normalizeName(value) && nameMatches(r.school, school);
  const at = rows.find((r) => r.row === remembered);
  if (at && holds(at)) return at.row;
  const found = rows.filter((r) => holds(r) && qtyMatches(r.qty, qty));
  return found.length === 1 ? found[0].row : null;
}
