import JSZip from 'jszip';
import { makeDynamicCategoryKey, resolveSelempangWarna } from '../data/catalog';
import { readSelempangFromDocument, readPlaqueBoxes, readCodedBoxes } from './docxSelempang';
import { schoolListSections } from './schoolList';

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
const KOD_LABELS = ['KOD HADIAH', 'KOD', 'KOD PLAK', 'JENIS PLAK', 'CODE', 'JENIS', 'JENIS/KOD', 'KOD/JENIS'];
// A school's own list table (Sean, 2026-10-22, SKTG: "NAMA | CODE | JUMLAH | HARGA") — these
// labels count only beside a code column, and such a table reads top to bottom as the teacher
// wrote it (schoolList.js) instead of being grouped by award.
const LIST_WORDING_LABELS = ['NAMA', 'NAMA ANUGERAH', 'ANUGERAH'];
const LIST_QTY_LABELS = ['JUMLAH', 'JUMLAH UNIT'];
const HARGA_RE = /^HARGA\b/;
// "JENIS / KOD" -> "JENIS/KOD", so a spaced slash still matches.
const kodLabel = (t) => t.replace(/\s*\/\s*/g, '/');

// Finds the header row (whichever row actually carries a WORDING/LABEL
// cell — not assumed to always be row 0) and the column each label sits
// in. A table with no such cell isn't an order table and is skipped.
// `codeAbove`: the line above the table names the plaque code ("(KOD MEDAL 18059)"), so a
// NAMA ANUGERAH | JUMLAH table with no code column of its own is a school's list too.
function findWordingHeader(rows, codeAbove = false) {
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = directChildren(rows[ri], W_NS, 'tc');
    let wordingCol = -1;
    let qtyCol = -1;
    let kodCol = -1;
    let hargaCol = -1;
    let list = false;
    cells.forEach((tc, ci) => {
      const t = headerLabel(tc);
      if (wordingCol < 0 && WORDING_LABELS.includes(t)) wordingCol = ci;
      else if (qtyCol < 0 && QTY_LABELS.includes(t)) qtyCol = ci;
      else if (kodCol < 0 && KOD_LABELS.includes(kodLabel(t))) kodCol = ci;
      else if (hargaCol < 0 && HARGA_RE.test(t)) hargaCol = ci;
    });
    if (wordingCol < 0 || qtyCol < 0) {
      cells.forEach((tc, ci) => {
        const t = headerLabel(tc);
        if (wordingCol < 0 && LIST_WORDING_LABELS.includes(t)) { wordingCol = ci; list = true; }
        else if (qtyCol < 0 && LIST_QTY_LABELS.includes(t)) { qtyCol = ci; list = true; }
      });
      if (kodCol < 0 && !codeAbove) list = false;
    }
    if (wordingCol >= 0 && qtyCol >= 0 && (list || ![wordingCol, qtyCol].some((c) => LIST_WORDING_LABELS.includes(headerLabel(cells[c])) || LIST_QTY_LABELS.includes(headerLabel(cells[c]))))) {
      return { headerRow: ri, wordingCol, qtyCol, kodCol, hargaCol, list, cols: cells.length };
    }
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
    // A colour written short in brackets ("SR – 116 A (R)", "TSL232#3 (BL)")
    // spelled out, so the catalog's RED / BLUE option is found.
    .replace(/\(\s*(?:R|RED|MERAH)\s*\)/gi, ' RED')
    .replace(/\(\s*(?:BL|BLUE|BIRU)\s*\)/gi, ' BLUE')
    .replace(/\s+/g, ' ')
    .trim();
}

const TOTAL_RE = /^(JUMLAH|TOTAL|JUMLAH BESAR|GRAND TOTAL)\b/i;

