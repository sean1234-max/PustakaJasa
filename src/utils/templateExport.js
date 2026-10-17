import JSZip from 'jszip';
import * as XLSX from 'xlsx';

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
// breaks in a heading are kept.
function plaquesOf(categorized) {
  const caps = (p) => ({ ...p, heading: String(p.heading ?? '').toUpperCase(), award: String(p.award ?? '').toUpperCase(), line: String(p.line ?? '').toUpperCase(), eline2: String(p.eline2 ?? '').toUpperCase() });
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
  plaques.forEach((p) => {
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

  return { mp, ppki, umum, notes, plaqueCount: plaques.reduce((a, p) => a + p.qty, 0) };
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
  const contoh = {};
  ['①', '②', '③', '④'].forEach((mark, i) => {
    const p = findCells(ws, mark).find((q) => q.r < no.r && q.c === no.c);
    if (p) contoh[`l${i}`] = addr(p.r, p.c + 1);
  });
  return { rows, cols, contoh };
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
  const cloneSheet = async (baseName, newName, pristine) => {
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
    let after = base;
    for (let k = 2; ; k++) {
      const next = sheetEls().find((s) => up(s.getAttribute('name')) === up(`${baseName} (${k})`));
      if (!next) break;
      after = next;
    }
    after.parentNode.insertBefore(el, after.nextSibling);
    return path;
  };

  const save = () => {
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

  return { sheetPath, sheetDoc, cloneSheet, save };
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

// Fills a copy of the blank template. Returns { buffer, notes, placed }
// where `placed` counts plaques per sheet; never throws on an order it
// can't place (that part goes to the notes instead).
export async function fillOrderTemplate(templateBuffer, categorized, {
  DOMParser: DP = globalThis.DOMParser, XMLSerializer: XS = globalThis.XMLSerializer,
} = {}) {
  const plan = planTemplateFill(categorized);
  const notes = [...plan.notes];
  const placed = {};
  const zip = await JSZip.loadAsync(templateBuffer);
  const wb = XLSX.read(templateBuffer, { type: 'array', cellFormula: true });
  const findName = (names) => wb.SheetNames.find((n) => (Array.isArray(names) ? names : [names]).some((x) => up(x) === up(n)));
  const book = makeBook(zip, {
    workbook: await zip.file('xl/workbook.xml').async('string'),
    workbookRels: await zip.file('xl/_rels/workbook.xml.rels').async('string'),
    contentTypes: await zip.file('[Content_Types].xml').async('string'),
  }, { DOMParser: DP, XMLSerializer: XS });

  const pristine = new Map();
  const used = new Map();
  // The k-th copy of a template sheet (k = 0: the sheet itself).
  const sheetCopy = async (base) => {
    const k = used.get(base) || 0;
    used.set(base, k + 1);
    const path = book.sheetPath(base);
    if (!pristine.has(base)) pristine.set(base, await zip.file(path).async('string'));
    const p = k === 0 ? path : await book.cloneSheet(base, sheetName(base, k), pristine.get(base));
    return { doc: await book.sheetDoc(p), name: sheetName(base, k) };
  };
  const count = (name, n) => { placed[name] = (placed[name] || 0) + n; };
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
        if (layout.contoh.l1) setCell(doc, layout.contoh.l1, [part[0].award, part[0].line].filter(Boolean).join('\n'));
        part.forEach((p, i) => {
          const r = layout.rows[i];
          // ① blank = the CONTOH heading; a plaque with another heading
          // carries its own.
          if (layout.cols.l0 != null && p.heading && p.heading !== heading) setCell(doc, addr(r, layout.cols.l0), p.heading);
          setCell(doc, addr(r, layout.cols.l1), [p.award, p.line, p.eline2].filter(Boolean).join('\n'));
          setCell(doc, addr(r, layout.cols.qty), p.qty);
          if (p.code) setCell(doc, addr(r, layout.cols.plak), p.code);
        });
        count(name, part.reduce((a, p) => a + p.qty, 0));
      }
    }
  }

  const copies = [...used].filter(([, k]) => k > 1).map(([b, k]) => `${b} (${k - 1} extra)`);
  if (copies.length) notes.push(`Extra copies of ${copies.join(', ')} were added; FRONT PG's totals don't include them.`);
  book.save();
  const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { buffer, notes, placed, plaqueCount: plan.plaqueCount };
}
