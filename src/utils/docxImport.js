import JSZip from 'jszip';
import { makeDynamicCategoryKey } from '../data/catalog';

// A second real-world order shape, completely different from any Excel
// template: a Word table with one row per plaque (or per set of plaques).
// Two header layouts are read, both by their own header labels, never by
// column position:
//   BIL | WORDING | KUANTITI | KOD HADIAH | WARNA
//     The WORDING cell is 1-3 lines stacked on top of each other (a real
//     Word line break inside the cell) — e.g.
//       ANUGERAH KEDUDUKAN KELAS
//       TAHUN 1 UTHMAN
//       TEMPAT PERTAMA
//   NO. | KOD HADIAH | LABEL | BILANGAN | CATATAN
//     The LABEL cell is the award wording, BILANGAN is "30 SET", and
//     KOD HADIAH is "CODE: 19540 B RM 33" (prefix and price are noise).
// Several consecutive rows commonly share the same award title and the same
// Tahun/Nama Kelas, differing only in their own third line (TEMPAT KEDUA,
// KETIGA, ...) — those really are ONE class's several award "columns", the
// same shape a KLAS_MATRIX-style block models as one class row with
// several subject columns. A long award list is often split across several
// Word tables purely by a page break — rows are grouped by the award title
// text (line 1), not by table boundaries.
//
// Each award (title + plaque code) becomes its OWN dynamic category
// (catalog.js's makeDynamicCategoryKey('KLAS_MATRIX', title)) — the same
// route excelImport.js uses for a renamed PPKI/MP-THP-shaped sheet. The
// retired KLAS_MATRIX catch-all itself is never used: anything landing
// there is skipped (AppState.jsx), which is why .docx uploads used to read
// nothing at all.
//
// Wording is copied exactly as typed. Anything the parser can't place with
// certainty (a quantity it can't read, a row with a quantity but no
// wording, a JUMLAH/TOTAL row that disagrees with the rows above it) is
// returned in `notes` for the teacher to check, never guessed.

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function directChildren(el, ns, localName) {
  return Array.from(el.childNodes).filter((child) => child.nodeType === 1 && child.namespaceURI === ns && child.localName === localName);
}

// A paragraph's own text: every w:t run, with an explicit w:br/w:cr line
// break inside one paragraph kept as '\n'. A w:tab becomes a space.
function paragraphText(p) {
  let text = '';
  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType !== 1) return;
      if (child.namespaceURI === W_NS && child.localName === 't') {
        text += child.textContent;
      } else if (child.namespaceURI === W_NS && (child.localName === 'br' || child.localName === 'cr')) {
        text += '\n';
      } else if (child.namespaceURI === W_NS && child.localName === 'tab') {
        text += ' ';
      } else {
        walk(child);
      }
    });
  };
  walk(p);
  return text;
}
function cellText(tc) {
  return directChildren(tc, W_NS, 'p').map(paragraphText).join('\n');
}
function cellLines(tc) {
  return cellText(tc).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function headerLabel(tc) {
  return cellText(tc).replace(/\s+/g, ' ').replace(/[:.*]/g, '').trim().toUpperCase();
}

const WORDING_LABELS = ['WORDING', 'LABEL'];
const QTY_LABELS = ['KUANTITI', 'BILANGAN', 'QTY', 'KUANTITI (UNIT)', 'UNIT'];
const KOD_LABELS = ['KOD HADIAH', 'KOD', 'KOD PLAK', 'JENIS PLAK', 'CODE'];

// Finds the header row (whichever row actually carries a WORDING/LABEL
// cell — not assumed to always be row 0) and the column each label sits
// in. A table with no such cell isn't an order table and is skipped.
function findWordingHeader(rows) {
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = directChildren(rows[ri], W_NS, 'tc');
    let wordingCol = -1;
    let qtyCol = -1;
    let kodCol = -1;
    cells.forEach((tc, ci) => {
      const t = headerLabel(tc);
      if (wordingCol < 0 && WORDING_LABELS.includes(t)) wordingCol = ci;
      else if (qtyCol < 0 && QTY_LABELS.includes(t)) qtyCol = ci;
      else if (kodCol < 0 && KOD_LABELS.includes(t)) kodCol = ci;
    });
    if (wordingCol >= 0 && qtyCol >= 0) return { headerRow: ri, wordingCol, qtyCol, kodCol };
  }
  return null;
}

// "30 SET", "1", " 2 unit " -> the leading whole number; anything else
// (blank, "-", "SATU", "2.5") -> null, never a guess.
export function parseDocxQty(raw) {
  const m = String(raw || '').trim().match(/^(\d+)(?!\s*[.,]\d)(\s*[A-Za-z]+)?\.?$/);
  return m ? Number(m[1]) : null;
}

