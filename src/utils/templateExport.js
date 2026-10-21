import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { umumDefaultRedSlot } from './umumLines';

// AI reader -> the shop's own Excel order form (owner, 2026-10-16: "做").
// A teacher's PDF or Word order, once read (pdfMapping.js), is written into
// a copy of the blank FORM ANUGERAH template so staff can check it — and
// send it to the school — in the form everyone already knows, then upload
// it the usual way.
//
// Where each plaque goes:
// - "<Tahun> <class>" plaques given to every class of a Tahun for every
//   award (e.g. 11 awards x 9 classes) -> MP THP 1 / MP THP 2 (Kalau ada
//   kelas): the awards down the SUBJEK column, each Tahun's classes in its
//   own Nama Kelas list.
// - "ALIRAN TAHUN n PPKI" plaques -> the PPKI sheet, the same way.
// - LONJAKAN SAUJANA / KEHADIRAN PENUH -> their own sheets, one row per
//   Tahun; TOKOH awards -> the TOKOH sheet, one row per honour; a subject
//   for each Tahun (MATA PELAJARAN TERBAIK) -> MP THP 1 / MP THP 2; the
//   Selempang tab -> SELEMPANG; Function Details and the Remark -> FRONT PG
//   (Sean, 2026-10-17: the same sheets staff fill by hand). The hidden
//   SENARAI PLAK price list takes the website's own prices (`priceOf`). On those
//   sheets a plaque under another TAJUK BESAR than the rest goes to ORDER
//   LAIN-LAIN, which can say its own heading.
// - everything else -> ORDER LAIN-LAIN, one row per plaque wording.
// A second plaque code (or more rows than a sheet holds) gets a copy of the
// sheet, "<name> (2)", the way staff already do it by hand.
//
// The template is patched cell by cell in its own XML, so its colours,
// formulas, pictures and the hidden price list stay exactly as they are;
// Excel recalculates every total when the file is opened.

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORKSHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const DRAWING_CT = 'application/vnd.openxmlformats-officedocument.drawing+xml';

const SHEET_MP1 = 'MP THP 1 (Kalau ada kelas)';
const SHEET_MP2 = 'MP THP 2 (Kalau ada kelas)';
const SHEET_MP_PLAIN = { 1: 'MP THP 1', 2: 'MP THP 2' };
const SHEET_LONJAKAN = 'LONJAKAN SAUJANA';
const SHEET_KEHADIRAN = 'KEHADIRAN PENUH';
const SHEET_TOKOH = 'TOKOH';
const SHEET_SELEMPANG = 'SELEMPANG';
const SHEET_FRONT = 'FRONT PG';
const SHEET_PRICES = 'SENARAI PLAK';
const SHEET_PPKI = ['PPKI,PRA', 'PPKI'];
const SHEET_UMUM = ['ORDER LAIN-LAIN', 'UMUM (万能)', 'UMUM'];
const DEFAULT_CLASS_ROWS = 12;

const up = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

// ---------------------------------------------------------------------------
// Plan: the AI's tabs -> what goes on which sheet. Pure, no file.

// One plaque wording from an AI tab: the award (POSITION) and the line under
// it (the class / Tahun), with its count and code. `{ plaques }` instead of
// the AI's tabs: the plaques of the order on the page (draftForm.js).
// Every wording goes into the form in capitals (Sean, 2026-10-17); line
// breaks in a heading are kept. An award that starts with the plaque's own
// TAJUK BESAR drops it: the form writes the heading in its own row (Sean,
// 2026-10-17).
const lineKey = (s) => s.replace(/\s+/g, ' ').trim();
function dropHeading(text, heading) {
  const head = heading.split('\n').map(lineKey).filter(Boolean);
  const lines = text.split('\n');
  if (!head.length || lines.length < head.length) return text;
  return head.every((h, i) => lineKey(lines[i]) === h) ? lines.slice(head.length).join('\n').trim() : text;
}
// The year at the end of a TAJUK BESAR goes on its own line ("HARI
// ANUGERAH KUALITI\n2026"), the way the plaque is laid out (Sean,
// 2026-10-17).
const TRAILING_YEAR_RE = /^(.*\S)\s+((?:SESI\s+)?(?:19|20)\d{2}(?:\s*\/\s*(?:19|20)?\d{2})?)$/;
function yearOnOwnLine(heading) {
  const lines = heading.split('\n');
  const m = TRAILING_YEAR_RE.exec(lines[lines.length - 1].trim());
  if (m) lines.splice(lines.length - 1, 1, m[1], m[2]);
  return lines.join('\n');
}
function plaquesOf(categorized) {
  const caps = (p) => {
    const heading = String(p.heading ?? '').toUpperCase();
    return { ...p, heading: yearOnOwnLine(heading), award: dropHeading(String(p.award ?? '').toUpperCase(), heading), line: String(p.line ?? '').toUpperCase(), eline2: String(p.eline2 ?? '').toUpperCase() };
  };
  if (Array.isArray(categorized?.plaques)) return categorized.plaques.filter((p) => p.qty > 0).map(caps);
  const out = [];
  Object.values(categorized || {}).forEach((sections) => (sections || []).forEach((section) => {
    const lines = section.lines || {};
    const heading = String(lines['0'] || '').trim();
    const award = String(lines['2'] || '').trim();
    const code = String(section.jenisPlak || '').trim();
    (section.classes || []).forEach((cls) => {
      const line = String(cls.namaKelas || cls.tahunFrom || '').trim();
      const eline2 = String(cls.eline2 || '').trim();
      const qty = (cls.subjects || []).reduce((a, s) => a + (Number(s.qty) || 0), 0);
      if (qty > 0) out.push({ heading, award, line, eline2, qty, code });
    });
  }));
  return out.map(caps);
}