// The paragraph just above a table ("( KRISTAL ) OOS - DESIGN C"), '' when there is none.
function textAbove(tbl) {
  for (let el = tbl.previousSibling; el; el = el.previousSibling) {
    if (el.nodeType !== 1 || el.namespaceURI !== W_NS) continue;
    if (el.localName === 'tbl') return '';
    if (el.localName === 'p') {
      const text = paragraphText(el).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
  }
  return '';
}

// The first line under a table, '' when a table comes first ("81", a teacher's own total).
function textBelow(tbl) {
  for (let el = tbl.nextSibling; el; el = el.nextSibling) {
    if (el.nodeType !== 1 || el.namespaceURI !== W_NS) continue;
    if (el.localName === 'tbl') return '';
    if (el.localName === 'p') {
      const text = paragraphText(el).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
  }
  return '';
}

// The plaque codes a heading line names (SK ABDUL SAMAT, 2026-10-27): "DAERAH (KOD MEDAL 18059)"
// -> ['18059']; "TOKOH MURID (KOD MEDAL : (YK628)+(GTS15))" -> ['YK628', 'GTS15'] (each '+' part
// goes with every plaque of the table); "(KOD MEDAL (80-B) Design 2)" -> ['80-B Design 2'].
const KOD_ABOVE_RE = /\bKOD(?:\s+(?:MEDAL|PLAK|HADIAH))?\s*:?\s*(.+)$/i;
export function kodsAbove(text) {
  const m = KOD_ABOVE_RE.exec(String(text || ''));
  if (!m) return [];
  let rest = m[1].trim();
  // the ")" closing "(KOD MEDAL …" itself
  while ((rest.match(/\)/g) || []).length > (rest.match(/\(/g) || []).length) rest = rest.replace(/\)\s*$/, '').trim();
  return rest.split('+').map((k) => cleanDocxPlakCode(k.replace(/[()]/g, ' '))).filter(Boolean);
}

// `carry`: the list header of the table before — a school's list goes on in tables with no
// header row of their own (one table per plaque type), read with the same columns.
function readTableRows(tbl, tableIdx, notes, carry = null) {
  const rows = directChildren(tbl, W_NS, 'tr');
  const above = textAbove(tbl);
  const aboveKods = kodsAbove(above);
  let header = findWordingHeader(rows, aboveKods.length > 0);
  if (!header && carry && rows.length && directChildren(rows[0], W_NS, 'tc').length === carry.cols) header = { ...carry, headerRow: -1 };
  if (!header) return { rows: [], header: null };
  const { headerRow, wordingCol, qtyCol, kodCol, hargaCol = -1 } = header;
  // "DESIGN C" written above the table goes with its code (a crystal's design)
  const design = /\bDESIGN\s*([A-Z0-9])\b/i.exec(above);
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
    // "JUMLAH : 125 PCS" typed in the quantity column itself.
    if (lines.length === 0 && TOTAL_RE.test(qtyRaw)) {
      const m = /(\d+)/.exec(qtyRaw);
      out.push({ isTotal: true, qty: m ? Number(m[1]) : null, where });
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
    // No code column: the code(s) named above the table; a second one ("+ GTS15") is its own row
    const [first = '', ...extraKods] = kodCol < 0 ? aboveKods : [];
    let kod = kodCol >= 0 ? cleanDocxPlakCode(kodRaw) : first;
    if (design && kod && !/\bDESIGN\b/i.test(kod)) kod = `${kod} DESIGN ${design[1].toUpperCase()}`;
    const unit = hargaCol >= 0 && cells[hargaCol] ? Number(cellText(cells[hargaCol]).replace(/[^0-9.]/g, '')) || 0 : 0;
    out.push({ lines, qty, kod, unit, where });
    extraKods.forEach((extra) => out.push({ lines, qty, kod: extra, unit: 0, where, extraKod: true }));
  }
  return { rows: out, header, totalBelow: header.list ? parseDocxQty(textBelow(tbl)) : null };
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

// Name lists (owner, 2026-10-10): a 4+ line label whose default POSITION
// would be different on almost every plaque (it holds the student's name, e.g.
// "ANUGERAH / KEPIMPINAN MURID CEMERLANG / <NAME> / KETUA PENGAWAS /
// LEMBAGA PENGAWAS SEKOLAH") would make one tab per student. Instead the
// leading lines most plaques share with others are POSITION (the award), the
// next line is EVENT LINE 1 (the name) and the rest, one per line, EVENT
// LINE 2 (the multi-line "jawatan / unit / kelas" box). Still top to
// bottom in the label's own order. Returns one fields object per row.
function wordingFieldsForRows(rows) {
  const lineSets = rows.map(({ lines }) => wordingLinesOf(lines));
  const distinct = [...new Set(lineSets.map((l) => l.join('\n')))].map((k) => k.split('\n'));
  const positionCount = new Map();
  distinct.forEach((l) => {
    const p = wordingFields(l).position;
    positionCount.set(p, (positionCount.get(p) || 0) + 1);
  });
  // Per label length: the first line where most labels differ from every
  // other label is the name line; the lines above it are the award.
  const nameLineByLength = new Map();
  [...new Set(distinct.map((l) => l.length))].filter((len) => len >= 4).forEach((len) => {
    const same = distinct.filter((l) => l.length === len);
    if (same.length < 2) return;
    for (let i = 1; i <= len - 2; i++) {
      const unique = same.filter((l) => same.filter((o) => o[i] === l[i]).length === 1).length;
      if (unique * 2 <= same.length) continue;
      // A name list carries per-person lines below the name (post, unit).
      // When those are the same on every label ("KELAS ... / TAHUN
      // 2025/2026") the different line is an award title, not a name.
      const tails = new Set(same.map((l) => l.slice(i + 1).join('\n')));
      if (tails.size > 1) nameLineByLength.set(len, i);
      return;
    }
  });
  return lineSets.map((lines, ri) => {
    // A label that starts with the name ("<NAME> / ANUGERAH BINTANG
    // BERSINAR", marked by the AI reader — pdfMapping.js): the award below
    // it is POSITION, the name EVENT LINE 1, and the tab engraves the name
    // first.
    if (rows[ri].nameFirst && lines.length >= 2) {
      return { position: lines.slice(1).join('\n'), eventLine1: lines[0], eventLine2: '', nameFirst: true };
    }
    const def = wordingFields(lines);
    const n = nameLineByLength.get(lines.length);
    if (n == null || positionCount.get(def.position) > 1) return def;
    return { position: lines.slice(0, n).join('\n'), eventLine1: lines[n], eventLine2: lines.slice(n + 1).join('\n') };
  });
}

// Groups wording rows ({ lines, qty, kod }) into one KLAS_MATRIX-shaped
// section per award (POSITION + plaque code), each under its own dynamic
// category key. Each distinct EVENT LINE 1 + 2 pair is one column (Nama
// Kelas + the column's own event line 2) with a single KUANTITI row, so
// exportCsv.js's buildPbdMatrixRows engraves position / event_line_1 /
// event_line_2 exactly as wordingFields read them. Shared with
// aiMapping.js, so a Word table and an AI-mapped Excel list land on
// Step 2 exactly the same way.
// A bracketed note after the award ("ANUGERAH PENDETA ZA'ABA (BM)",
// "ANUGERAH SAIDINA ABUBAKAR (TERBAIK KESELURUHAN)") tells the school
// which subject or level it is; it is not engraved (owner, 2026-10-15). A
// line that is only a bracket ("(KELAB)") stays.
const TRAILING_NOTE_RE = /(\S)\s*\([^()\d]*[A-Za-z][^()\d]*\)\s*$/;
const dropSubjectShortForm = (line) => String(line ?? '').replace(TRAILING_NOTE_RE, '$1').trim();
// Except "(LELAKI)" / "(PEREMPUAN)": it is engraved, on its own line under
// the award ("TOKOH AKADEMIK (LELAKI) / TAHAP 1" -> TOKOH AKADEMIK /
// LELAKI / TAHAP 1), Sean 2026-10-17.
const GENDER_NOTE_RE = /^(.*\S)\s*\(\s*(LELAKI|PEREMPUAN)\s*\)\s*$/i;
// A subject in brackets — "MATA PELAJARAN TERBAIK TAHUN 6 (BAHASA MELAYU)", or "(BAHASA MELAYU)" on
// the line below — is engraved: the award's second line, brackets off (Sean, 2026-10-22). Short
// forms like (BM) are still dropped. Any full subject name of the website's MP sheets counts.
const SUBJECT_NAMES = [
  'BAHASA MELAYU', 'BAHASA INGGERIS', 'MATEMATIK', 'SAINS', 'PENDIDIKAN ISLAM', 'BAHASA ARAB',
  'PENDIDIKAN SENI VISUAL', 'PENDIDIKAN JASMANI', 'PENDIDIKAN KESIHATAN', 'PENDIDIKAN MUZIK', 'PENDIDIKAN MORAL',
  'BAHASA CINA', 'BAHASA TAMIL', 'SEJARAH', 'REKA BENTUK & TEKNOLOGI', 'REKA BENTUK TEKNOLOGI',
  'PENDIDIKAN JASMANI & PENDIDIKAN KESIHATAN', 'PENDIDIKAN JASMANI & KESIHATAN',
  'MATEMATIK AWAL', 'SAINS AWAL', 'KREATIVITI ESTETIKA', 'PENDIDIKAN SENI', 'TEKNOLOGI MAKLUMAT',
];
const subjectKey = (t) => String(t || '').toUpperCase().replace(/&/g, ' DAN ').replace(/[^A-Z0-9]+/g, ' ').trim();
const SUBJECT_KEYS = new Set(SUBJECT_NAMES.map(subjectKey));
const BRACKET_SUBJECT_RE = /^(.*?)\s*\(\s*([^()]+?)\s*\)\s*$/;
// a bracketed subject at the end of the line (or the whole line): [before, subject] — else null
export function bracketSubject(line) {
  const m = BRACKET_SUBJECT_RE.exec(String(line ?? '').trim());
  return m && SUBJECT_KEYS.has(subjectKey(m[2])) ? [m[1].trim(), m[2].replace(/\s+/g, ' ').trim()] : null;
}
// The lines with each bracketed subject folded into the award line above as its second line.
export function foldBracketSubjects(lines) {
  const out = [];
  (lines || []).forEach((line) => {
    const b = bracketSubject(line);
    if (!b) { out.push(line); return; }
    if (b[0]) out.push(`${b[0]}\n${b[1]}`);
    else if (out.length) out[out.length - 1] = `${out[out.length - 1]}\n${b[1]}`;
    else out.push(b[1]);
  });
  return out;
}

const wordingLine = (line) => {
  const m = GENDER_NOTE_RE.exec(String(line ?? '').trim());
  return m ? [dropSubjectShortForm(m[1]), m[2]] : [dropSubjectShortForm(line)];
};

export function wordingRowsToCategorized(inputRows, heading = '', { keepOrder = false } = {}) {
  const rows = inputRows.map((r) => ({ ...r, lines: foldBracketSubjects(r.lines || []).flatMap(wordingLine).filter(Boolean) }));
  // Group by award title + plaque code. One title with two different codes
  // is two awards (each block carries one Jenis Plak) — both kept, each
  // labelled with its own code so neither silently takes the other's.
  // keepOrder (the AI reader): when an award is listed, then an award that
  // appears only there, then the first award again (items 4-5 ANUGERAH
  // MURID, item 6 RISING STAR, items 7-8 ANUGERAH MURID), the later part gets
  // its own numbered tab so the tabs — and the CSV — follow the file's order.
  // Awards that alternate all the way through (PERTAMA / KEDUA / KETIGA for
  // each class) are a table, and keep one tab each, as before.
  const groupOrder = [];
  const groups = new Map();
  const codesByTitle = new Map();
  const fieldsByRow = wordingFieldsForRows(rows);
  const keyOf = (ri) => {
    const { position: title, nameFirst = false } = fieldsByRow[ri];
    return `${title}\u0000${rows[ri].kod}\u0000${nameFirst}\u0000${rows[ri].heading || ''}`;
  };
  const firstRow = new Map();
  const finalRow = new Map();
  rows.forEach((_, ri) => {
    const k = keyOf(ri);
    if (!firstRow.has(k)) firstRow.set(k, ri);
    finalRow.set(k, ri);
  });
  const lastRow = new Map();
  const latestRun = new Map();
  let run = 0;
  rows.forEach(({ qty, kod, heading: rowHeading = '' }, ri) => {
    const { position: title, eventLine1, eventLine2, nameFirst = false } = fieldsByRow[ri];
    const baseKey = keyOf(ri);
    let gk = baseKey;
    if (keepOrder) {
      const prev = lastRow.get(baseKey);
      // Broken off by an award listed only in between (never before, never after).
      const broken = prev != null && [...firstRow].some(([k, r]) => r > prev && finalRow.get(k) < ri);
      if (prev == null || broken) latestRun.set(baseKey, `${baseKey}\u0000${++run}`);
      gk = latestRun.get(baseKey);
      lastRow.set(baseKey, ri);
    }
    let g = groups.get(gk);
    if (!g) {
      g = { title, kod, nameFirst, heading: rowHeading, classesByKey: new Map(), classOrder: [] };
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
  rows.forEach(({ lines, qty, kod }, ri) => {
    if (kod) return;
    const title = fieldsByRow[ri].position.replace(/\n/g, ' ');
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
    const base = codesByTitle.get(g.title).size > 1 && g.kod ? `${name} (${g.kod})` : name;
    let label = base;
    for (let n = 2; categorized[makeDynamicCategoryKey('KLAS_MATRIX', label)]; n++) label = `${base} (${n})`;
    const lines = { 2: g.title };
    if (g.heading || heading) lines[0] = g.heading || heading;
    const section = {
      lines,
      classes: g.classOrder.map((k) => g.classesByKey.get(k)),
      jenisPlak: g.kod,
      sourceSheet: label,
    };
    // The name (EVENT LINE 1) is engraved above the award (POSITION).
    if (g.nameFirst) section.nameFirst = true;
    categorized[makeDynamicCategoryKey('KLAS_MATRIX', label)] = [section];
  });

  return { categorized, count: groupOrder.length, notes };
}

// A teacher's one table whose rows differ only in the award (②) and its
// Jenis Plak — same TAJUK BESAR, same line under it ("TAHUN 6") — as one
// ORDER LAIN-LAIN-style section, a row per award, instead of a tab per
// award (Sean, 2026-10-20: the PENGHARGAAN sheet). null when the rows
// aren't that shape (one award only, the lines under it differ, a name
// list), so they're grouped as before.
export function wordingRowsToUmum(inputRows, heading = '') {
  const rows = inputRows.map((r) => ({ ...r, lines: foldBracketSubjects(r.lines || []).flatMap(wordingLine).filter(Boolean) }));
  if (rows.length < 2) return null;
  const fields = wordingFieldsForRows(rows);
  if (fields.some((f) => f.nameFirst || !f.position)) return null;
  const tail = (f) => `${f.eventLine1}\u0000${f.eventLine2}`;
  if (!fields[0].eventLine1 || fields.some((f) => tail(f) !== tail(fields[0]))) return null;
  if (new Set(fields.map((f) => f.position)).size < 2) return null;
  const lines = { 0: heading, 1: fields[0].position, 2: fields[0].eventLine1, 3: fields[0].eventLine2 };
  Object.keys(lines).forEach((k) => { if (!lines[k]) delete lines[k]; });
  const umumRows = [];
  rows.forEach((r, ri) => {
    const l1 = fields[ri].position === lines[1] ? '' : fields[ri].position;
    const same = umumRows.find((u) => u.l1 === l1 && u.jenisPlak === r.kod);
    if (same) { same.qty += r.qty; return; }
    umumRows.push({ no: String(umumRows.length + 1), l0: '', l1, l2: '', l3: '', qty: r.qty, jenisPlak: r.kod || '', harga: '' });
  });
  const notes = [];
  const uncoded = rows.filter((r) => !r.kod).reduce((a, r) => a + r.qty, 0);
  if (uncoded) notes.push(`${uncoded} plaque(s) have no plaque code (KOD) — please pick the Jenis Plak by hand.`);
  return { section: { lines, umumRows, isUmumList: true, skipLineDerivation: true, classes: [] }, notes };
}

// Schools often repeat the event heading as the first line of every
// WORDING cell ("HARI ANUGERAH KUALITI 2026 / Terbaik PBD / Tahun 1"), or
// put the school name above it ("SK ... / HARI ANUGERAH ... / Tokoh NILAM /
// Tahap 2"). Those top lines are the plaque's TAJUK BESAR, not the award:
// they are taken off the wording (so awards get their own tabs) and kept
// as that row's own heading (Sean, 2026-10-17).
const headingKey = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
export function splitRowHeading(row, heading) {
  if (!heading) return row;
  const at = row.lines.findIndex((l, i) => i <= 1 && headingKey(l) === headingKey(heading));
  if (at < 0 || row.lines.length <= at + 1) return row;
  return { ...row, heading: row.lines.slice(0, at + 1).join('\n'), lines: row.lines.slice(at + 1) };
}

// Sashes typed as one-cell tables under a SELEMPANG heading (Sean, 2026-10-22, SKTG:
// "KAIN SELEMPANG & LOGO SEKOLAH" / "( RM40 X 4 ) CODE 0050", then a box per sash with its
// wording) — one sash each, the colour from the heading's code / colour word.
function selempangTables(doc) {
  const out = [];
  Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).forEach((tbl) => {
    const trs = directChildren(tbl, W_NS, 'tr');
    if (trs.length !== 1 || directChildren(trs[0], W_NS, 'tc').length !== 1) return;
    const above = [];
    for (let el = tbl.previousSibling; el && above.length < 4; el = el.previousSibling) {
      if (el.nodeType !== 1 || el.namespaceURI !== W_NS) continue;
      if (el.localName === 'p') { const t = paragraphText(el).replace(/\s+/g, ' ').trim(); if (t) above.push(t); continue; }
      if (el.localName !== 'tbl') break;
      const rows = directChildren(el, W_NS, 'tr');
      if (rows.length !== 1 || directChildren(rows[0], W_NS, 'tc').length !== 1) break;
    }
    if (!above.some((t) => /SELEMPANG/i.test(t))) return;
    const code = above.map((t) => /\b(00\d\d)\b|\b(MERAH|KUNING|HIJAU|BIRU)\b/i.exec(t)).find(Boolean);
    const acara = cellLines(directChildren(trs[0], W_NS, 'tc')[0]).join(' ').replace(/\s+/g, ' ').trim();
    if (!acara) return;
    const resolved = code ? resolveSelempangWarna(code[1] || code[2]) : null;
    out.push({ acara, warna: resolved ? resolved.warna : '', warnaCode: resolved ? resolved.code : '', qty: 1 });
  });
  return out.length ? { lines: {}, selempangRows: out, isSelempangList: true, skipLineDerivation: true, classes: [], sourceSheet: 'SELEMPANG' } : null;
}

const BAD_FILE = 'Could not read this file — please make sure it is a valid .docx file.';

// Plaques, not counting a second code's rows ("+ GTS15" goes with plaques already counted)
const plaqueCount = (rows) => rows.reduce((s, r) => s + (r.extraKod ? 0 : r.qty), 0);

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
  const listRows = [];
  let carry = null;
  Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).forEach((tbl, tableIdx) => {
    const tableRows = [];
    const read = readTableRows(tbl, tableIdx, notes, carry);
    if (read.header) carry = read.header.list ? read.header : null;
    read.rows.forEach((r) => {
      if (!r.isTotal) { tableRows.push(r); return; }
      // A JUMLAH/TOTAL row checks only its own table's rows above it.
      const sum = tableRows.reduce((s, x) => s + x.qty, 0);
      if (r.qty != null && r.qty !== sum) {
        notes.push(`${r.where}: the file's JUMLAH/TOTAL says ${r.qty}, but the rows above it add up to ${sum} — please check nothing is missing.`);
      }
    });
    (read.header?.list ? listRows : rows).push(...tableRows);
    // The teacher's own total typed under a list table ("81")
    const sum = plaqueCount(tableRows);
    if (read.totalBelow != null && read.totalBelow !== sum) {
      notes.push(`Word table ${tableIdx + 1}: the total under it says ${read.totalBelow}, but its rows add up to ${sum} — please check nothing is missing.`);
    }
  });
  const penerima = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))
    .map((p) => /\bJUMLAH PENERIMA\s*:?\s*(\d+)/i.exec(paragraphText(p))).find(Boolean);
  if (penerima && listRows.length && Number(penerima[1]) !== plaqueCount(listRows)) {
    notes.push(`The file's JUMLAH PENERIMA says ${penerima[1]}, but the tables add up to ${plaqueCount(listRows)} — please check nothing is missing.`);
  }

  const { categorized, count, notes: groupNotes } = wordingRowsToCategorized(rows.map((r) => splitRowHeading(r, heading)), heading);
  notes.push(...groupNotes);
  // A school's list table, top to bottom (schoolList.js)
  schoolListSections(listRows.map((r) => ({ lines: foldBracketSubjects(r.lines), qty: r.qty, type: '', kod: r.kod, unit: r.unit, total: r.unit * r.qty })))
    .forEach((sec) => { categorized[sec.isSelempangList ? 'SELEMPANG' : (sec.dynamicCategoryKey || 'UMUM')] = [sec]; });
  // No table at all: plaques drawn as text boxes (docxSelempang.js readPlaqueBoxes), top to bottom
  if (count === 0 && listRows.length === 0) {
    // …or boxes with "N PLAK" / "KOD …" written under them (readCodedBoxes)
    const drawn = readPlaqueBoxes(doc);
    const boxed = drawn.items.length ? drawn : readCodedBoxes(doc);
    notes.push(...boxed.notes);
    boxed.items.forEach((it) => listRows.push({ ...it, lines: it.lines, unit: 0 }));
    schoolListSections(listRows.map((r) => ({ lines: foldBracketSubjects(r.lines), qty: r.qty, type: '', kod: r.kod, unit: 0, total: 0 })))
      .forEach((sec) => { categorized[sec.isSelempangList ? 'SELEMPANG' : (sec.dynamicCategoryKey || 'UMUM')] = [sec]; });
  }
  if (count === 0 && listRows.length === 0) {
    return { klasMatrix: null, error: 'No recognized WORDING/KUANTITI or LABEL/BILANGAN table found in this file.' };
  }

  if (!heading && !listRows.length) notes.push('No event heading (MAJLIS ...) was found above the table — please type the TAJUK BESAR by hand.');

  // Selempang drawn as coloured boxes (docxSelempang.js).
  const selempang = readSelempangFromDocument(doc);
  if (selempang.section && !categorized.SELEMPANG) categorized.SELEMPANG = [selempang.section];
  const boxes = categorized.SELEMPANG ? null : selempangTables(doc);
  if (boxes) categorized.SELEMPANG = [boxes];
  notes.push(...selempang.notes);

  return { categorized, notes, klasMatrix: null };
}