// "CODE: 19540 B RM 33" -> "19540 B". Only the "CODE:" prefix and an
// "RM nn" price are dropped; the code itself is left for the catalog
// matcher (excelImport.js's matchJenisPlakPath) to place or reject.
export function cleanDocxPlakCode(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(KOD|CODE)\s*:\s*/i, '')
    .replace(/\bRM\s*\d+(?:[.,]\d+)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TOTAL_RE = /^(JUMLAH|TOTAL|JUMLAH BESAR|GRAND TOTAL)\b/i;

function readTableRows(tbl, tableIdx, notes) {
  const rows = directChildren(tbl, W_NS, 'tr');
  const header = findWordingHeader(rows);
  if (!header) return [];
  const { headerRow, wordingCol, qtyCol, kodCol } = header;
  const out = [];
  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const cells = directChildren(rows[ri], W_NS, 'tc');
    const lines = cells[wordingCol] ? cellLines(cells[wordingCol]) : [];
    const qtyRaw = cells[qtyCol] ? cellText(cells[qtyCol]).replace(/\s+/g, ' ').trim() : '';
    const kodRaw = kodCol >= 0 && cells[kodCol] ? cellText(cells[kodCol]) : '';
    const where = `Word table ${tableIdx + 1}, row ${ri - headerRow}`;
    if (lines.length === 0 && !qtyRaw) continue;
    const qty = parseDocxQty(qtyRaw);
    if (lines.length > 0 && TOTAL_RE.test(lines[0])) {
      out.push({ isTotal: true, qty, where });
      continue;
    }
    if (lines.length === 0) {
      notes.push(`${where}: has a quantity ("${qtyRaw}") but no wording — please add it by hand if it is needed.`);
      continue;
    }
    if (qty == null) {
      if (qtyRaw) notes.push(`${where}: couldn't read the quantity "${qtyRaw}" for "${lines.join(' / ')}" — please add it by hand.`);
      continue;
    }
    if (qty <= 0) continue;
    out.push({ lines, qty, kod: cleanDocxPlakCode(kodRaw), where });
  }
  return out;
}

// Splits a WORDING cell's own lines into { title, tahun, namaKelas,
// subjectName } — the same normalized shape every excelImport.js shape
// reader produces. Line 1 is always the award title. What follows varies
// across real rows in the SAME document:
//   3 lines, line 2 is "TAHUN N <class>": TAHUN 1 UTHMAN / TEMPAT PERTAMA
//     -> tahun=TAHUN 1, namaKelas=UTHMAN, subject=TEMPAT PERTAMA
//   3 lines, line 2 is "TAHUN N" with no class name: TAHUN 1 / ALQURAN
//     -> tahun=TAHUN 1, namaKelas='', subject=ALQURAN
//   2 lines, line 2 is "TAHUN N <class>", no third line at all
//     -> tahun=TAHUN N, namaKelas=<class>, subject='KUANTITI'
//   2 lines, line 2 does NOT look like a Tahun (e.g. "PELAJAR LELAKI
//   2024") -> line 2 is itself the "class", subject='KUANTITI' — the same
//     trick TOKOH's own award-type rows use on the Excel side.
//   1 line holding everything ("ANUGERAH KEDUDUKAN KELAS TAHUN 1 UTHMAN
//   TEMPAT PERTAMA") -> split only at the "TAHUN N" and at an explicit
//     placing ("TEMPAT ..." / PERTAMA..KESEPULUH) at the very end. Anything
//     else after "TAHUN N" stays together as the class text, so no word is
//     ever dropped or moved by a guess.
// "TAHUN 2025" / "TAHUN 2025/2026" is a year, never a Tahun level.
const TAHUN_LINE_RE = /^TAHUN\s*([1-6])(?![\d/])\s*(.*)$/i;
const INLINE_TAHUN_RE = /^(.*?)\s+(TAHUN\s*[1-6](?![\d/]).*)$/i;
const PLACING_RE = /^(.*?)\s+((?:TEMPAT\s+)?(?:PERTAMA|KEDUA|KETIGA|KEEMPAT|KELIMA|KEENAM|KETUJUH|KELAPAN|KESEMBILAN|KESEPULUH))$/i;