const YEAR_CLASS_RE = /^([1-6])\s+([A-Z][A-Z0-9 .&'’-]*)$/;
const PPKI_RE = /^(ALIRAN\s+TAHUN\s+[1-6])\s*PPKI$/;
const TAHUN_RE = /^TAHUN ([1-6])$/;
const SUBJECT_TAHUN_RE = /^(?:TAHUN\s*)?([1-6])$/;

// Which of the one-award sheets a plaque belongs on, by its tab's kind
// (draftForm.js) or, for a tab read from a Word or PDF order, its award.
function sheetKind(p) {
  const award = up(p.award);
  if (p.kind === 'LONJAKAN' || /\bLONJAKAN SAUJANA\b/.test(award)) return 'lonjakan';
  if (p.kind === 'KEHADIRAN' || /\bKEHADIRAN PENUH\b/.test(award)) return 'kehadiran';
  if (p.kind === 'TOKOH_SHEET' || /^TOKOH\b/.test(award)) return 'tokoh';
  const subjectYear = up(p.line) && !/\bTAHUN\b/.test(up(p.line)) && SUBJECT_TAHUN_RE.exec(up(p.eline2));
  if (subjectYear && (p.kind === 'MP1' || p.kind === 'MP2' || /\bMATA PELAJARAN\b/.test(award))) return 'mpPlain';
  return null;
}

// The TAJUK BESAR most of these plaques carry: they share the sheet's one
// title box; the rest go to ORDER LAIN-LAIN.
function mainHeading(items) {
  const n = new Map();
  items.forEach((p) => n.set(p.heading, (n.get(p.heading) || 0) + p.qty));
  const top = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { main: items.filter((p) => p.heading === top), rest: items.filter((p) => p.heading !== top) };
}

// Awards given to every class of the group alike (same classes, same count
// each) — the only shape the Nama Kelas sheets can hold. An award that
// differs is returned in `odd` and goes to ORDER LAIN-LAIN instead.
function crossProduct(items, keyOf) {
  let awards = [...new Set(items.map((p) => p.award))];
  const odd = [];
  for (;;) {
    const sets = new Map(awards.map((a) => [a, new Set(items.filter((p) => p.award === a).map(keyOf))]));
    const counts = new Map();
    sets.forEach((s) => s.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));
    // The classes most awards share; an award missing one, or with an extra
    // one, doesn't fit.
    const common = [...counts].filter(([, n]) => n * 2 > awards.length).map(([k]) => k);
    const misfits = awards.filter((a) => {
      const s = sets.get(a);
      return s.size !== common.length || common.some((k) => !s.has(k));
    });
    if (misfits.length === 0 || misfits.length === awards.length) {
      if (misfits.length === awards.length && awards.length > 1) { odd.push(...awards); awards = []; }
      break;
    }
    odd.push(...misfits);
    awards = awards.filter((a) => !misfits.includes(a));
  }
  return { awards, odd };
}

export function planTemplateFill(categorized) {
  const plaques = plaquesOf(categorized);
  const notes = [];
  const umum = [];
  const mpGroups = new Map();
  const ppkiGroups = new Map();
  const byKind = { lonjakan: [], kehadiran: [], tokoh: [], mpPlain: [] };
  plaques.forEach((p) => {
    // a row of a merged list (mergeSameSampleTabs): ORDER LAIN-LAIN as it is
    if (p.oneSheet) { umum.push(p); return; }
    const kind = sheetKind(p);
    if (kind) { byKind[kind].push(p); return; }
    const line = up(p.line);
    const yc = !p.eline2 && YEAR_CLASS_RE.exec(line);
    const pk = !p.eline2 && PPKI_RE.exec(line);
    if (yc) {
      const year = Number(yc[1]);
      const band = year <= 3 ? 1 : 2;
      const key = `${band}\u0000${p.code}\u0000${p.heading}`;
      if (!mpGroups.has(key)) mpGroups.set(key, { band, code: p.code, heading: p.heading, items: [] });
      mpGroups.get(key).items.push({ ...p, year, kelas: yc[2], key: `${year}\u0000${yc[2]}\u0000${p.qty}` });
    } else if (pk) {
      const key = `${p.code}\u0000${p.heading}`;
      if (!ppkiGroups.has(key)) ppkiGroups.set(key, { code: p.code, heading: p.heading, items: [] });
      ppkiGroups.get(key).items.push({ ...p, level: pk[1].replace(/\s+/g, ' '), key: `${pk[1]}\u0000${p.qty}` });
    } else umum.push(p);
  });

  const toUmum = (items) => umum.push(...items.map(({ heading, award, line, eline2, qty, code }) => ({ heading, award, line, eline2, qty, code })));

  const mp = [];
  mpGroups.forEach((g) => {
    const { awards, odd } = crossProduct(g.items, (p) => p.key);
    if (odd.length) {
      notes.push(`${odd.length} award(s) are not given to the same classes as the rest (${odd.slice(0, 3).join(', ')}${odd.length > 3 ? ', …' : ''}), so they went to ORDER LAIN-LAIN, one row per class.`);
      toUmum(g.items.filter((p) => odd.includes(p.award)));
    }
    if (!awards.length) return;
    const first = g.items.find((p) => p.award === awards[0]);
    const years = new Map();
    first && g.items.filter((p) => p.award === awards[0]).forEach((p) => {
      if (!years.has(p.year)) years.set(p.year, []);
      years.get(p.year).push({ kelas: p.kelas, qty: p.qty });
    });
    mp.push({ band: g.band, code: g.code, heading: g.heading, awards, years, sample: [awards[0], first.line] });
  });

  const ppki = [];
  ppkiGroups.forEach((g) => {
    const { awards, odd } = crossProduct(g.items, (p) => p.key);
    if (odd.length) {
      notes.push(`${odd.length} PPKI award(s) are not given to the same Tahun as the rest, so they went to ORDER LAIN-LAIN.`);
      toUmum(g.items.filter((p) => odd.includes(p.award)));
    }
    if (!awards.length) return;
    const firstItems = g.items.filter((p) => p.award === awards[0]);
    const levels = firstItems.map((p) => ({ label: p.level, qty: p.qty }));
    ppki.push({ code: g.code, heading: g.heading, awards, levels, sample: [awards[0], firstItems[0].line] });
  });

  // LONJAKAN SAUJANA / KEHADIRAN PENUH: one award, a row per Tahun.
  const tahunList = (items) => {
    const { main, rest } = mainHeading(items);
    toUmum(rest);
    const award = main[0]?.award || '';
    toUmum(main.filter((p) => p.award !== award || p.eline2));
    const rows = main.filter((p) => p.award === award && !p.eline2).map(({ line, qty, code }) => ({ label: line, qty, code }));
    return rows.length ? { heading: main[0].heading, award, rows } : null;
  };
  const lonjakan = tahunList(byKind.lonjakan);
  const kehadiran = tahunList(byKind.kehadiran);

  // TOKOH: one honour per row, its whole wording in the TOKOH column.
  const tokohMain = mainHeading(byKind.tokoh);
  toUmum(tokohMain.rest);
  const tokoh = tokohMain.main.length ? {
    heading: tokohMain.main[0].heading,
    rows: tokohMain.main.map((p) => ({ name: p.award, nama: [p.line, p.eline2].filter(Boolean).join('\n'), qty: p.qty, code: p.code })),
  } : null;

  // MP THP 1 / 2: a subject per row, its count under each Tahun; one sheet
  // per award and code.
  const plainGroups = new Map();
  byKind.mpPlain.forEach((p) => {
    const year = Number(SUBJECT_TAHUN_RE.exec(up(p.eline2))[1]);
    const band = year <= 3 ? 1 : 2;
    const key = `${band}\u0000${p.code}\u0000${p.heading}\u0000${p.award}`;
    if (!plainGroups.has(key)) plainGroups.set(key, { band, code: p.code, heading: p.heading, award: p.award, subjects: new Map(), sample: [p.line, `TAHUN ${year}`], items: [] });
    const g = plainGroups.get(key);
    const subject = up(p.line);
    if (!g.subjects.has(subject)) g.subjects.set(subject, new Map());
    const years = g.subjects.get(subject);
    years.set(year, (years.get(year) || 0) + p.qty);
    g.items.push(p);
  });
  const mpPlain = [...plainGroups.values()];

  return { mp, ppki, lonjakan, kehadiran, tokoh, mpPlain, umum, notes, allCodes: plaques.map((p) => p.code).filter(Boolean), plaqueCount: plaques.reduce((a, p) => a + p.qty, 0) };
}

// ---------------------------------------------------------------------------
// Template layout: where things are, found by the sheet's own labels (as
// excelImport.js reads them back), never by fixed cell addresses.

const addr = (r, c) => XLSX.utils.encode_cell({ r, c });

function textAt(ws, r, c) {
  const cell = ws[addr(r, c)];
  return cell ? up(cell.w ?? cell.v) : '';
}

function findCells(ws, label, test = (t) => t === label) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const out = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) if (test(textAt(ws, r, c))) out.push({ r, c });
  }
  return out;
}

// Rows of the SUBJEK column below its header, up to the TOTAL row.
function subjectRows(ws, subjek, firstRow) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = firstRow; r <= range.e.r; r++) {
    if (/^TOTAL/.test(textAt(ws, r, subjek.c))) break;
    rows.push(r);
  }
  return rows;
}

function titleCells(ws) {
  const ins = findCells(ws, 'TOLONG ISI DI SINI')[0];
  return ins ? { heading: addr(ins.r + 1, ins.c), sample: addr(ins.r + 2, ins.c) } : null;
}

function plakValueCell(ws) {
  const h = findCells(ws, 'JENIS PLAK').sort((a, b) => b.r - a.r)[0];
  return h ? addr(h.r + 1, h.c) : null;
}

