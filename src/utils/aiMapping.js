import * as XLSX from 'xlsx';
import { makeDynamicCategoryKey } from '../data/catalog';
import { classifyWordingLines, cleanDocxPlakCode, parseDocxQty, wordingRowsToCategorized } from './docxImport';

// Turns the AI sheet reader's answer (supabase/functions/read-order-file —
// a MAPPING of which rows/columns hold what, by cell reference) into the
// same `{ categorized, notes }` shape excelImport.js/docxImport.js return.
// The AI never types a value: every word and number here is read back from
// the file's own structure map (fileIr.js) by this code. Anything the map
// doesn't support (a ref outside the sheet, a quantity that isn't a whole
// number, a blank formula cell, the AI saying it isn't sure) becomes a note
// for the teacher instead of a guess.
//
// Two block roles:
//   award-list   one row per plaque/award: wordingColumns (top to bottom
//                = engraving lines) + qtyColumn (+ codeColumn or codeCell,
//                + an optional titleCell prepended as line 1). Grouped
//                exactly like a Word order table.
//   class-matrix rows = subjects/placings (labelColumn), columns = classes
//                (classColumns, class name in headerRow), qty at each
//                crossing; one award per sheet (titleCell, codeCell).

const TOTAL_RE = /^(JUMLAH|TOTAL|JUMLAH BESAR|GRAND TOTAL)\b/i;
const COL_RE = /^[A-Z]{1,3}$/;
const REF_RE = /^[A-Z]{1,3}[1-9]\d*$/;

function mergeTopLeft(block) {
  const map = new Map();
  block.merges.forEach((range) => {
    const { s, e } = XLSX.utils.decode_range(range);
    const tl = XLSX.utils.encode_cell(s);
    for (let r = s.r; r <= e.r; r++) for (let c = s.c; c <= e.c; c++) map.set(XLSX.utils.encode_cell({ r, c }), tl);
  });
  return map;
}

function makeReader(block) {
  const tl = mergeTopLeft(block);
  const blankFormula = new Set(block.formulaNoValue);
  return {
    text(ref) { return block.cells[ref] ?? block.cells[tl.get(ref)] ?? ''; },
    isBlankFormula(ref) { return blankFormula.has(ref); },
  };
}

function checkRows(m, block, where, notes) {
  const first = m.firstRow;
  const last = m.lastRow;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > block.maxRow) {
    notes.push(`${where}: the AI gave a row range (${first}–${last}) that isn't inside this sheet — please add it by hand.`);
    return false;
  }
  return true;
}

function badCols(cols) {
  return cols.filter((c) => c != null && !COL_RE.test(c));
}

function readAwardList(m, block, where, notes) {
  const rd = makeReader(block);
  const wordingCols = m.wordingColumns || [];
  const bad = badCols([...wordingCols, m.qtyColumn, m.codeColumn]);
  if (bad.length || wordingCols.length === 0 || !m.qtyColumn) {
    notes.push(`${where}: the AI's column choice can't be used (${bad.join(', ') || 'missing wording or quantity column'}) — please add this sheet by hand.`);
    return [];
  }
  const title = m.titleCell ? rd.text(m.titleCell) : '';
  const blockCode = m.codeCell ? cleanDocxPlakCode(rd.text(m.codeCell)) : '';
  const rows = [];
  let sum = 0;
  for (let r = m.firstRow; r <= m.lastRow; r++) {
    const lines = wordingCols.map((c) => rd.text(`${c}${r}`)).filter(Boolean);
    const qtyRef = `${m.qtyColumn}${r}`;
    const qtyRaw = rd.text(qtyRef);
    if (lines.length === 0 && !qtyRaw) {
      if (rd.isBlankFormula(qtyRef)) notes.push(`${where}, row ${r}: the quantity is a formula with no saved value — open the file in Excel, save it, and upload again, or type it by hand.`);
      continue;
    }
    if (lines.length && TOTAL_RE.test(lines[0])) {
      const stated = parseDocxQty(qtyRaw);
      if (stated != null && stated !== sum) notes.push(`${where}, row ${r}: the sheet's JUMLAH/TOTAL says ${stated}, but the rows above it add up to ${sum} — please check nothing is missing.`);
      continue;
    }
    const qty = parseDocxQty(qtyRaw);
    if (lines.length === 0) {
      notes.push(`${where}, row ${r}: has a quantity ("${qtyRaw}") but no wording — please add it by hand if it is needed.`);
      continue;
    }
    if (qty == null) {
      if (rd.isBlankFormula(qtyRef)) notes.push(`${where}, row ${r}: the quantity for "${lines.join(' / ')}" is a formula with no saved value — please type it by hand.`);
      else if (qtyRaw) notes.push(`${where}, row ${r}: couldn't read the quantity "${qtyRaw}" for "${lines.join(' / ')}" — please add it by hand.`);
      continue;
    }
    if (qty <= 0) continue;
    sum += qty;
    const kod = m.codeColumn ? cleanDocxPlakCode(rd.text(`${m.codeColumn}${r}`)) || blockCode : blockCode;
    rows.push({ lines: title ? [title, ...lines] : lines, qty, kod });
  }
  return rows;
}

