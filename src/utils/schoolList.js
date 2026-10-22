import { resolveSelempangWarna, makeDynamicCategoryKey } from '../data/catalog';

// A school's own "one row per item" order list (Sean, 2026-10-22) — an Excel sheet
// (excelImport.js parseSchoolListSheet) or Word tables (docxImport.js) — as tabs, top to bottom
// in the teacher's own order, by rules (no AI):
//   ① the lines every item starts with (the event heading, "MAJLIS … / 2026"), ② the next line
//     (the award, MERAH), ③ the rest
//   PLAK (or no type) — ORDER LAIN-LAIN; anything else with wording (SET ALAS TULIS …) its own tab
//   SELEMPANG — the SELEMPANG list: ACARA the lines after ①, WARNA the code column
// Every row carries `toRemark` ("KOD/RM unit/RM total"): AppState.jsx moves a row the website
// doesn't sell (or with no wording) to the Remark instead.
// `items`: [{ lines (bracketed subjects already folded), qty, type, kod, unit, total }].
const fmt = (n) => `RM${n.toFixed(2)}`;

// How many leading lines all the worded items share (each keeps at least one line of its own).
function sharedTopLines(items) {
  const worded = items.filter((it) => it.lines.length > 1);
  if (worded.length < 2) return worded.length ? 1 : 0;
  let n = 0;
  while (worded.every((it) => it.lines.length > n + 1 && it.lines[n] === worded[0].lines[n])) n++;
  return Math.max(n, 1);
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
    const head = Math.min(top, it.lines.length - 1);
    const slots = it.lines.length > 1
      ? [it.lines.slice(0, head).join('\n'), it.lines[head], it.lines.slice(head + 1).join('\n'), '']
      : ['', it.lines[0] || '', '', ''];
    const name = plak ? (slots[0].replace(/\n/g, ' ') || 'PLAK') : it.type.replace(/\s*\(.*\)\s*$/, '').trim();
    const key = `${plak ? 'P' : 'X'}\u0000${name}`;
    if (!tabs.has(key)) tabs.set(key, { name, plak, rows: [] });
    tabs.get(key).rows.push({ ...it, slots, toRemark: `${it.kod || it.type}/${fmt(it.unit)}/${fmt(it.total)}`, noWording: !it.lines.length });
  });
  let first = true;
  tabs.forEach(({ name, plak, rows }) => {
    const contoh = rows.find((r) => !r.noWording)?.slots || ['', '', '', ''];
    const lines = { umumRed: '1' };
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
