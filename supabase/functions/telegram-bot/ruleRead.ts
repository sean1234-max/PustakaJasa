// The form bot's "eyes" (Sean, 2026-11-05): a Word kertas kerja whose order is a WORDING / LABEL
// table (BIL | WORDING | KUANTITI | KOD …) is read by rules, the website's own table reader
// (docxImport.js readWordingTables) — no AI, no cost. Only a clean read counts: anything the rules
// can't be sure of (a row without a quantity or wording, a table or list they don't understand, a
// wording too long for the form) sends the whole file to the AI instead. A JUMLAH in the file that
// doesn't add up loses nothing — it goes to the salesman as a question.

import type { ReadPlaque } from './formPlaques.ts';

export type TableRow = { lines: string[]; qty: number; kod?: string; extraKod?: boolean };
export type TableRead = {
  heading: string; notes: string[]; totalNotes: string[]; rows: TableRow[]; listRows: TableRow[];
  noQty: number; unreadTables: number; looseText: string[];
};
export type RuleResult = { ok: true; input: Record<string, unknown> } | { ok: false; why: string };

const FORM_LINES = 4; // FORM ANUGERAH's ORDER LAIN-LAIN: ① TAJUK BESAR ② ③ ④
const MAX_LINES = 8;  // longer than a medal label: not a wording the rules trust
// A line naming the event (it heads the plaque): MAJLIS / HARI … / a year
const EVENT_LINE_RE = /\b(MAJLIS|HARI|SAMBUTAN|IHTIFAL|KARNIVAL|SEMPENA|(?:19|20)\d\d)\b/i;
const SCHOOL_LINE_RE = /^(SK|SJK|SJKC|SJKT|SMK|SMJK|SEKOLAH|KOLEJ)\b/i;
// An order written outside a table ("PKC 263 – 16 PCS", "X 20") — the rules would miss it
const LOOSE_ORDER_RE = /\b\d+\s*(PCS|UNIT|SET|BIJI|PLAK)\b|\bX\s*\d+\b/i;
// A code naming more than one item ("1- YK628 , 2- GTS15": a medal and its stand)
const MULTI_ITEM_KOD_RE = /[,+&]|(?:^|\s)\d\s*-\s*[A-Z]/i;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

// The row's own heading lines (the event, then the school under it), the rest its wording. A school's
// list table (`list`) is read top to bottom as written, so the document's title never goes on it.
function splitHeading(lines: string[], docHeading: string, list: boolean) {
  let n = 0;
  if (lines[0] && (norm(lines[0]) === norm(docHeading) || EVENT_LINE_RE.test(lines[0]))) {
    n = 1;
    if (lines[1] && SCHOOL_LINE_RE.test(lines[1])) n = 2;
  }
  if (n && lines.length > n) return { heading: lines.slice(0, n).join('\n'), rest: lines.slice(n) };
  // no heading of its own: fewer than four lines go under the document's heading; otherwise (or a
  // list, or no document heading) the lines fill ① onwards in order. ① is never left empty — in
  // ORDER LAIN-LAIN an empty cell reads as the CONTOH row's, another award's title.
  return docHeading && !list && lines.length < FORM_LINES
    ? { heading: docHeading, rest: lines }
    : { heading: lines[0], rest: lines.slice(1) };
}

// ② ③ ④ — a longer wording keeps its last two lines as ③ ④ and stacks the rest in ② (as the
// website's Word import does, docxImport.js wordingFields)
const fields = (rest: string[]) => (rest.length <= FORM_LINES - 1
  ? [rest[0] || '', rest[1] || '', rest[2] || '']
  : [rest.slice(0, -2).join('\n'), rest[rest.length - 2], rest[rest.length - 1]]);

export function ruleRead(read: TableRead): RuleResult {
  const rows = [...read.rows.map((r) => ({ ...r, list: false })), ...read.listRows.map((r) => ({ ...r, list: true }))];
  if (!rows.length) return { ok: false, why: 'no WORDING / KUANTITI table' };
  if (read.noQty) return { ok: false, why: `${read.noQty} row(s) without a quantity` };
  if (read.unreadTables) return { ok: false, why: `${read.unreadTables} table(s) the rules don't understand` };
  if (read.notes.length) return { ok: false, why: read.notes[0] };
  if (rows.some((r) => r.extraKod || MULTI_ITEM_KOD_RE.test(r.kod || ''))) return { ok: false, why: 'more than one item per plaque (+ …)' };
  const loose = read.looseText.find((t) => LOOSE_ORDER_RE.test(t));
  if (loose) return { ok: false, why: `an order outside the tables: "${loose.slice(0, 60)}"` };

  const plaques: ReadPlaque[] = [];
  for (const r of rows) {
    if (r.lines.length > MAX_LINES) return { ok: false, why: `a wording of ${r.lines.length} lines` };
    const { heading, rest } = splitHeading(r.lines, read.heading, r.list);
    const [award, line3, line4] = fields(rest);
    plaques.push({
      type: 'umum', heading, award, line3, line4,
      subject: '', tahun: null, kelas: '', qty: r.qty, code: r.kod || '',
    });
  }
  return { ok: true, input: { school: '', teacher: '', plaques, selempang: [], questions: read.totalNotes } };
}