function readClassMatrix(m, block, where, notes) {
  const rd = makeReader(block);
  const classCols = m.classColumns || [];
  const bad = badCols([...classCols, m.labelColumn]);
  if (bad.length || classCols.length === 0 || !m.labelColumn || !Number.isInteger(m.headerRow) || m.headerRow < 1 || m.headerRow > block.maxRow) {
    notes.push(`${where}: the AI's layout for this matrix can't be used — please add this sheet by hand.`);
    return null;
  }
  const title = m.titleCell ? rd.text(m.titleCell) : '';
  if (!title) notes.push(`${where}: no award title (ACARA) was found — please type it by hand.`);
  const classes = classCols.map((c) => {
    const header = rd.text(`${c}${m.headerRow}`);
    const { tahun, namaKelas } = classifyWordingLines(['', header]);
    return { col: c, header, cls: { tahunFrom: tahun, tahunTo: tahun, namaKelas, subjects: [] } };
  });
  classes.filter((k) => !k.header).forEach((k) => notes.push(`${where}: column ${k.col} has no class name in row ${m.headerRow} — please check it.`));
  for (let r = m.firstRow; r <= m.lastRow; r++) {
    const label = rd.text(`${m.labelColumn}${r}`);
    if (!label || TOTAL_RE.test(label)) continue;
    classes.forEach(({ col, cls }) => {
      const ref = `${col}${r}`;
      const raw = rd.text(ref);
      if (!raw) {
        if (rd.isBlankFormula(ref)) notes.push(`${where}, ${ref}: a formula with no saved value — please type the quantity by hand.`);
        return;
      }
      const qty = parseDocxQty(raw);
      if (qty == null) { notes.push(`${where}, ${ref}: couldn't read the quantity "${raw}" — please add it by hand.`); return; }
      if (qty > 0) cls.subjects.push({ name: label, qty });
    });
  }
  const used = classes.map((k) => k.cls).filter((cls) => cls.subjects.length > 0);
  if (used.length === 0) return null;
  const lines = { 2: title };
  return { lines, classes: used, jenisPlak: m.codeCell ? cleanDocxPlakCode(rd.text(m.codeCell)) : '' };
}

// `ir` = fileIr.js's buildWorkbookIr output; `mapping` = the edge
// function's `mapping` ({ blocks:[…], questions:[…] }). Never throws.
export function applyAiMapping(ir, mapping) {
  const notes = [];
  const categorized = {};
  const blocksByName = new Map(ir.blocks.map((b) => [b.name, b]));
  const listRows = [];
  const seen = new Set();
  (mapping?.blocks || []).forEach((m) => {
    const block = blocksByName.get(m.sheet);
    const where = `Sheet "${m.sheet}"`;
    if (!block) { notes.push(`${where}: the AI named a sheet that isn't in this file — ignored.`); return; }
    if (m.role === 'ignore') { seen.add(m.sheet); return; }
    const refs = [m.titleCell, m.codeCell].filter(Boolean);
    if (refs.some((ref) => !REF_RE.test(ref))) { notes.push(`${where}: the AI gave a cell reference that isn't valid — please add this sheet by hand.`); return; }
    if (!checkRows(m, block, where, notes)) return;
    seen.add(m.sheet);
    if (m.confidence === 'low') notes.push(`${where}: the AI wasn't sure how to read this sheet — please check every row carefully.`);
    if (m.note) notes.push(`${where}: ${m.note}`);
    if (m.role === 'award-list') {
      listRows.push(...readAwardList(m, block, where, notes));
    } else if (m.role === 'class-matrix') {
      const section = readClassMatrix(m, block, where, notes);
      if (!section) return;
      section.sourceSheet = m.sheet;
      const key = makeDynamicCategoryKey('KLAS_MATRIX', m.sheet);
      if (categorized[key]) { notes.push(`${where}: more than one matrix on this sheet — only the first was read; please add the rest by hand.`); return; }
      categorized[key] = [section];
    } else {
      notes.push(`${where}: unknown layout "${m.role}" — please add this sheet by hand.`);
    }
  });
  if (listRows.length) Object.assign(categorized, wordingRowsToCategorized(listRows).categorized);
  ir.blocks.filter((b) => b.truncated).forEach((b) => notes.push(`Sheet "${b.name}": only the first 400 rows / 60 columns were sent to the AI — please add anything beyond that by hand.`));
  ir.blocks.filter((b) => !seen.has(b.name)).forEach((b) => notes.push(`Sheet "${b.name}": the AI didn't read this sheet — please add its data by hand if needed.`));
  (mapping?.questions || []).forEach((q) => notes.push(`${q.sheet ? `Sheet "${q.sheet}": ` : ''}${q.text}`));
  return { categorized, notes };
}