export function classifyWordingLines(inputLines) {
  let lines = inputLines;
  if (lines.length === 1) {
    const m = lines[0].match(INLINE_TAHUN_RE);
    if (m && m[1].trim()) {
      const rest = m[2];
      const p = rest.match(PLACING_RE);
      lines = p && TAHUN_LINE_RE.test(p[1]) ? [m[1].trim(), p[1].trim(), p[2].trim()] : [m[1].trim(), rest.trim()];
    }
  }
  const title = lines[0];
  const rest = lines.slice(1);
  if (rest.length === 0) return { title, tahun: '', namaKelas: '', subjectName: 'KUANTITI' };
  const m = rest[0].match(TAHUN_LINE_RE);
  if (m) {
    return { title, tahun: `TAHUN ${m[1]}`, namaKelas: (m[2] || '').trim(), subjectName: rest.length >= 2 ? rest.slice(1).join(' ') : 'KUANTITI' };
  }
  if (rest.length >= 2) return { title, tahun: '', namaKelas: rest[0], subjectName: rest.slice(1).join(' ') };
  return { title, tahun: '', namaKelas: rest[0], subjectName: 'KUANTITI' };
}

// The event heading typed above the first order table ("MAJLIS ANUGERAH
// ... 2025"), copied verbatim into TAJUK BESAR. Only a body paragraph that
// names the event (MAJLIS / HARI ANUGERAH / ANUGERAH ...) counts; with
// none, TAJUK BESAR stays blank for the teacher to type.
const HEADING_RE = /\b(MAJLIS|HARI ANUGERAH|ANUGERAH|PERSEMBAHAN|颁奖|典礼)\b/i;
function findHeading(body) {
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== 1 || child.namespaceURI !== W_NS) continue;
    if (child.localName === 'tbl') return '';
    if (child.localName !== 'p') continue;
    const text = paragraphText(child).replace(/\s+/g, ' ').trim();
    if (text && HEADING_RE.test(text)) return text;
  }
  return '';
}

// A WORDING cell's lines, top to bottom, as the plaque engraves them. A
// one-line cell holding everything ("ANUGERAH ... TAHUN 1 UTHMAN TEMPAT
// PERTAMA") is split only where classifyWordingLines would split it.
function wordingLinesOf(lines) {
  if (lines.length !== 1) return lines;
  const m = lines[0].match(INLINE_TAHUN_RE);
  if (!m || !m[1].trim()) return lines;
  const p = m[2].match(PLACING_RE);
  return p && TAHUN_LINE_RE.test(p[1]) ? [m[1].trim(), p[1].trim(), p[2].trim()] : [m[1].trim(), m[2].trim()];
}

// The engraved fields, in the cell's own order (owner, 2026-10-10): line 1
// -> POSITION, line 2 -> EVENT LINE 1, line 3 -> EVENT LINE 2. A 4+ line
// cell ("ANUGERAH / AKADEMIK TERBAIK / KELAS ... / TAHUN 2025/2026") keeps
// its last two lines as the event lines and the rest as a multi-line
// POSITION. Nothing is moved between lines, so the plaque reads exactly
// as the teacher typed it.
export function wordingFields(inputLines) {
  const lines = wordingLinesOf(inputLines);
  if (lines.length <= 3) return { position: lines[0] || '', eventLine1: lines[1] || '', eventLine2: lines[2] || '' };
  return { position: lines.slice(0, -2).join('\n'), eventLine1: lines[lines.length - 2], eventLine2: lines[lines.length - 1] };
}

