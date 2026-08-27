import JSZip from 'jszip';

// A second real-world order shape, completely different from any Excel
// template: a Word table of individual "WORDING / KUANTITI / KOD HADIAH"
// rows, one row per plaque, where the WORDING cell itself is 1-3 lines of
// text stacked on top of each other (a genuine Word line break inside the
// cell, not separate cells) — e.g.
//   ANUGERAH KEDUDUKAN KELAS
//   TAHUN 1 UTHMAN
//   TEMPAT PERTAMA
// Several consecutive rows commonly share the same award title and the same
// Tahun/Nama Kelas, differing only in their own third line (TEMPAT KEDUA,
// KETIGA, ...) — those really are ONE class's several award "columns", the
// same shape KLAS_MATRIX already models as one class row with several
// subject columns. A real document also mixes in variants of this same
// 1-3-line shape (see classifyWordingLines below), and often splits one
// long award list across several separate Word tables purely because of a
// page break — those get merged back into ONE section by matching on the
// award title text (line 1), not by table boundaries.
//
// Feeds the exact same { klasMatrix: { sections } } shape
// excelImport.js's parseFormAnugerahExcel produces, so AppState.jsx's
// importFormAnugerahExcel can hand either kind of file to the same merge
// step — see the header comment there and in excelImport.js for why every
// shape lands in one place (KLAS_MATRIX).

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function directChildren(el, ns, localName) {
  return Array.from(el.childNodes).filter((child) => child.nodeType === 1 && child.namespaceURI === ns && child.localName === localName);
}

// A table cell's own text, paragraph by paragraph (each w:p is its own
// printed line, and a run split across several w:r/w:t runs — or an
// explicit w:br/w:cr line break inside one paragraph — still belongs to
// that same line) — joined with '\n' so classifyWordingLines below can
// split back into the cell's own individual lines.
function paragraphText(p) {
  let text = '';
  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType !== 1) return;
      if (child.namespaceURI === W_NS && child.localName === 't') {
        text += child.textContent;
      } else if (child.namespaceURI === W_NS && (child.localName === 'br' || child.localName === 'cr')) {
        text += '\n';
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

// Finds the header row (whichever row actually carries a "WORDING" cell —
// not assumed to always be row 0) and the column each label sits in. A
// table with no "WORDING" cell at all isn't this shape and is skipped.
function findWordingHeader(rows) {
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = directChildren(rows[ri], W_NS, 'tc');
    let wordingCol = -1;
    let qtyCol = -1;
    let kodCol = -1;
    cells.forEach((tc, ci) => {
      const t = cellText(tc).trim().toUpperCase();
      if (t === 'WORDING') wordingCol = ci;
      else if (t === 'KUANTITI') qtyCol = ci;
      else if (t === 'KOD HADIAH' || t === 'KOD') kodCol = ci;
    });
    if (wordingCol >= 0) return { headerRow: ri, wordingCol, qtyCol, kodCol };
  }
  return null;
}

function readWordingRows(tbl) {
  const rows = directChildren(tbl, W_NS, 'tr');
  const header = findWordingHeader(rows);
  if (!header) return [];
  const { headerRow, wordingCol, qtyCol, kodCol } = header;
  const out = [];
  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const cells = directChildren(rows[ri], W_NS, 'tc');
    const wordingRaw = wordingCol >= 0 && cells[wordingCol] ? cellText(cells[wordingCol]) : '';
    const lines = wordingRaw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const qtyRaw = qtyCol >= 0 && cells[qtyCol] ? cellText(cells[qtyCol]).trim() : '';
    const kod = kodCol >= 0 && cells[kodCol] ? cellText(cells[kodCol]).trim() : '';
    out.push({ lines, qty: Number(qtyRaw) || 0, kod });
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
//     -> tahun=TAHUN 1, namaKelas='', subject=ALQURAN (the line 3 text,
//        a real subject name here rather than a placing)
//   2 lines, line 2 is "TAHUN N <class>", no third line at all
//     -> tahun=TAHUN N, namaKelas=<class>, subject='KUANTITI' (no real
//        subject/position axis for this award — just one plaque per class)
//   2 lines, line 2 does NOT look like a Tahun at all (e.g. "PELAJAR
//   LELAKI 2024") -> there's no Tahun/Kelas axis here either; line 2 is
//     itself the "class" (really just this row's own distinguishing
//     label), subject='KUANTITI' — the same trick TOKOH's own award-type
//     rows already use on the Excel side.
const TAHUN_LINE_RE = /^TAHUN\s*([1-6])\s*(.*)$/i;
function classifyWordingLines(lines) {
  const title = lines[0];
  const rest = lines.slice(1);
  if (rest.length === 0) return { title, tahun: '', namaKelas: '', subjectName: 'KUANTITI' };
  const m = rest[0].match(TAHUN_LINE_RE);
  if (m) {
    return { title, tahun: `TAHUN ${m[1]}`, namaKelas: (m[2] || '').trim(), subjectName: rest.length >= 2 ? rest[1] : 'KUANTITI' };
  }
  if (rest.length >= 2) return { title, tahun: '', namaKelas: rest[0], subjectName: rest[1] };
  return { title, tahun: '', namaKelas: rest[0], subjectName: 'KUANTITI' };
}

// Top-level entry point — same return shape as excelImport.js's
// parseFormAnugerahExcel (`{ klasMatrix: { sections } } | { error } `), so
// AppState.jsx merges either file type through the same code path. Every
// award title (line 1 of the WORDING cell) becomes its own section,
// regardless of which physical Word table(s) it appears across — a long
// award list commonly gets split into several tables purely by a page
// break, which isn't a real section boundary. Never throws.
export async function parseWordingDocx(arrayBuffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
  } catch {
    return { klasMatrix: null, error: 'Could not read this file — please make sure it is a valid .docx file.' };
  }
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) return { klasMatrix: null, error: 'Could not read this file — please make sure it is a valid .docx file.' };
  const xmlText = await xmlFile.async('text');
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { klasMatrix: null, error: 'Could not read this file — please make sure it is a valid .docx file.' };
  }

  const sectionOrder = [];
  const sectionsByTitle = new Map();
  Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).forEach((tbl) => {
    readWordingRows(tbl).forEach(({ lines, qty, kod }) => {
      if (qty <= 0) return;
      const { title, tahun, namaKelas, subjectName } = classifyWordingLines(lines);
      let section = sectionsByTitle.get(title);
      if (!section) {
        section = { lines: { 0: title }, classesByKey: new Map(), classOrder: [], jenisPlak: '' };
        sectionsByTitle.set(title, section);
        sectionOrder.push(title);
      }
      if (!section.jenisPlak && kod) section.jenisPlak = kod;
      const classKey = `${tahun}||${namaKelas}`;
      let cls = section.classesByKey.get(classKey);
      if (!cls) {
        cls = { tahunFrom: tahun, tahunTo: tahun, namaKelas, subjects: [] };
        section.classesByKey.set(classKey, cls);
        section.classOrder.push(classKey);
      }
      cls.subjects.push({ name: subjectName, qty });
    });
  });

  const sections = sectionOrder.map((title) => {
    const s = sectionsByTitle.get(title);
    return { lines: s.lines, classes: s.classOrder.map((k) => s.classesByKey.get(k)), jenisPlak: s.jenisPlak };
  });
  if (sections.length === 0) {
    return { klasMatrix: null, error: 'No recognized WORDING/KUANTITI table found in this file.' };
  }
  return { klasMatrix: { sections } };
}