// How many classes one Nama Kelas list holds: the rows its SUM formula
// covers (=SUM(G13:G24)), else 12.
function classCapacity(ws, rows, levelCol) {
  for (const r of rows) {
    const f = ws[addr(r, levelCol)]?.f;
    const m = f && /SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)/i.exec(f);
    if (m) return Number(m[2]) - Number(m[1]) + 1;
  }
  return DEFAULT_CLASS_ROWS;
}

function layoutMp(ws) {
  const subjek = findCells(ws, 'SUBJEK')[0];
  if (!subjek) return null;
  const blocks = new Map();
  findCells(ws, '', (t) => /^TAHUN [1-6]$/.test(t)).filter((p) => p.r === subjek.r && p.c > subjek.c + 2).forEach((p) => {
    blocks.set(Number(textAt(ws, p.r, p.c).slice(-1)), { nameCol: p.c, qtyCol: p.c + 1 });
  });
  const levelCols = new Map();
  findCells(ws, '', (t) => /^TAHUN [1-6]$/.test(t)).filter((p) => p.r === subjek.r + 1 && p.c <= subjek.c + 4).forEach((p) => {
    levelCols.set(Number(textAt(ws, p.r, p.c).slice(-1)), p.c);
  });
  const rows = subjectRows(ws, subjek, subjek.r + 2);
  const anyLevel = [...levelCols.values()][0];
  return {
    subjekCol: subjek.c, awardRows: rows, dataRow: subjek.r + 2, blocks, levelCols,
    classRows: anyLevel != null ? classCapacity(ws, rows, anyLevel) : DEFAULT_CLASS_ROWS,
    title: titleCells(ws), plak: plakValueCell(ws),
  };
}

function layoutPpki(ws) {
  const subjek = findCells(ws, 'SUBJEK')[0];
  if (!subjek) return null;
  const block = findCells(ws, 'PPKI').find((p) => p.r === subjek.r && p.c > subjek.c + 3);
  const level = findCells(ws, 'PPKI').find((p) => p.r === subjek.r + 1 && p.c <= subjek.c + 4);
  if (!block) return null;
  const rows = subjectRows(ws, subjek, subjek.r + 2);
  return {
    subjekCol: subjek.c, awardRows: rows, dataRow: subjek.r + 2, nameCol: block.c, qtyCol: block.c + 1, levelCol: level?.c,
    classRows: level ? classCapacity(ws, rows, level.c) : DEFAULT_CLASS_ROWS,
    title: titleCells(ws), plak: plakValueCell(ws),
  };
}

// The title box under "TOLONG ISI DI SINI": one line per row.
function titleRows(ws) {
  const ins = findCells(ws, 'TOLONG ISI DI SINI')[0];
  return ins ? (i) => addr(ins.r + 1 + i, ins.c) : null;
}

// A list under a header row (LONJAKAN SAUJANA / KEHADIRAN PENUH: TAHUN;
// TOKOH: TOKOH), down to its TOTAL row: each row's label, KUANTITI and
// JENIS PLAK columns.
function layoutList(ws, label) {
  const head = findCells(ws, label)[0];
  if (!head) return null;
  const col = (re) => findCells(ws, '', (t) => re.test(t)).find((p) => p.r === head.r)?.c;
  const qty = col(/^KUANTITI$/);
  const plak = col(/^JENIS PLAK$/);
  const nama = col(/^NAMA MURID$/);
  if (qty == null || plak == null) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = head.r + 1; r <= range.e.r; r++) {
    if (/^TOTAL/.test(textAt(ws, r, head.c))) break;
    rows.push({ r, label: textAt(ws, r, head.c) });
  }
  return { labelCol: head.c, qtyCol: qty, plakCol: plak, namaCol: nama, rows, title: titleRows(ws) };
}

function layoutSelempang(ws) {
  const acara = findCells(ws, 'ACARA')[0];
  if (!acara) return null;
  const col = (label) => findCells(ws, label).find((p) => p.r === acara.r)?.c;
  const warna = col('WARNA');
  const qty = col('KUANTITI');
  return warna == null || qty == null ? null : { firstRow: acara.r + 1, acaraCol: acara.c, warnaCol: warna, qtyCol: qty };
}

function layoutUmum(ws) {
  const no = findCells(ws, 'NO.')[0];
  if (!no) return null;
  const col = (label) => findCells(ws, label).find((p) => p.r === no.r)?.c;
  const cols = { l0: col('①'), l1: col('②'), l2: col('③'), l3: col('④'), qty: col('KUANTITI'), plak: col('JENIS PLAK') };
  if (cols.l1 == null || cols.qty == null || cols.plak == null) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = no.r + 1; r <= range.e.r; r++) if (/^\d+$/.test(textAt(ws, r, no.c))) rows.push(r);
  // The CONTOH lines ①-④ above the list.
  // Its "WARNA MERAH?" pick beside each line.
  const contoh = {};
  const merah = {};
  const merahHead = findCells(ws, '', (t) => /^WARNA MERAH/.test(t)).find((p) => p.r < no.r);
  ['①', '②', '③', '④'].forEach((mark, i) => {
    const p = findCells(ws, mark).find((q) => q.r < no.r && q.c === no.c);
    if (p) contoh[`l${i}`] = addr(p.r, p.c + 1);
    if (p && merahHead) merah[`${i}`] = addr(p.r, merahHead.c);
  });
  return { rows, cols, contoh, merah };
}

// ---------------------------------------------------------------------------
// The workbook package: sheets by name, copies, and cell writes.