// Groups wording rows ({ lines, qty, kod }) into one KLAS_MATRIX-shaped
// section per award (POSITION + plaque code), each under its own dynamic
// category key. Each distinct EVENT LINE 1 + 2 pair is one column (Nama
// Kelas + the column's own event line 2) with a single KUANTITI row, so
// exportCsv.js's buildPbdMatrixRows engraves position / event_line_1 /
// event_line_2 exactly as wordingFields read them. Shared with
// aiMapping.js, so a Word table and an AI-mapped Excel list land on
// Step 2 exactly the same way.
export function wordingRowsToCategorized(rows, heading = '') {
  // Group by award title + plaque code. One title with two different codes
  // is two awards (each block carries one Jenis Plak) — both kept, each
  // labelled with its own code so neither silently takes the other's.
  const groupOrder = [];
  const groups = new Map();
  const codesByTitle = new Map();
  rows.forEach(({ lines, qty, kod }) => {
    const { position: title, eventLine1, eventLine2 } = wordingFields(lines);
    const gk = `${title}\u0000${kod}`;
    let g = groups.get(gk);
    if (!g) {
      g = { title, kod, classesByKey: new Map(), classOrder: [] };
      groups.set(gk, g);
      groupOrder.push(gk);
      if (!codesByTitle.has(title)) codesByTitle.set(title, new Set());
      codesByTitle.get(title).add(kod);
    }
    const classKey = `${eventLine1}\u0000${eventLine2}`;
    let cls = g.classesByKey.get(classKey);
    if (!cls) {
      cls = { tahunFrom: '', tahunTo: '', namaKelas: eventLine1, eline2: eventLine2, subjects: [{ name: 'KUANTITI', qty: 0 }] };
      g.classesByKey.set(classKey, cls);
      g.classOrder.push(classKey);
    }
    cls.subjects[0].qty += qty;
  });

  // Rows with no plaque code can't be priced or made. Say so, and point out
  // when the same wording is also listed WITH a code (often a draft table
  // the teacher forgot to delete) so it isn't silently made twice.
  const notes = [];
  const codesByWording = new Map();
  rows.forEach(({ lines, kod }) => {
    const wk = lines.join('\n');
    if (!codesByWording.has(wk)) codesByWording.set(wk, new Set());
    if (kod) codesByWording.get(wk).add(kod);
  });
  const uncoded = new Map();
  rows.filter((r) => !r.kod).forEach(({ lines, qty }) => {
    const title = wordingFields(lines).position.replace(/\n/g, ' ');
    const u = uncoded.get(title) ?? { qty: 0, dupCodes: new Set() };
    u.qty += qty;
    codesByWording.get(lines.join('\n')).forEach((c) => u.dupCodes.add(c));
    uncoded.set(title, u);
  });
  uncoded.forEach((u, title) => {
    const dup = u.dupCodes.size ? ` The same wording is also listed with code ${[...u.dupCodes].join(', ')} — it may be a leftover copy; delete whichever is not needed.` : '';
    notes.push(`"${title}": ${u.qty} plaque(s) have no plaque code (KOD) — please pick the Jenis Plak by hand.${dup}`);
  });

  const categorized = {};
  groupOrder.forEach((gk) => {
    const g = groups.get(gk);
    const name = g.title.replace(/\n/g, ' ');
    const label = codesByTitle.get(g.title).size > 1 && g.kod ? `${name} (${g.kod})` : name;
    const lines = { 2: g.title };
    if (heading) lines[0] = heading;
    const section = {
      lines,
      classes: g.classOrder.map((k) => g.classesByKey.get(k)),
      jenisPlak: g.kod,
      sourceSheet: label,
    };
    categorized[makeDynamicCategoryKey('KLAS_MATRIX', label)] = [section];
  });

  return { categorized, count: groupOrder.length, notes };
}

const BAD_FILE = 'Could not read this file — please make sure it is a valid .docx file.';

// Top-level entry point — same return shape as excelImport.js's
// parseFormAnugerahExcel (`{ categorized, notes } | { error }`), so
// AppState.jsx/addOnDiff.js merge either file type through the same code
// path. `DOMParser` is injectable for tests (node has none). Never throws.
export async function parseWordingDocx(arrayBuffer, { DOMParser: DP = globalThis.DOMParser } = {}) {
  let zip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return { klasMatrix: null, error: BAD_FILE };
  }
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) return { klasMatrix: null, error: BAD_FILE };
  const xmlText = await xmlFile.async('text');
  const doc = new DP().parseFromString(xmlText, 'application/xml');
  if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    return { klasMatrix: null, error: BAD_FILE };
  }
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  const heading = body ? findHeading(body) : '';

  const notes = [];
  const rows = [];
  Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).forEach((tbl, tableIdx) => {
    const tableRows = [];
    readTableRows(tbl, tableIdx, notes).forEach((r) => {
      if (!r.isTotal) { tableRows.push(r); return; }
      // A JUMLAH/TOTAL row checks only its own table's rows above it.
      const sum = tableRows.reduce((s, x) => s + x.qty, 0);
      if (r.qty != null && r.qty !== sum) {
        notes.push(`${r.where}: the file's JUMLAH/TOTAL says ${r.qty}, but the rows above it add up to ${sum} — please check nothing is missing.`);
      }
    });
    rows.push(...tableRows);
  });

  const { categorized, count, notes: groupNotes } = wordingRowsToCategorized(rows, heading);
  notes.push(...groupNotes);
  if (count === 0) {
    return { klasMatrix: null, error: 'No recognized WORDING/KUANTITI or LABEL/BILANGAN table found in this file.' };
  }

  if (!heading) notes.push('No event heading (MAJLIS ...) was found above the table — please type the TAJUK BESAR by hand.');

  return { categorized, notes, klasMatrix: null };
}
