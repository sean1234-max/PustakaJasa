import { resolveSelempangWarna, makeDynamicCategoryKey } from '../data/catalog';
import { PLACE_LINE_RE } from './positionWords';

// A school's own "one row per item" order list (Sean, 2026-10-22) — an Excel sheet
// (excelImport.js parseSchoolListSheet) or Word tables (docxImport.js) — as tabs, top to bottom
// in the teacher's own order, by rules (no AI):
//   ① the lines every item starts with (the event heading, "MAJLIS … / 2026"), ② the next line
//     (the award, MERAH), ③ the rest
//   PLAK (or no type) — ORDER LAIN-LAIN; anything else with wording (SET ALAS TULIS …) its own tab
//   SELEMPANG — the SELEMPANG list: ACARA the lines after ①, WARNA the code column
// Every row carries `toRemark` ("KOD | QTY | RM unit | RM total", under REMARK_ITEMS_HEADER): AppState.jsx
// moves a row the website doesn't sell (or with no wording) to the Remark instead; the Remark shows
// such lines as a table (RemarkText.jsx).
// `items`: [{ lines (bracketed subjects already folded), qty, type, kod, unit, total }].
const fmt = (n) => `RM${n.toFixed(2)}`;
export const REMARK_ITEMS_HEADER = 'CODE | QTY | UNIT PRICE | TOTAL PRICE';

// How many leading lines all the worded items share (each keeps at least one line of its own).
function sharedTopLines(items) {
  const worded = items.filter((it) => it.lines.length > 1);
  if (worded.length < 2) return worded.length ? 1 : 0;
  let n = 0;
  while (worded.every((it) => it.lines.length > n + 1 && it.lines[n] === worded[0].lines[n])) n++;
  return Math.max(n, 1);
}

// A plaque's last line that is the winner's place (SK ABDUL SAMAT, 2026-10-27): JOHAN, NAIB JOHAN,
// KETIGA, TEMPAT PERTAMA, EMAS / PERAK / GANGSA ("LENCANA KERIS EMAS")
const isPlaceLine = (line) => PLACE_LINE_RE.test(line) || /^(?:NAIB\s+)?JOHAN$|\b(?:EMAS|PERAK|GANGSA)$/i.test(line);

// ① the shared top lines, ② the next line (red), ③ the rest — or, on a tab whose plaques end in a
// place: ② the lines between, ③ the place (red); a plaque there without one keeps its award in ③.
function slotsOf(it, top, placeTab) {
  if (it.lines.length <= 1) return ['', it.lines[0] || '', '', ''];
  const head = Math.min(top, it.lines.length - 1);
  const heading = it.lines.slice(0, head).join('\n');
  const rest = it.lines.slice(head);
  if (!placeTab) return [heading, rest[0], rest.slice(1).join('\n'), ''];
  const placed = rest.length > 1 && isPlaceLine(rest[rest.length - 1]);
  return placed ? [heading, rest.slice(0, -1).join('\n'), rest[rest.length - 1], ''] : [heading, '', rest.join('\n'), ''];
}

export function schoolListSections(items) {
  const isSelempang = (it) => /SELEMPANG/.test(it.type);
  const top = sharedTopLines(items.filter((it) => !isSelempang(it)));
  const sections = [];
  const selempangRows = [];
  const tabs = new Map();
  items.forEach((it) => {
    if (isSelempang(it)) {
      const resolved = resolveSelempangWarna(it.kod);
      selempangRows.push({ acara: (it.lines.length > 1 ? it.lines.slice(1) : it.lines).join(' '), warna: resolved ? resolved.warna : it.kod, warnaCode: resolved ? resolved.code : '', qty: it.qty });
      return;
    }
    const plak = !it.type || /^PLAK\b/.test(it.type);
    const name = plak ? (slotsOf(it, top, false)[0].replace(/\n/g, ' ') || 'PLAK') : it.type.replace(/\s*\(.*\)\s*$/, '').trim();
    const key = `${plak ? 'P' : 'X'}\u0000${name}`;
    if (!tabs.has(key)) tabs.set(key, { name, plak, rows: [] });
    tabs.get(key).rows.push({ ...it, toRemark: `${it.kod || it.type} | ${it.qty} | ${fmt(it.unit)} | ${fmt(it.total)}`, noWording: !it.lines.length });
  });
  let first = true;
  tabs.forEach(({ name, plak, rows: tabRows }) => {
    const placeTab = tabRows.some((r) => r.lines.length > 1 && isPlaceLine(r.lines[r.lines.length - 1]));
    const rows = tabRows.map((r) => ({ ...r, slots: slotsOf(r, top, placeTab) }));
    const contoh = rows.find((r) => !r.noWording)?.slots || ['', '', '', ''];
    const lines = { umumRed: placeTab ? '2' : '1' };
    contoh.forEach((t, i) => { if (t) lines[`${i}`] = t; });
    const umumRows = rows.map((r, i) => ({
      no: String(i + 1),
      ...Object.fromEntries(r.slots.map((t, k) => [`l${k}`, t === contoh[k] ? '' : (t || '-')])),
      qty: r.qty, jenisPlak: r.kod, harga: r.unit ? String(r.unit) : '', toRemark: r.toRemark, noWording: r.noWording,
    }));
    const section = { lines, umumRows, isUmumList: true, skipLineDerivation: true, classes: [] };
    if (plak && first) { section.sourceSheet = 'ORDER LAIN-LAIN'; first = false; }
    else { section.sourceSheet = name; section.dynamicCategoryKey = makeDynamicCategoryKey('UMUM', name); }
    sections.push(section);
  });
  if (selempangRows.length) sections.push({ lines: {}, selempangRows, isSelempangList: true, skipLineDerivation: true, classes: [], sourceSheet: 'SELEMPANG' });
  return sections;
}