function makeBook(zip, files, { DOMParser: DP, XMLSerializer: XS }) {
  const parse = (s) => new DP().parseFromString(s, 'application/xml');
  const ser = (d) => new XS().serializeToString(d);
  const wbDoc = parse(files.workbook);
  const relsDoc = parse(files.workbookRels);
  const ctDoc = parse(files.contentTypes);
  const sheetEls = () => Array.from(wbDoc.getElementsByTagNameNS(MAIN_NS, 'sheet'));
  const relTarget = (id) => {
    const rel = Array.from(relsDoc.getElementsByTagNameNS(PKG_REL_NS, 'Relationship')).find((r) => r.getAttribute('Id') === id);
    const t = rel?.getAttribute('Target') || '';
    return t.startsWith('/') ? t.slice(1) : `xl/${t}`;
  };
  const sheetPath = (name) => {
    const el = sheetEls().find((s) => up(s.getAttribute('name')) === up(name));
    return el ? relTarget(el.getAttributeNS(REL_NS, 'id') || el.getAttribute('r:id')) : null;
  };
  const docs = new Map();
  const sheetDoc = async (path) => {
    if (!docs.has(path)) docs.set(path, parse(await zip.file(path).async('string')));
    return docs.get(path);
  };
  const nextNum = (prefix) => {
    let n = 1;
    zip.forEach((p) => { const m = new RegExp(`^${prefix}(\\d+)\\.xml$`).exec(p); if (m) n = Math.max(n, Number(m[1]) + 1); });
    return n;
  };
  const addOverride = (part, type) => {
    const o = ctDoc.createElementNS(CT_NS, 'Override');
    o.setAttribute('PartName', `/${part}`);
    o.setAttribute('ContentType', type);
    ctDoc.documentElement.appendChild(o);
  };

  // A copy of a sheet as it is in the template (before any write), with
  // its own copy of the sheet's pictures, placed right after the last copy.
  const cloneSheet = async (baseName, newName, pristine, { atEnd = false } = {}) => {
    const base = sheetEls().find((s) => up(s.getAttribute('name')) === up(baseName));
    const basePath = sheetPath(baseName);
    const num = nextNum('xl/worksheets/sheet');
    const path = `xl/worksheets/sheet${num}.xml`;
    const doc = parse(pristine);
    Array.from(doc.getElementsByTagNameNS(MAIN_NS, 'sheetView')).forEach((v) => v.removeAttribute('tabSelected'));
    docs.set(path, doc);
    zip.file(path, '');
    addOverride(path, WORKSHEET_CT);
    const baseRels = zip.file(basePath.replace('worksheets/', 'worksheets/_rels/') + '.rels');
    if (baseRels) {
      const rels = parse(await baseRels.async('string'));
      for (const rel of Array.from(rels.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))) {
        const m = /drawings\/(drawing\d+)\.xml$/.exec(rel.getAttribute('Target') || '');
        if (!m) continue;
        const dn = nextNum('xl/drawings/drawing');
        const dPath = `xl/drawings/drawing${dn}.xml`;
        zip.file(dPath, await zip.file(`xl/drawings/${m[1]}.xml`).async('string'));
        const dRels = zip.file(`xl/drawings/_rels/${m[1]}.xml.rels`);
        if (dRels) zip.file(`xl/drawings/_rels/drawing${dn}.xml.rels`, await dRels.async('string'));
        addOverride(dPath, DRAWING_CT);
        rel.setAttribute('Target', `../drawings/drawing${dn}.xml`);
      }
      zip.file(`xl/worksheets/_rels/sheet${num}.xml.rels`, ser(rels));
    }
    const ids = Array.from(relsDoc.getElementsByTagNameNS(PKG_REL_NS, 'Relationship')).map((r) => Number(String(r.getAttribute('Id')).replace(/\D/g, '')) || 0);
    const rid = `rId${Math.max(0, ...ids) + 1}`;
    const rel = relsDoc.createElementNS(PKG_REL_NS, 'Relationship');
    rel.setAttribute('Id', rid);
    rel.setAttribute('Type', `${REL_NS}/worksheet`);
    rel.setAttribute('Target', `worksheets/sheet${num}.xml`);
    relsDoc.documentElement.appendChild(rel);
    const el = wbDoc.createElementNS(MAIN_NS, 'sheet');
    el.setAttribute('name', newName);
    el.setAttribute('sheetId', String(Math.max(0, ...sheetEls().map((s) => Number(s.getAttribute('sheetId')) || 0)) + 1));
    el.setAttributeNS(REL_NS, 'r:id', rid);
    if (atEnd) {
      // after every other sheet, before the hidden price list
      const prices = sheetEls().find((s) => up(s.getAttribute('name')) === SHEET_PRICES);
      base.parentNode.insertBefore(el, prices || null);
      return path;
    }
    let after = base;
    for (let k = 2; ; k++) {
      const next = sheetEls().find((s) => up(s.getAttribute('name')) === up(`${baseName} (${k})`));
      if (!next) break;
      after = next;
    }
    after.parentNode.insertBefore(el, after.nextSibling);
    return path;
  };

  // A sheet name Excel takes (31 characters, none of []:*?/\) that no sheet
  // has yet: "IKON PENGAWAS", then "IKON PENGAWAS (2)" ….
  const freshName = (want) => {
    const stem = String(want).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'SHEET';
    const taken = new Set(sheetEls().map((s) => up(s.getAttribute('name'))));
    for (let k = 1; ; k++) {
      const tail = k === 1 ? '' : ` (${k})`;
      const name = `${stem.slice(0, 31 - tail.length).trim()}${tail}`;
      if (!taken.has(up(name))) return name;
    }
  };

  // A cell written with a line break gets its style's "wrap text" copy, so
  // the break shows in Excel and WPS (Sean, 2026-10-17: "KUALITI2026").
  const stylesDoc = files.styles ? parse(files.styles) : null;
  const wrapped = new Map();
  const wrapStyle = (s) => {
    const idx = Number(s) || 0;
    if (wrapped.has(idx)) return wrapped.get(idx);
    const xfsEl = stylesDoc?.getElementsByTagNameNS(MAIN_NS, 'cellXfs')[0];
    const xfs = xfsEl ? Array.from(xfsEl.getElementsByTagNameNS(MAIN_NS, 'xf')) : [];
    const xf = xfs[idx];
    let out = idx;
    if (xf) {
      const align = Array.from(xf.getElementsByTagNameNS(MAIN_NS, 'alignment'))[0];
      if (align?.getAttribute('wrapText') !== '1') {
        const copy = xf.cloneNode(true);
        let a = Array.from(copy.getElementsByTagNameNS(MAIN_NS, 'alignment'))[0];
        if (!a) { a = stylesDoc.createElementNS(MAIN_NS, 'alignment'); copy.insertBefore(a, copy.firstChild); }
        a.setAttribute('wrapText', '1');
        copy.setAttribute('applyAlignment', '1');
        xfsEl.appendChild(copy);
        xfsEl.setAttribute('count', String(xfs.length + 1));
        out = xfs.length;
      }
    }
    wrapped.set(idx, out);
    return out;
  };

  const save = () => {
    docs.forEach((doc) => Array.from(doc.getElementsByTagNameNS(MAIN_NS, 'c'))
      .filter((c) => c.getAttribute('t') === 'inlineStr' && c.textContent.includes('\n'))
      .forEach((c) => {
        const s = wrapStyle(c.getAttribute('s'));
        if (s) c.setAttribute('s', String(s));
        // A fixed-height row shows only the first line ("ANUGERAH" of
        // "ANUGERAH / KECERIAAN KELAS TERBAIK"): tall enough for every line.
        const row = c.parentNode;
        const need = c.textContent.split('\n').length * 15 + 6;
        if (row && Number(row.getAttribute('ht')) < need) {
          row.setAttribute('ht', String(need));
          row.setAttribute('customHeight', '1');
        }
      }));
    if (stylesDoc && wrapped.size) zip.file('xl/styles.xml', ser(stylesDoc));
    docs.forEach((doc, path) => zip.file(path, ser(doc)));
    // Every total is recalculated when the file is opened; the old
    // calculation chain would point at cells that changed.
    let calc = wbDoc.getElementsByTagNameNS(MAIN_NS, 'calcPr')[0];
    if (!calc) {
      calc = wbDoc.createElementNS(MAIN_NS, 'calcPr');
      const ext = wbDoc.getElementsByTagNameNS(MAIN_NS, 'extLst')[0];
      wbDoc.documentElement.insertBefore(calc, ext || null);
    }
    calc.setAttribute('fullCalcOnLoad', '1');
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      Array.from(relsDoc.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))
        .filter((r) => /calcChain/.test(r.getAttribute('Target') || '')).forEach((r) => r.parentNode.removeChild(r));
      Array.from(ctDoc.getElementsByTagNameNS(CT_NS, 'Override'))
        .filter((o) => /calcChain/.test(o.getAttribute('PartName') || '')).forEach((o) => o.parentNode.removeChild(o));
    }
    zip.file('xl/workbook.xml', ser(wbDoc));
    zip.file('xl/_rels/workbook.xml.rels', ser(relsDoc));
    zip.file('[Content_Types].xml', ser(ctDoc));
  };

  // Hides every sheet not named in `keep` (upper-cased names); the first
  // sheet still showing opens selected.
  const showOnly = async (keep) => {
    const els = sheetEls();
    els.forEach((el) => { if (!keep.has(up(el.getAttribute('name')))) el.setAttribute('state', 'hidden'); });
    const first = els.findIndex((el) => el.getAttribute('state') !== 'hidden');
    if (first < 0) return;
    for (const [i, el] of els.entries()) {
      const doc = await sheetDoc(relTarget(el.getAttributeNS(REL_NS, 'id') || el.getAttribute('r:id')));
      Array.from(doc.getElementsByTagNameNS(MAIN_NS, 'sheetView')).forEach((v) => {
        if (i === first) v.setAttribute('tabSelected', '1');
        else v.removeAttribute('tabSelected');
      });
    }
    Array.from(wbDoc.getElementsByTagNameNS(MAIN_NS, 'workbookView')).forEach((v) => {
      v.setAttribute('activeTab', String(first));
      v.setAttribute('firstSheet', String(first));
    });
  };

  return { sheetPath, sheetDoc, cloneSheet, freshName, showOnly, save };
}

const colNum = (ref) => XLSX.utils.decode_cell(ref).c;

// Write one cell (string, number, or '' to empty it), keeping its style.
function setCell(doc, ref, value) {
  const { r } = XLSX.utils.decode_cell(ref);
  const sheetData = doc.getElementsByTagNameNS(MAIN_NS, 'sheetData')[0];
  const rowNum = r + 1;
  let row = Array.from(sheetData.getElementsByTagNameNS(MAIN_NS, 'row')).find((x) => Number(x.getAttribute('r')) === rowNum);
  if (!row) {
    row = doc.createElementNS(MAIN_NS, 'row');
    row.setAttribute('r', String(rowNum));
    const after = Array.from(sheetData.getElementsByTagNameNS(MAIN_NS, 'row')).find((x) => Number(x.getAttribute('r')) > rowNum);
    sheetData.insertBefore(row, after || null);
  }
  const cells = Array.from(row.getElementsByTagNameNS(MAIN_NS, 'c'));
  let c = cells.find((x) => x.getAttribute('r') === ref);
  if (!c) {
    c = doc.createElementNS(MAIN_NS, 'c');
    c.setAttribute('r', ref);
    row.insertBefore(c, cells.find((x) => colNum(x.getAttribute('r')) > colNum(ref)) || null);
  }
  while (c.firstChild) c.removeChild(c.firstChild);
  c.removeAttribute('t');
  if (value === '' || value == null) return;
  if (typeof value === 'number') {
    const v = doc.createElementNS(MAIN_NS, 'v');
    v.appendChild(doc.createTextNode(String(value)));
    c.appendChild(v);
    return;
  }
  c.setAttribute('t', 'inlineStr');
  const is = doc.createElementNS(MAIN_NS, 'is');
  const t = doc.createElementNS(MAIN_NS, 't');
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(doc.createTextNode(String(value)));
  is.appendChild(t);
  c.appendChild(is);
}

// Rewrites the cell references in a formula or range that point at this
// sheet: `fn(col, colAbs, row, rowAbs)` returns the new reference. Text in
// quotes and references to another sheet ('SENARAI PLAK'!$A$2) are kept.
const mapRefs = (text, fn) => text.replace(
  /"[^"]*"|(?:'[^']*'|[A-Za-z_][\w.]*)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g,
  (m, ca, col, ra, row) => (col ? fn(col, ca, Number(row), ra) : m),
);
// A copied row's own formulas: references to row `from` move to `to`
// (absolute rows stay).
const moveRow = (text, from, to) => mapRefs(text, (col, ca, row, ra) => `${ca}${col}${ra}${!ra && row === from ? to : row}`);

// Adds `n` rows to a list just above its TOTAL row (1-based `totalRow`):
// each a copy of the last list row (styles, formulas, Jenis Plak dropdown,
// conditional format), the TOTAL row and everything under it pushed down,
// and every range that ended on the last list row (the TOTAL's SUM, the
// dropdown) stretched over the new rows.
function insertListRows(doc, totalRow, n) {
  if (n <= 0) return;
  const last = totalRow - 1;
  const sheetData = doc.getElementsByTagNameNS(MAIN_NS, 'sheetData')[0];
  const rows = Array.from(sheetData.getElementsByTagNameNS(MAIN_NS, 'row'));
  const shift = (text) => mapRefs(text, (col, ca, row, ra) => `${ca}${col}${ra}${row >= totalRow ? row + n : row}`);
  // A list range (D7:D17 — or the template's H7:H16, one short) grows to
  // the new last row.
  const stretch = (text) => text.replace(/(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)/g, (m, c1, r1, c2, r2) => (
    Number(r1) < last && (Number(r2) === last || Number(r2) === last - 1) ? `${c1}${r1}:${c2}${last + n}` : m));
  // Shared formulas (H7:H17's IFERROR(G7*D7,0)): a copied row gets the
  // master's formula written out for its own row.
  const masters = new Map();
  rows.forEach((row) => Array.from(row.getElementsByTagNameNS(MAIN_NS, 'f')).forEach((f) => {
    if (f.getAttribute('t') === 'shared' && f.textContent) masters.set(f.getAttribute('si'), { text: f.textContent, row: Number(row.getAttribute('r')) });
  }));
  rows.filter((row) => Number(row.getAttribute('r')) >= totalRow).reverse().forEach((row) => {
    row.setAttribute('r', String(Number(row.getAttribute('r')) + n));
    Array.from(row.getElementsByTagNameNS(MAIN_NS, 'c')).forEach((c) => {
      c.setAttribute('r', shift(c.getAttribute('r')));
      Array.from(c.getElementsByTagNameNS(MAIN_NS, 'f')).forEach((f) => { f.textContent = stretch(shift(f.textContent)); });
    });
  });
  const model = rows.find((row) => Number(row.getAttribute('r')) === last);
  const before = rows.find((row) => Number(row.getAttribute('r')) >= totalRow) || null;
  for (let i = 1; i <= n; i++) {
    const r = last + i;
    const copy = model.cloneNode(true);
    copy.setAttribute('r', String(r));
    Array.from(copy.getElementsByTagNameNS(MAIN_NS, 'c')).forEach((c) => {
      c.setAttribute('r', c.getAttribute('r').replace(/\d+$/, String(r)));
      Array.from(c.getElementsByTagNameNS(MAIN_NS, 'f')).forEach((f) => {
        const master = f.getAttribute('t') === 'shared' ? masters.get(f.getAttribute('si')) : null;
        const text = master ? moveRow(master.text, master.row, r) : moveRow(f.textContent, last, r);
        Array.from(f.attributes).map((a) => a.name).forEach((a) => f.removeAttribute(a));
        f.textContent = text;
      });
    });
    sheetData.insertBefore(copy, before);
  }
  const root = doc.documentElement;
  const dim = root.getElementsByTagNameNS(MAIN_NS, 'dimension')[0];
  if (dim) dim.setAttribute('ref', shift(dim.getAttribute('ref')));
  Array.from(root.getElementsByTagNameNS(MAIN_NS, 'mergeCell')).forEach((m) => m.setAttribute('ref', shift(m.getAttribute('ref'))));
  Array.from(root.getElementsByTagNameNS(MAIN_NS, 'dataValidation')).forEach((v) => v.setAttribute('sqref', stretch(shift(v.getAttribute('sqref')))));
  const cfs = Array.from(root.getElementsByTagNameNS(MAIN_NS, 'conditionalFormatting'));
  let priority = Math.max(0, ...Array.from(root.getElementsByTagNameNS(MAIN_NS, 'cfRule')).map((x) => Number(x.getAttribute('priority')) || 0));
  cfs.forEach((cf) => {
    const sq = cf.getAttribute('sqref');
    const one = /^([A-Z]{1,3})(\d+)$/.exec(sq);
    if (one && Number(one[2]) === last) {
      let at = cf;
      for (let i = 1; i <= n; i++) {
        const copy = cf.cloneNode(true);
        copy.setAttribute('sqref', `${one[1]}${last + i}`);
        Array.from(copy.getElementsByTagNameNS(MAIN_NS, 'cfRule')).forEach((rule) => rule.setAttribute('priority', String(++priority)));
        Array.from(copy.getElementsByTagNameNS(MAIN_NS, 'formula')).forEach((f) => { f.textContent = moveRow(f.textContent, last, last + i); });
        at.parentNode.insertBefore(copy, at.nextSibling);
        at = copy;
      }
    } else {
      cf.setAttribute('sqref', stretch(shift(sq)));
      Array.from(cf.getElementsByTagNameNS(MAIN_NS, 'formula')).forEach((f) => { f.textContent = shift(f.textContent); });
    }
  });
}

// ---------------------------------------------------------------------------

// The template's own sample subjects (BAHASA MELAYU, BAHASA CINA …) in
// the SUBJEK rows this order doesn't use are emptied, so no row reads as
// an award nobody ordered.
function clearUnusedSubjects(doc, ws, layout, used) {
  layout.awardRows.slice(used).forEach((r) => {
    if (textAt(ws, r, layout.subjekCol) && !ws[addr(r, layout.subjekCol)]?.f) setCell(doc, addr(r, layout.subjekCol), '');
  });
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const sheetName = (base, k) => (k === 0 ? base : `${base} (${k + 1})`.slice(0, 31));

// Tabs of their own with the same Reference Sample — the same TAJUK BESAR and
// last line, the same MERAH line — that each hold one plaque wording, differing
// only in the award (and the line under it), share one ORDER LAIN-LAIN sheet, a
// row per award, named after the first (Sean, 2026-10-21: a Word list of 38
// awards was 38 sheets). An award starting TOKOH among them stays a row too.
// Word / PDF / ORDER LAIN-LAIN tabs only; tabs with their own sheet format
// (TOKOH, MP THP …) and class lists keep their own sheets.
const LIST_KINDS = ['KLAS_MATRIX', 'UMUM'];
function sampleKey(plaques) {
  if (!plaques.every((p) => LIST_KINDS.includes(p.kind))) return null;
  if (new Set(plaques.map((p) => `${p.award}\u0000${p.line}\u0000${p.eline2}`)).size !== 1) return null;
  const p = plaques[0];
  // the award (①) is the varying line: only a red line below it must match
  const red = umumDefaultRedSlot({ 1: p.award, 2: p.line, 3: p.eline2 });
  return `${p.heading}\u0000${p.eline2}\u0000${red === '1' ? '' : red}`;
}
export function mergeSameSampleTabs(groups) {
  const byKey = new Map();
  groups.forEach(([tab, plaques]) => {
    const key = tab && sampleKey(plaques);
    if (key) byKey.set(key, [...(byKey.get(key) || []), tab]);
  });
  const into = new Map();
  byKey.forEach((tabs) => { if (tabs.length > 1) tabs.forEach((t) => into.set(t, tabs[0])); });
  const out = new Map();
  groups.forEach(([tab, plaques]) => {
    const target = into.get(tab) ?? tab;
    const rows = into.has(tab) ? plaques.map((p) => ({ ...p, oneSheet: true })) : plaques;
    out.set(target, [...(out.get(target) || []), ...rows]);
  });
  return [...out];
}

// Fills a copy of the blank template. Returns { buffer, notes, placed,
// sheets } where `placed` counts plaques per sheet and `sheets` names (in
// capitals) the ones left showing; never throws on an order it
// can't place (that part goes to the notes instead).
export async function fillOrderTemplate(templateBuffer, categorized, {
  DOMParser: DP = globalThis.DOMParser, XMLSerializer: XS = globalThis.XMLSerializer,
} = {}) {
  // A tab of its own on the website (IKON PENGAWAS, …) gets sheets named
  // after it, in the format of the sheet its plaques fit (TOKOH, MP THP …;
  // Sean, 2026-10-19); the other tabs fill the template's own sheets.
  const groups = new Map([['', []]]);
  (Array.isArray(categorized?.plaques) ? categorized.plaques : []).forEach((p) => {
    const tab = String(p.tab || '').trim();
    if (!groups.has(tab)) groups.set(tab, []);
    groups.get(tab).push(p);
  });
  const plans = Array.isArray(categorized?.plaques)
    ? mergeSameSampleTabs([...groups].filter(([, plaques]) => plaques.length)).map(([tab, plaques]) => ({ tab, plan: planTemplateFill({ plaques }) }))
    : [{ tab: '', plan: planTemplateFill(categorized) }];
  const notes = plans.flatMap(({ plan }) => plan.notes);
  const placed = {};
  const zip = await JSZip.loadAsync(templateBuffer);
  const wb = XLSX.read(templateBuffer, { type: 'array', cellFormula: true });
  const findName = (names) => wb.SheetNames.find((n) => (Array.isArray(names) ? names : [names]).some((x) => up(x) === up(n)));
  const book = makeBook(zip, {
    workbook: await zip.file('xl/workbook.xml').async('string'),
    workbookRels: await zip.file('xl/_rels/workbook.xml.rels').async('string'),
    contentTypes: await zip.file('[Content_Types].xml').async('string'),
    styles: await zip.file('xl/styles.xml')?.async('string'),
  }, { DOMParser: DP, XMLSerializer: XS });

  const pristine = new Map();
  const used = new Map();
  const filled = new Set();
  let tab = '';
  const tabSheets = [];
  // The k-th copy of a template sheet (k = 0: the sheet itself); for a tab
  // of its own, a new copy named after the tab.
  const sheetCopy = async (base) => {
    const path = book.sheetPath(base);
    if (!pristine.has(base)) pristine.set(base, await zip.file(path).async('string'));
    if (tab) {
      const name = book.freshName(tab);
      const p = await book.cloneSheet(base, name, pristine.get(base), { atEnd: true });
      filled.add(up(name));
      tabSheets.push(name);
      return { doc: await book.sheetDoc(p), name };
    }
    const k = used.get(base) || 0;
    used.set(base, k + 1);
    const p = k === 0 ? path : await book.cloneSheet(base, sheetName(base, k), pristine.get(base));
    filled.add(up(sheetName(base, k)));
    return { doc: await book.sheetDoc(p), name: sheetName(base, k) };
  };
  const count = (name, n) => { placed[name] = (placed[name] || 0) + n; };
  for (const group of plans) {
    const { plan } = group;
    tab = group.tab;
    const umumExtra = [];

    // MP THP 1 / 2 (Kalau ada kelas)
    for (const g of plan.mp) {
      const base = findName(g.band === 1 ? SHEET_MP1 : SHEET_MP2);
      const layout = base && layoutMp(wb.Sheets[base]);
      const yearsOk = layout && [...g.years.keys()].every((y) => layout.blocks.has(y));
      const classesOk = layout && [...g.years.values()].every((list) => list.length <= layout.classRows);
      if (!layout || !yearsOk || !classesOk || !layout.awardRows.length) {
        notes.push(`The ${g.band === 1 ? 'Tahun 1-3' : 'Tahun 4-6'} class awards (${g.code || 'no code'}) don't fit the ${base || 'MP THP (Kalau ada kelas)'} sheet, so they went to ORDER LAIN-LAIN.`);
        g.awards.forEach((award) => g.years.forEach((list, year) => list.forEach(({ kelas, qty }) => umumExtra.push({ heading: g.heading, award, line: `${year} ${kelas}`, eline2: '', qty, code: g.code }))));
        continue;
      }
      for (const awards of chunk(g.awards, layout.awardRows.length)) {
        const { doc, name } = await sheetCopy(base);
        if (layout.title && g.heading) setCell(doc, layout.title.heading, g.heading);
        if (layout.title) setCell(doc, layout.title.sample, g.sample.join('\n'));
        if (layout.plak && g.code) setCell(doc, layout.plak, g.code);
        let n = 0;
        const perYear = new Map();
        g.years.forEach((list, year) => {
          const b = layout.blocks.get(year);
          list.forEach(({ kelas, qty }, i) => {
            setCell(doc, addr(layout.dataRow + i, b.nameCol), kelas);
            setCell(doc, addr(layout.dataRow + i, b.qtyCol), qty);
            n += qty;
          });
          perYear.set(year, list.reduce((a, x) => a + x.qty, 0));
        });
        // Each award's count per Tahun is written as a number (the template's
        // own SUM gives the same), so the file reads right even before Excel
        // recalculates it, and a Tahun this order doesn't have stays empty.
        awards.forEach((a, i) => {
          const r = layout.awardRows[i];
          setCell(doc, addr(r, layout.subjekCol), a);
          layout.levelCols.forEach((col, year) => setCell(doc, addr(r, col), perYear.get(year) || ''));
        });
        clearUnusedSubjects(doc, wb.Sheets[base], layout, awards.length);
        count(name, n * awards.length);
      }
    }

    // PPKI
    for (const g of plan.ppki) {
      const base = findName(SHEET_PPKI);
      const layout = base && layoutPpki(wb.Sheets[base]);
      if (!layout || g.levels.length > layout.classRows || !layout.awardRows.length) {
        notes.push(`The PPKI awards (${g.code || 'no code'}) don't fit the PPKI sheet, so they went to ORDER LAIN-LAIN.`);
        g.awards.forEach((award) => g.levels.forEach(({ label, qty }) => umumExtra.push({ heading: g.heading, award, line: `${label} PPKI`, eline2: '', qty, code: g.code })));
        continue;
      }
      for (const awards of chunk(g.awards, layout.awardRows.length)) {
        const { doc, name } = await sheetCopy(base);
        if (layout.title && g.heading) setCell(doc, layout.title.heading, g.heading);
        if (layout.title) setCell(doc, layout.title.sample, g.sample.join('\n'));
        if (layout.plak && g.code) setCell(doc, layout.plak, g.code);
        const perAward = g.levels.reduce((a, l) => a + l.qty, 0);
        awards.forEach((a, i) => {
          setCell(doc, addr(layout.awardRows[i], layout.subjekCol), a);
          if (layout.levelCol != null) setCell(doc, addr(layout.awardRows[i], layout.levelCol), perAward);
        });
        clearUnusedSubjects(doc, wb.Sheets[base], layout, awards.length);
        g.levels.forEach(({ label, qty }, i) => {
          setCell(doc, addr(layout.dataRow + i, layout.nameCol), label);
          setCell(doc, addr(layout.dataRow + i, layout.qtyCol), qty);
        });
        count(name, g.levels.reduce((a, l) => a + l.qty, 0) * awards.length);
      }
    }

    const toExtra = (items) => umumExtra.push(...items.map(({ heading, award, line, eline2, qty, code }) => ({ heading, award, line, eline2, qty, code })));
    const writeTitle = (doc, at, lines) => at && lines.forEach((text, i) => setCell(doc, at(i), text));

    // MP THP 1 / MP THP 2: subjects down the SUBJEK column (the template's
    // own row for a subject it lists, else the next empty row), the count
    // under each Tahun.
    for (const g of plan.mpPlain) {
      const base = findName(SHEET_MP_PLAIN[g.band]);
      const ws = base && wb.Sheets[base];
      const layout = ws && layoutMp(ws);
      const years = new Set([...g.subjects.values()].flatMap((m) => [...m.keys()]));
      const listed = new Map();
      const free = [];
      (layout?.awardRows || []).forEach((r) => {
        const t = textAt(ws, r, layout.subjekCol);
        if (!t) free.push(r);
        else if (!listed.has(t)) listed.set(t, r);
      });
      const subjects = [...g.subjects.keys()];
      const fits = layout && [...years].every((y) => layout.levelCols.has(y))
        && subjects.filter((x) => !listed.has(x)).length <= free.length;
      if (!fits) {
        notes.push(`The ${g.award || 'subject'} plaques (${g.code || 'no code'}) don't fit the ${base || SHEET_MP_PLAIN[g.band]} sheet, so they went to ORDER LAIN-LAIN.`);
        toExtra(g.items);
        continue;
      }
      const { doc, name } = await sheetCopy(base);
      writeTitle(doc, titleRows(ws), [g.heading, g.award, ...g.sample]);
      if (layout.plak && g.code) setCell(doc, layout.plak, g.code);
      let n = 0;
      subjects.forEach((subject) => {
        const r = listed.get(subject) ?? free.shift();
        setCell(doc, addr(r, layout.subjekCol), subject);
        g.subjects.get(subject).forEach((qty, year) => { setCell(doc, addr(r, layout.levelCols.get(year)), qty); n += qty; });
      });
      count(name, n);
    }

    // LONJAKAN SAUJANA / KEHADIRAN PENUH: each Tahun on its own row; another
    // line ("TAHAP 1") in an empty row below them.
    for (const [g, sheet] of [[plan.lonjakan, SHEET_LONJAKAN], [plan.kehadiran, SHEET_KEHADIRAN]]) {
      if (!g) continue;
      const base = findName(sheet);
      const ws = base && wb.Sheets[base];
      const layout = ws && layoutList(ws, 'TAHUN');
      if (!layout) {
        notes.push(`This template has no ${sheet} sheet, so those plaques went to ORDER LAIN-LAIN.`);
        toExtra(g.rows.map((x) => ({ heading: g.heading, award: g.award, line: x.label, eline2: '', qty: x.qty, code: x.code })));
        continue;
      }
      const { doc, name } = await sheetCopy(base);
      writeTitle(doc, layout.title, [g.heading, g.award, g.rows[0].label]);
      const taken = new Set();
      let n = 0;
      g.rows.forEach((x) => {
        const label = up(x.label);
        const slot = (TAHUN_RE.test(label) && layout.rows.find((row) => row.label === label && !taken.has(row.r)))
          || layout.rows.find((row) => !row.label && !taken.has(row.r));
        if (!slot) {
          toExtra([{ heading: g.heading, award: g.award, line: x.label, eline2: '', qty: x.qty, code: x.code }]);
          return;
        }
        taken.add(slot.r);
        if (!slot.label && label) setCell(doc, addr(slot.r, layout.labelCol), label);
        setCell(doc, addr(slot.r, layout.qtyCol), x.qty);
        if (x.code) setCell(doc, addr(slot.r, layout.plakCol), x.code);
        n += x.qty;
      });
      count(name, n);
    }

    // TOKOH: one honour per row; the template's sample honours this order
    // doesn't have are emptied.
    if (plan.tokoh) {
      const base = findName(SHEET_TOKOH);
      const ws = base && wb.Sheets[base];
      const layout = ws && layoutList(ws, 'TOKOH');
      const rowsOf = layout ? layout.rows : [];
      // More honours than the sheet has rows: rows are added above its TOTAL.
      if (!rowsOf.length) {
        notes.push(`${plan.tokoh.rows.length} TOKOH award(s) didn't fit the ${base || SHEET_TOKOH} sheet, so they went to ORDER LAIN-LAIN.`);
        toExtra(plan.tokoh.rows.map((x) => ({ heading: plan.tokoh.heading, award: x.name, line: x.nama, eline2: '', qty: x.qty, code: x.code })));
      } else {
        const fit = plan.tokoh.rows;
        const { doc, name } = await sheetCopy(base);
        const slots = [...rowsOf];
        const extra = fit.length - slots.length;
        if (extra > 0) {
          // slots[].r is 0-based: the TOTAL row is two Excel rows past it.
          const lastRow = slots[slots.length - 1].r;
          insertListRows(doc, lastRow + 2, extra);
          for (let i = 1; i <= extra; i++) slots.push({ r: lastRow + i, label: '' });
        }
        // The line under the award (LELAKI / TAHAP 1) is the NAMA MURID, and
        // the CONTOH's ③ NAMA line (Sean, 2026-10-17). A blank NAMA MURID
        // engraves the CONTOH's ③, so an honour with no such line gets "-"
        // (no line) once ③ is filled.
        const namaCol = layout.namaCol;
        const sample = namaCol != null ? fit.find((x) => x.nama) : null;
        writeTitle(doc, layout.title, [plan.tokoh.heading, (sample || fit[0]).name, sample ? sample.nama : '']);
        slots.forEach(({ r, label }, i) => {
          const x = fit[i];
          if (!x) { if (label) setCell(doc, addr(r, layout.labelCol), ''); return; }
          const together = namaCol == null && x.nama;
          setCell(doc, addr(r, layout.labelCol), together ? `${x.name}\n${x.nama}` : x.name);
          if (namaCol != null && (x.nama || sample)) setCell(doc, addr(r, namaCol), x.nama || '-');
          setCell(doc, addr(r, layout.qtyCol), x.qty);
          if (x.code) setCell(doc, addr(r, layout.plakCol), x.code);
        });
        count(name, fit.reduce((a, x) => a + x.qty, 0));
      }
    }

    // ORDER LAIN-LAIN: one row per plaque wording.
    const rows = [...plan.umum, ...umumExtra];
    if (rows.length) {
      const base = findName(SHEET_UMUM);
      const layout = base && layoutUmum(wb.Sheets[base]);
      if (!layout || !layout.rows.length) {
        notes.push(`${rows.length} plaque wording(s) need the ORDER LAIN-LAIN sheet, which this template doesn't have — please add them by hand.`);
      } else {
        const heading = rows.find((r) => r.heading)?.heading || '';
        for (const part of chunk(rows, layout.rows.length)) {
          const { doc, name } = await sheetCopy(base);
          if (layout.contoh.l0 && heading) setCell(doc, layout.contoh.l0, heading);
          // ② the award, ③ its TAHUN / TAHAP line, ④ the line under that
          // (Sean, 2026-10-17: each on its own line of the plaque).
          const contoh = { l1: part[0].award, l2: part[0].line, l3: part[0].eline2 };
          ['l1', 'l2', 'l3'].forEach((k) => layout.contoh[k] && setCell(doc, layout.contoh[k], contoh[k]));
          // A place line (PERTAMA …), else an ANUGERAH line, is red unless
          // the form says otherwise.
          const red = umumDefaultRedSlot({ 1: contoh.l1, 2: contoh.l2, 3: contoh.l3 });
          if (red && layout.merah[red]) setCell(doc, layout.merah[red], 'MERAH');
          part.forEach((p, i) => {
            const r = layout.rows[i];
            // ① blank = the CONTOH heading; a plaque with another heading
            // carries its own.
            if (layout.cols.l0 != null && p.heading && p.heading !== heading) setCell(doc, addr(r, layout.cols.l0), p.heading);
            // A blank line would mean "same as CONTOH": "-" is the form's
            // "no such line". A form without the ③ / ④ columns keeps the
            // lines together in ②.
            const own = layout.cols.l2 != null && layout.cols.l3 != null
              ? { l1: p.award, l2: p.line, l3: p.eline2 }
              : { l1: [p.award, p.line, p.eline2].filter(Boolean).join('\n'), l2: '', l3: '' };
            ['l1', 'l2', 'l3'].forEach((k) => {
              if (layout.cols[k] == null) return;
              setCell(doc, addr(r, layout.cols[k]), own[k] || (k === 'l1' || (layout.contoh[k] && contoh[k]) ? '-' : ''));
            });
            setCell(doc, addr(r, layout.cols.qty), p.qty);
            if (p.code) setCell(doc, addr(r, layout.cols.plak), p.code);
          });
          count(name, part.reduce((a, p) => a + p.qty, 0));
        }
      }
    }
  }
  tab = '';

  // SELEMPANG: ACARA / WARNA / KUANTITI, one row each.
  const sashes = (categorized?.selempang || []).filter((x) => Number(x.qty) > 0 || x.acara);
  if (sashes.length) {
    const base = findName(SHEET_SELEMPANG);
    const layout = base && layoutSelempang(wb.Sheets[base]);
    if (!layout) notes.push(`This template has no SELEMPANG sheet — please add the ${sashes.length} selempang row(s) by hand.`);
    else {
      const { doc } = await sheetCopy(base);
      sashes.forEach((x, i) => {
        const r = layout.firstRow + i;
        setCell(doc, addr(r, layout.acaraCol), up(x.acara));
        setCell(doc, addr(r, layout.warnaCol), up(x.warna));
        if (Number(x.qty) > 0) setCell(doc, addr(r, layout.qtyCol), Number(x.qty));
      });
      notes.push(`${sashes.length} selempang row(s) written into SELEMPANG.`);
    }
  }

  // FRONT PG: who the order is from, and the Remark, beside each label.
  const front = categorized?.front;
  const frontName = front && findName(SHEET_FRONT);
  if (frontName) {
    const ws = wb.Sheets[frontName];
    const fields = [[/^SALES\s*:/, front.sales], [/^SEKOLAH\s*:/, front.sekolah], [/^CIKGU\s*\/\s*NO\.?\s*TEL\s*:/, front.cikgu], [/^REMARK\s*:/, front.remark]]
      .filter(([, value]) => String(value || '').trim());
    if (fields.length) {
      const { doc } = await sheetCopy(frontName);
      fields.forEach(([re, value]) => {
        const at = findCells(ws, '', (t) => re.test(t))[0];
        if (at) setCell(doc, addr(at.r, at.c + 1), String(value).trim().toUpperCase());
      });
    }
  }

  // SENARAI PLAK: every code's HARGA from the website's catalog, so each
  // sheet's price lookup matches what the cart charges.
  const priceOf = categorized?.priceOf;
  const priceName = findName(SHEET_PRICES);
  if (typeof priceOf === 'function' && priceName) {
    const ws = wb.Sheets[priceName];
    const head = findCells(ws, 'JENIS PLAK')[0];
    const harga = head && findCells(ws, '', (t) => /^HARGA/.test(t)).find((p) => p.r === head.r);
    if (harga) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      const listed = new Set();
      const changes = [];
      for (let r = head.r + 1; r <= range.e.r; r++) {
        const code = textAt(ws, r, head.c);
        if (!code) continue;
        listed.add(code);
        const price = priceOf(code);
        if (price != null && price !== ws[addr(r, harga.c)]?.v) changes.push([addr(r, harga.c), price]);
      }
      if (changes.length) {
        const { doc } = await sheetCopy(priceName);
        changes.forEach(([ref, price]) => setCell(doc, ref, price));
      }
      const missing = [...new Set(plans.flatMap(({ plan }) => plan.allCodes))].filter((c) => !listed.has(up(c)));
      if (missing.length) notes.push(`Not in the form's price list (SENARAI PLAK), so their HARGA is blank: ${missing.join(', ')}.`);
    }
  }

  const copies = [...used].filter(([, k]) => k > 1).map(([b, k]) => `${b} (${k - 1} extra)`);
  if (copies.length) notes.push(`Extra copies of ${copies.join(', ')} were added; FRONT PG's totals don't include them.`);
  if (tabSheets.length) notes.push(`Sheets for the order's own tabs (${tabSheets.join(', ')}) were added; FRONT PG's totals don't include them.`);
  // Only FRONT PG and the sheets the order filled show; the empty ones are
  // hidden (Sean, 2026-10-19), not deleted, so they can still be unhidden.
  const frontPg = findName(SHEET_FRONT);
  if (frontPg) filled.add(up(frontPg));
  await book.showOnly(filled);
  book.save();
  const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { buffer, notes, placed, sheets: [...filled], plaqueCount: plans.reduce((a, { plan }) => a + plan.plaqueCount, 0) };
}
