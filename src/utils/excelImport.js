import * as XLSX from 'xlsx';
import { ordinalToNum, resolveSelempangWarna } from '../data/catalog';

// Reads a teacher's own filled-in copy of the FORM ANUGERAH Excel template —
// not just the new "KLAS MATRIX" sheet, but the ORIGINAL sheets teachers
// actually reuse from past orders (FRONT PG isn't included — its top labels
// have no clearly-marked value cells to read from safely). Real past orders
// turned out to deviate a lot from the blank template's own row positions —
// an optional line left blank often just isn't there at all (rows shift up
// instead of leaving a gap), and a single sheet can hold several completely
// independent awards stacked one after another, each with its own title and
// Jenis Plak, sometimes even in a sheet whose NAME doesn't match what's
// actually in it (a salesman just used whatever blank space was left). So
// instead of fixed cell coordinates, this scans every sheet for a handful of
// reliably-present LABEL WORDS ("JENIS PLAK", "TAHUN", "KUANTITI",
// "KEDUDUKAN", "NAMA KELAS", "SUBJEK", "NAMA MURID"/"NAMA GURU") wherever
// they actually land, and reconstructs each independent award/section from
// its position relative to those labels.
//
// Every recognized shape — a genuine subject-by-class grid, a plain
// Tahun/Nama Kelas quantity list, a subject list with no class axis, a named
// recipient roster, even TOKOH's own award-type list — is normalized into
// the SAME { tahunFrom, tahunTo, namaKelas, subjects: [{name, qty}] } "class
// row" shape and funnelled into ONE destination: KLAS_MATRIX (Mata
// Pelajaran/Klas (Matrix)), each independent award becoming its own
// Duplicate-able section there (catalog.js's KLAS_MATRIX `multiBlock`).
// Deliberately a single landing spot rather than splitting across several
// categories — a teacher (or office staff double-checking the import)
// only has one place to look to see everything a file produced, instead of
// having to hop between tabs to find out where each piece landed. A section
// with no real class/subject axis at all (a flat subject list, a roster of
// names) still fits: it becomes class rows with a single "KUANTITI" column,
// or one class row per named subject — see the shape readers below.

const TAHUN_OPTIONS = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'];

// Which sheets have their own dedicated real category (catalog.js) rather
// than folding into the generic KLAS_MATRIX catch-all — see
// parseFormAnugerahExcel's `categorized` split at the bottom of this file.
// Filled in one sheet at a time as each one's own parser/category ships;
// a sheet not listed here still lands in KLAS_MATRIX exactly as before.
const SOURCE_SHEET_TO_CATEGORY = {
  PPKI: 'PPKI',
  'MP THP 1': 'MP1',
  // Its own separate category from MP1 (catalog.js) — a school fills in
  // ONE of these two sheets, never both, and this way whichever one a file
  // used lands in its own tab instead of the two competing for one slot.
  'MP THP 1 (Kalau ada kelas)': 'MP1_KELAS',
  'MP THP 2': 'MP2',
  'MP THP 2 (Kalau ada kelas)': 'MP2_KELAS',
  PBD: 'PBD',
  'ALIRAN TERBAIK': 'ALIRAN',
  'LONJAKAN SAUJANA': 'LONJAKAN',
  'KEHADIRAN PENUH': 'KEHADIRAN',
  TOKOH: 'TOKOH_SHEET',
  SELEMPANG: 'SELEMPANG',
};

function normalizeTahun(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (TAHUN_OPTIONS.includes(s)) return s;
  const digit = s.match(/[1-6]/);
  if (digit) {
    const opt = `TAHUN ${digit[0]}`;
    if (TAHUN_OPTIONS.includes(opt)) return opt;
  }
  return '';
}

function cellAt(ws, row, col) {
  return ws[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })];
}
// A quantity table's own total/summary row — its label is "TOTAL" or the
// Malay "JUMLAH" ("JUMLAH BESAR", "JUMLAH KESELURUHAN", ...). Every
// row-reader below stops here rather than reading the grand total as one
// more class/subject row.
function isTotalLabel(text) {
  return /^(TOTAL|JUMLAH)\b/i.test(String(text || '').trim());
}
function cellStr(ws, row, col) {
  const cell = cellAt(ws, row, col);
  return cell && cell.v != null ? String(cell.v).trim() : '';
}
function cellNum(ws, row, col) {
  const cell = cellAt(ws, row, col);
  if (!cell || cell.v == null || cell.v === '') return 0;
  const n = Number(cell.v);
  return Number.isFinite(n) ? n : 0;
}
// The unfilled template's own Reference Sample cells hold a literal
// placeholder string — either underscores ("_ _ _ _ ...") or, on sheets
// like MP THP 1, plain hyphens ("-----...") — for the printed underline a
// teacher would otherwise write on top of. A real, non-blank cell VALUE,
// not visual formatting, so a naive read treats an entirely-untouched
// sheet as if it were filled in.
function isPlaceholderDash(str) {
  return /^[-_\s]+$/.test(str);
}
function cellText(ws, row, col) {
  const val = cellStr(ws, row, col);
  return isPlaceholderDash(val) ? '' : val;
}

function sheetRange(ws) {
  const ref = ws['!ref'];
  if (!ref) return { r1: 1, r2: 1, c1: 1, c2: 1 };
  const dec = XLSX.utils.decode_range(ref);
  return { r1: dec.s.r + 1, r2: dec.e.r + 1, c1: dec.s.c + 1, c2: dec.e.c + 1 };
}

// Scans the whole sheet for cells whose text exactly matches (case/space
// insensitive) one of `labels` — the anchors everything else below is
// positioned relative to.
function findLabelCells(ws, range, labels) {
  const upperLabels = labels.map((l) => l.toUpperCase());
  const found = [];
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const val = cellStr(ws, r, c);
      if (!val) continue;
      const upper = val.toUpperCase();
      if (upperLabels.includes(upper)) found.push({ row: r, col: c, label: upper });
    }
  }
  return found;
}

// KLAS_MATRIX-bound sheets have 4 real lines (TAJUK BESAR/YEAR/ACARA/TAHUN)
// — a real order just writes into however many of the first few it needs,
// top to bottom, skipping the optional YEAR line entirely rather than
// leaving a gap in the middle. TOKOH only has 3 real lines to begin with
// (TAJUK BESAR/YEAR/ACARA, no TAHUN slot at all) with no YEAR-skip pattern
// observed in practice, so it gets its own, different by-count table.
// A KLAS_MATRIX / MP THP sample box is laid out event-title / award-name /
// subject-example / tahun-example — NOT event-title / YEAR / award / tahun.
// So a 4-line box fills TAJUK BESAR (0), ACARA (2), the SUBJEK/POSITION
// example (2b) and the TAHUN example (3); YEAR (1) is left blank.
const KLAS_MATRIX_SLOTS_BY_COUNT = { 0: [], 1: [], 2: ['0', '2'], 3: ['0', '2', '3'], 4: ['0', '2', '2b', '3'] };

// A YEAR / SESI line a school typed on its own, directly under TAJUK
// BESAR — "2025", "2024/2025", "2024 / 25", "SESI 2024/2025", "TAHUN
// 2025". Deliberately does NOT match "TAHUN 1".."TAHUN 6" (a TAHUN
// example, slot '3') or a bare award name.
const STANDALONE_YEAR_RE = /^(SESI\s+|TAHUN\s+)?(19|20)\d{2}\s*(\/\s*(19|20)?\d{2})?$/i;

// Collects Reference Sample lines from a row-band (any column) — reads
// whatever non-blank text appears there, in row order, and maps by COUNT
// rather than fixed position (see slotsByCount tables above) since a real
// order just writes into however many lines it needs rather than leaving a
// gap for a skipped optional one.
function readRefLinesInBand(ws, range, rowStart, rowEnd, slotsByCount = KLAS_MATRIX_SLOTS_BY_COUNT) {
  const maxSlots = Math.max(...Object.keys(slotsByCount).map(Number));
  const values = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    const rowValues = [];
    for (let c = range.c1; c <= range.c2; c++) {
      const val = cellText(ws, r, c);
      if (val) rowValues.push(val);
    }
    // A row can hold more than one distinct text run (e.g. a school typed
    // the title across two merged cells) — keep them as ONE line, joined,
    // since they're on the same physical printed line.
    if (rowValues.length) values.push(rowValues.join(' '));
    // +1 headroom so a pulled-out YEAR line (below) doesn't cost the band
    // its last real slot.
    if (values.length >= maxSlots + 1) break;
  }
  // A standalone year line the school wrote right under the title. The
  // YEAR reference-sample row is retired (computeBlocks.js / exportCsv.js),
  // so instead of parking it in slot 1 it's folded onto the TAJUK BESAR as
  // a second engraved line (slot 0b, via splitTwoLineTajuk) — it still
  // reaches the plaque, in event_header. Pulled out here before the
  // by-count mapping so it isn't counted as ACARA and doesn't push every
  // following line down a slot.
  const tableHasYearSlot = Object.values(slotsByCount).some((arr) => arr.includes('1'));
  let yearLine = '';
  if (!tableHasYearSlot && values.length >= 2 && STANDALONE_YEAR_RE.test(values[1].trim())) {
    [yearLine] = values.splice(1, 1);
  }
  const slots = slotsByCount[Math.min(values.length, maxSlots)] || slotsByCount[maxSlots];
  const lines = {};
  values.slice(0, slots.length).forEach((val, i) => { lines[slots[i]] = val; });
  if (yearLine) lines['0'] = [lines['0'], yearLine.trim()].filter(Boolean).join('\n');
  return splitTwoLineTajuk(lines);
}

// A TAJUK BESAR the teacher wrote as two lines — an in-cell line break
// (Alt+Enter) inside the one cell — is split into slot 0 + slot 0b, the
// same two-line header shape an AI pre-write / roster import already
// produces (computeBlocks.js renders 0b as its own numbered line; exportCsv
// rejoins the two with a newline for the CSV's event_header column). Only
// the first break splits; any further text stays on the second line.
function splitTwoLineTajuk(lines) {
  const raw = lines['0'];
  if (!raw || lines['0b'] || !/\r?\n/.test(raw)) return lines;
  const parts = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) { lines['0'] = parts[0] || ''; return lines; }
  lines['0'] = parts[0];
  lines['0b'] = parts.slice(1).join(' ');
  return lines;
}


// A single class-shaped mini-order's own quantity/subject data, read from
// whichever shape its own header row turned out to be (see classifyShape
// below) — always normalized to the same { tahunFrom, tahunTo, namaKelas,
// subjects: [{name, qty}] } shape KLAS_MATRIX's own "KLAS MATRIX" sheet
// reader already produces, so both feed the same merge/import step.
function readTahunQtyRows(ws, range, { tahunCol, qtyCol, startRow, endRow, subjectLabel }) {
  const classes = [];
  for (let r = startRow; r <= endRow; r++) {
    const label = cellText(ws, r, tahunCol);
    if (isTotalLabel(label)) break;
    const qty = cellNum(ws, r, qtyCol);
    if (!label || qty <= 0) continue;
    const tahun = normalizeTahun(label);
    classes.push({ tahunFrom: tahun, tahunTo: tahun, namaKelas: tahun ? '' : label, subjects: [{ name: subjectLabel, qty }] });
  }
  return classes;
}
// A Nama Kelas list commonly writes the class name as "<grade> <name>"
// (e.g. "1 ARIF" — Tahun 1's own "ARIF" class, "6 ARIF" — Tahun 6's own
// "ARIF" class, a different class that happens to share the name) rather
// than listing Tahun and Nama Kelas separately — the leading digit is the
// grade, not part of the class's own name. Split it out into a real Tahun
// range so the imported row doesn't end up with "1 ARIF" as a literal Nama
// Kelas AND a blank, unfilled Tahun Dari/Hingga.
function splitGradeFromNamaKelas(text) {
  const m = String(text).trim().match(/^([1-6])\s+(.+)$/);
  if (!m) return { tahun: '', namaKelas: text };
  return { tahun: `TAHUN ${m[1]}`, namaKelas: m[2] };
}
function readNamaKelasQtyRows(ws, range, { namaKelasCol, qtyCol, startRow, endRow, subjectLabel }) {
  const classes = [];
  for (let r = startRow; r <= endRow; r++) {
    const raw = cellText(ws, r, namaKelasCol);
    if (isTotalLabel(raw)) break;
    const qty = cellNum(ws, r, qtyCol);
    if (!raw || qty <= 0) continue;
    const { tahun, namaKelas } = splitGradeFromNamaKelas(raw);
    classes.push({ tahunFrom: tahun, tahunTo: tahun, namaKelas, subjects: [{ name: subjectLabel, qty }] });
  }
  return classes;
}

// A "grade × class" order: a TAHUN 1..6 column, each with its own KUANTITI,
// AND a separate NAMA KELAS list (AMANAH, BUDIMAN, ...) beside it. Every
// class in the list exists in every year, so the real plaque list is the
// two axes crossed — "1 AMANAH", "1 BUDIMAN", ... "6 HARMONI". Per-class
// quantity comes from a "SETIAP KELAS N PLAK" note written in the KUANTITI
// cell; failing that, the grade's KUANTITI divided by the number of
// classes (e.g. 35 / 7 = 5). Each crossed entry becomes its own
// KLAS_MATRIX class row — Nama Kelas "<grade> <class>", one blank subject
// carrying the qty — matching the Reference Sample's own "1 AMANAH"
// example. The NAMA KELAS list is read from its own column independently
// of the TAHUN list's length (a school often writes one more class name
// than there are grade rows, on the same row as the TOTAL).
function readGradeClassExpansion(ws, { tahunCol, qtyCol, namaKelasCol, startRow, endRow }) {
  const grades = [];
  let sawSetiapKelas = false;
  for (let r = startRow; r <= endRow; r++) {
    const label = cellText(ws, r, tahunCol);
    if (isTotalLabel(label)) break;
    if (!label) continue;
    const qtyCell = cellStr(ws, r, qtyCol);
    const per = qtyCell.match(/SETIAP\s+KELAS\s+(\d+)/i);
    if (/SETIAP\s+KELAS/i.test(qtyCell)) sawSetiapKelas = true;
    const total = Number((qtyCell.match(/\d+/) || [])[0]) || 0;
    const gradeNum = (label.match(/(\d+)/) || [])[1] || label.trim();
    grades.push({ gradeNum, perClass: per ? Number(per[1]) : null, total });
  }
  // The "SETIAP KELAS N PLAK" marker is what makes this specific two-axis
  // shape unambiguous — without it, a plain "NAMA KELAS + TAHUN + KUANTITI"
  // table means something else entirely and must not be crossed out.
  if (!sawSetiapKelas) return [];
  const classNames = [];
  for (let r = startRow; r <= endRow + 5; r++) {
    const nm = cellText(ws, r, namaKelasCol);
    if (!nm || isTotalLabel(nm)) {
      if (classNames.length) break;
      continue;
    }
    classNames.push(nm);
  }
  if (grades.length === 0 || classNames.length === 0) return [];
  const classes = [];
  grades.forEach((g) => {
    const qty = g.perClass != null
      ? g.perClass
      : (g.total > 0 ? Math.round(g.total / classNames.length) : 0);
    if (qty <= 0) return;
    classNames.forEach((cn) => {
      classes.push({
        tahunFrom: '', tahunTo: '', namaKelas: `${g.gradeNum} ${cn}`.trim(),
        subjects: [{ name: '', qty }],
      });
    });
  });
  return classes;
}

// A "TAHAP" sheet: the header row repeats "NAMA KELAS | TAHUN" 2-3 times,
// one pair per year — each NAMA KELAS column a different (and differently
// long) class list, the paired TAHUN column just that year's number
// repeated down it. The real plaque list is each class crossed with ITS
// OWN year: "1 TITANIA", "1 BELLATRIX", ..., then "2 TITANIA", ... One
// plaque each. Read straight down each column here (exact) rather than
// leaving the model to un-interleave the flattened text (it miscounts).
function readParallelClassLists(ws, range, { pairs, startRow, eline2 }) {
  const classes = [];
  pairs.forEach(({ nameCol, yearCol }) => {
    let year = '';
    for (let r = startRow; r <= range.r2 && !year; r++) {
      const m = cellText(ws, r, yearCol).match(/\d+/);
      if (m) year = m[0];
    }
    let blanks = 0;
    for (let r = startRow; r <= range.r2; r++) {
      const name = cellText(ws, r, nameCol);
      if (!name || isTotalLabel(name)) {
        blanks += 1;
        if (blanks >= 3) break;
        continue;
      }
      blanks = 0;
      classes.push({
        tahunFrom: '', tahunTo: '',
        namaKelas: year ? `${year} ${name}` : name,
        eline2: eline2 || '',
        subjects: [{ name: '', qty: 1 }],
      });
    }
  });
  return classes;
}
// MP THP-style subject-by-class matrix: SUBJECT names run down a column,
// class-level labels (PPKI/PRASEKOLAH/TAHUN N) run across a row — each
// class-level COLUMN becomes one KLAS_MATRIX class row (transposed),
// carrying every subject's own qty from that column.
function readSubjectMatrix(ws, range, { subjectCol, subjectStartRow, subjectEndRow, classHeaderRow, classCols }) {
  const subjectNames = [];
  // The teacher's own "TOTAL" row (where the subject names end) is also a
  // cross-check: its per-column figure is what the teacher believes each
  // class column adds up to. Captured here (not just used as a stop marker)
  // so a column whose filled cells don't match its own TOTAL can be
  // surfaced as a question on Step 2 — see importChecks.js checkColumnTotals.
  let totalRow = null;
  for (let r = subjectStartRow; r <= subjectEndRow; r++) {
    const name = cellText(ws, r, subjectCol);
    if (isTotalLabel(name)) { totalRow = r; break; }
    if (name) subjectNames.push({ row: r, name });
  }
  const classes = [];
  const statedTotals = {};
  classCols.forEach((col) => {
    const label = cellText(ws, classHeaderRow, col);
    if (!label) return;
    const subjects = [];
    subjectNames.forEach(({ row, name }) => {
      const qty = cellNum(ws, row, col);
      if (qty > 0) subjects.push({ name, qty });
    });
    if (subjects.length === 0) return;
    const tahun = normalizeTahun(label);
    classes.push({ tahunFrom: tahun, tahunTo: tahun, namaKelas: tahun ? '' : label, subjects });
    if (totalRow != null) {
      const stated = cellNum(ws, totalRow, col);
      if (stated > 0) statedTotals[label] = stated;
    }
  });
  // Every subject name in sheet order — including any the teacher renamed
  // or added, and ones left blank in every column (a real award row with no
  // qty typed yet). Categories flagged `subjectsFromImport` (catalog.js)
  // rebuild their editable matrix rows straight off this list rather than
  // the fixed catalog one.
  return { classes, statedTotals, subjectNames: subjectNames.map((s) => s.name) };
}
// A subject list with no class axis at all — each row is just its own
// Description (subject name) and QTY, the same flat shape Mata Pelajaran/
// Klas (OTHERS) already uses for a teacher-typed row.
function readSubjectFlatRows(ws, { subjectCol, qtyCol, startRow, endRow }) {
  const rows = [];
  for (let r = startRow; r <= endRow; r++) {
    const desc = cellText(ws, r, subjectCol);
    if (isTotalLabel(desc)) break;
    const qty = cellNum(ws, r, qtyCol);
    if (!desc || qty <= 0) continue;
    rows.push({ desc, qty });
  }
  return rows;
}

const SHAPE_LABELS = ['TAHUN', 'KUANTITI', 'KEDUDUKAN', 'NAMA KELAS', 'SUBJEK'];

// Finds every independent award/section on one sheet by walking its
// "JENIS PLAK" footers top to bottom — each one closes out the section
// above it. For each, looks upward (within the band since the previous
// footer) for the nearest row carrying one of SHAPE_LABELS to figure out
// what shape of quantity table this section has (or none at all — some
// real sections are just a flat qty with no breakdown), then reads the
// Reference Sample lines from whatever's left over above that.
function scanSheetForSections(ws) {
  const range = sheetRange(ws);
  const shapeLabels = findLabelCells(ws, range, SHAPE_LABELS);
  const shapeRows = new Set(shapeLabels.map((h) => h.row));
  // Some sheets (LONJAKAN SAUJANA, TOKOH) also print "JENIS PLAK"/"HARGA" as
  // decorative column labels sitting on the SAME row as the real "TAHUN"/
  // "KUANTITI" table header (a little preview of the footer table's own
  // headers, not an actual second data-entry footer) — the real data always
  // goes into a separate, properly-isolated "JENIS PLAK" footer further
  // down. Counting the decorative one as its own section would both create
  // a bogus empty section AND push the real footer's own search band past
  // the actual table header it needs to find.
  const plakAnchors = findLabelCells(ws, range, ['JENIS PLAK'])
    .filter((a) => !shapeRows.has(a.row))
    .sort((a, b) => a.row - b.row);
  if (plakAnchors.length === 0) return [];

  const sections = [];
  let bandStart = range.r1;

  plakAnchors.forEach((plakAnchor) => {
    const candidates = shapeLabels.filter((h) => h.row >= bandStart && h.row < plakAnchor.row);
    let classes = [];
    let statedTotals = null; // subject-matrix shape only — the teacher's own per-column TOTAL row
    let parallelEline2 = ''; // "TAHAP 1" / "TAHAP 2" — a fixed engraved line for a parallel-list section
    let headerRow = plakAnchor.row; // default: no table found, ref-line band runs right up to the footer
    if (candidates.length > 0) {
      headerRow = Math.max(...candidates.map((h) => h.row));
      const onRow = candidates.filter((h) => h.row === headerRow);
      const byLabel = (label) => onRow.find((h) => h.label === label);
      const tahunH = byLabel('TAHUN');
      const kuantitiH = byLabel('KUANTITI');
      const kedudukanH = byLabel('KEDUDUKAN');
      const namaKelasH = byLabel('NAMA KELAS');
      const subjekH = byLabel('SUBJEK');
      const qtyH = kuantitiH || kedudukanH;
      const qtyLabel = kuantitiH ? 'KUANTITI' : 'KEDUDUKAN';
      // Several parallel "NAMA KELAS | TAHUN" pairs on the header row
      // (TAHAP 1 / 2 — one class list per year). Pair each NAMA KELAS
      // column with the next TAHUN column to its right and read every list
      // straight down.
      const nkHeaders = onRow.filter((h) => h.label === 'NAMA KELAS').sort((a, b) => a.col - b.col);
      const yrHeaders = onRow.filter((h) => h.label === 'TAHUN').sort((a, b) => a.col - b.col);
      const parallelPairs = nkHeaders.length > 1
        ? nkHeaders.map((nk) => ({ nameCol: nk.col, yearCol: (yrHeaders.find((t) => t.col > nk.col) || {}).col }))
          .filter((p) => p.yearCol != null)
        : [];

      if (parallelPairs.length > 1) {
        // eline2: a fixed extra line the sample box shows below the class
        // example — "TAHAP 1" / "TAHAP 2". Pulled off the ref band here so
        // it doesn't land in a reference-sample slot.
        const bandVals = [];
        for (let r = bandStart; r < headerRow; r++) {
          for (let c = range.c1; c <= range.c2; c++) {
            const v = cellText(ws, r, c);
            if (v) { bandVals.push(v); break; }
          }
        }
        if (bandVals.length >= 4 && /^TAHAP\b/i.test(bandVals[bandVals.length - 1])) {
          parallelEline2 = bandVals[bandVals.length - 1];
        }
        classes = readParallelClassLists(ws, range, {
          pairs: parallelPairs, startRow: headerRow + 1, eline2: parallelEline2,
        });
      } else if (subjekH) {
        // Class-level labels sit either beside SUBJEK on the same row, or on
        // the row directly below it (MP THP 2's own 2-row header) — whichever
        // has more non-blank cells to the right of the subject column wins.
        // The qty/tahun/nama-kelas label CELL itself doesn't count as a
        // class column even when it lands in this same range (e.g. a
        // "KUANTITI" header spanning the whole class-level block above it,
        // sharing a column with a real class label one row down) — only
        // that exact cell is excluded, not its whole column, since a real
        // class label can legitimately share a column with an unrelated
        // label cell on a different row. A class label is always a name
        // ("TAHUN 1", "PRASEKOLAH", "PPKI") — never a bare number — so a
        // purely-numeric cell doesn't count as one either; without that, a
        // flat subject list with no class breakdown at all (just SUBJEK and
        // KUANTITI side by side on ONE row) gets its own first DATA row —
        // the qty number sitting directly under an empty cell right of
        // SUBJEK — mistaken for a genuine second header row, silently
        // dropping that row and fabricating a bogus "class" from its qty.
        const isNumericText = (s) => /^-?\d+(\.\d+)?$/.test(s.trim());
        const isLabelCell = (r, c) => [qtyH, tahunH, namaKelasH].some((h) => h && h.row === r && h.col === c);
        const rightCols = [];
        for (let c = subjekH.col + 1; c <= range.c2; c++) rightCols.push(c);
        const isRealLabel = (r, c) => {
          if (isLabelCell(r, c)) return false;
          const text = cellText(ws, r, c);
          return !!text && !isNumericText(text);
        };
        const sameRowLabels = rightCols.filter((c) => isRealLabel(headerRow, c));
        const belowRowLabels = rightCols.filter((c) => isRealLabel(headerRow + 1, c));
        const classCols = belowRowLabels.length > sameRowLabels.length ? belowRowLabels : sameRowLabels;
        const classHeaderRow = belowRowLabels.length > sameRowLabels.length ? headerRow + 1 : headerRow;
        if (classCols.length > 0) {
          const matrix = readSubjectMatrix(ws, range, {
            subjectCol: subjekH.col, subjectStartRow: headerRow + (classHeaderRow > headerRow ? 2 : 1),
            subjectEndRow: plakAnchor.row - 1, classHeaderRow, classCols,
          });
          classes = matrix.classes;
          if (Object.keys(matrix.statedTotals).length > 0) statedTotals = matrix.statedTotals;
        } else {
          // No class-level columns at all next to SUBJEK — just a subject
          // name and a single qty each, with no genuine class axis to plot
          // it against. Still lands in KLAS_MATRIX: one class row (blank
          // Tahun/Nama Kelas) carrying each subject as its own column, the
          // same as a real subject-by-class order would look with only one
          // class in it. Reads the block's own KUANTITI/KEDUDUKAN column
          // when there is one, otherwise the column right after the names.
          const flatRows = readSubjectFlatRows(ws, {
            subjectCol: subjekH.col, qtyCol: qtyH ? qtyH.col : subjekH.col + 1,
            startRow: headerRow + 1, endRow: plakAnchor.row - 1,
          });
          if (flatRows.length > 0) {
            classes = [{ tahunFrom: '', tahunTo: '', namaKelas: '', subjects: flatRows.map((r) => ({ name: r.desc, qty: r.qty })) }];
          }
        }
      } else if (kuantitiH && tahunH && namaKelasH) {
        // TAHUN column + a separate NAMA KELAS list + a per-grade KUANTITI
        // ("35 (SETIAP KELAS 5 PLAK)") — cross the two axes out to one
        // plaque row per (grade, class). See readGradeClassExpansion. Only
        // fires on the explicit "SETIAP KELAS" marker; without it, read the
        // TAHUN column plainly, same as a table with no NAMA KELAS list.
        classes = readGradeClassExpansion(ws, {
          tahunCol: tahunH.col, qtyCol: kuantitiH.col, namaKelasCol: namaKelasH.col,
          startRow: headerRow + 1, endRow: plakAnchor.row - 1,
        });
        if (classes.length === 0) {
          classes = readTahunQtyRows(ws, range, {
            tahunCol: tahunH.col, qtyCol: kuantitiH.col, startRow: headerRow + 1, endRow: plakAnchor.row - 1, subjectLabel: 'KUANTITI',
          });
        }
      } else if (qtyH && namaKelasH && !tahunH) {
        classes = readNamaKelasQtyRows(ws, range, {
          namaKelasCol: namaKelasH.col, qtyCol: qtyH.col, startRow: headerRow + 1, endRow: plakAnchor.row - 1, subjectLabel: qtyLabel,
        });
      } else if (qtyH) {
        classes = readTahunQtyRows(ws, range, {
          tahunCol: (tahunH || qtyH).col, qtyCol: qtyH.col, startRow: headerRow + 1, endRow: plakAnchor.row - 1, subjectLabel: qtyLabel,
        });
      }
    }

    const lines = readRefLinesInBand(ws, range, bandStart, headerRow - 1);
    // A parallel-list section's own sample box has a 4th line ("TAHAP 1")
    // that is event_line_2, not a reference slot — the by-count reader put
    // it in slot '3' and the real class example in '2b'. Swap them back.
    if (parallelEline2 && lines['3'] === parallelEline2) {
      if (lines['2b']) lines['3'] = lines['2b']; else delete lines['3'];
      delete lines['2b'];
    }

    // Jenis Plak + its own QTY (used as a flat fallback quantity when no
    // breakdown table was found above at all) — read from the row(s)
    // directly under the "JENIS PLAK" header, same column.
    let jenisPlak = '';
    let flatQty = 0;
    const qtyLabelCell = findLabelCells(ws, { r1: plakAnchor.row, r2: plakAnchor.row, c1: range.c1, c2: range.c2 }, ['QTY']).find((h) => h.col > plakAnchor.col);
    for (let r = plakAnchor.row + 1; r <= Math.min(plakAnchor.row + 5, range.r2); r++) {
      const val = cellText(ws, r, plakAnchor.col);
      if (val) {
        jenisPlak = val;
        if (qtyLabelCell) flatQty = cellNum(ws, r, qtyLabelCell.col);
        break;
      }
    }
    if (classes.length === 0 && flatQty > 0) {
      classes = [{ tahunFrom: '', tahunTo: '', namaKelas: '', subjects: [{ name: 'KUANTITI', qty: flatQty }] }];
    }

    // Ref-line text alone (no qty/plak data at all) isn't enough to count as
    // a real section — it usually means the band scan swept up some
    // unrelated label text rather than finding a genuinely filled-in award,
    // and creating a section from it would just be empty noise.
    if (classes.length > 0 || jenisPlak) {
      const section = { lines, classes, jenisPlak };
      if (statedTotals) section.statedTotals = statedTotals;
      sections.push(section);
    }
    // Next section's ref-line band starts right after this one's own data —
    // whichever of the footer's data rows or the qty table goes further down.
    bandStart = Math.max(plakAnchor.row + 2, headerRow + 1);
  });

  return sections;
}

// A completely different real-world shape from everything above: a sheet
// listing NAMED RECIPIENTS (students or teachers) rather than subjects or
// classes — one plaque per named person, with a role/class/award-type label
// alongside their name (e.g. "NAMA MURID | JAWATAN", or "NAMA GURU | JENIS
// ANUGERAH"). Quantity is never written anywhere — it's always 1 per person,
// implicitly. Several such rosters, each under its own award sub-title, can
// sit stacked in ONE sheet sharing a single top-of-sheet event title and a
// single "plak rm N" price line — but that price is free text, not a real
// catalog code, so it can't be turned into a Jenis Plak path the way
// matchJenisPlakPath does elsewhere; Jenis Plak is simply left blank for the
// teacher to pick, same as TOKOH's own award types below. Still lands in
// KLAS_MATRIX like every other shape: each named person becomes their own
// class row (Nama Kelas = the name plus whatever role/class columns sit
// beside it in the sheet, in on-sheet column order, so this works whether
// the sheet calls that column JAWATAN, TINGKATAN, KELAS, or JENIS ANUGERAH
// without hardcoding any one of those combinations) with a single
// "KUANTITI" column of 1 — the same trick a plain Nama Kelas list already
// uses (see readNamaKelasQtyRows) for "no real subject breakdown, just a
// name and an implicit quantity of 1".
// Not every roster identifies its own recipients by PERSON — "best class"
// style awards list a class name instead (a real NAMA KELAS column, not
// just a KELAS descriptor tacked onto some other row's own identity — see
// ROSTER_AUX_LABELS' own plain "KELAS" below for that). Person-name
// headers win when a row has BOTH (a genuine recipient identity beats a
// same-row class-name column, which becomes its own extra field instead —
// see scanSheetForRosters' own header grouping) — a "best class" roster
// never has a person-name column at all to compete with in the first
// place, so NAMA KELAS only ever becomes the anchor there.
const PERSON_NAME_LABELS = ['NAMA MURID', 'NAMA PELAJAR', 'NAMA GURU', 'NAMA'];
const CLASS_NAME_LABEL = 'NAMA KELAS';
const ROSTER_NAME_LABELS = [...PERSON_NAME_LABELS, CLASS_NAME_LABEL];
const ROSTER_AUX_LABELS = ['JAWATAN', 'TINGKATAN', 'KELAS', 'JENIS ANUGERAH'];

// Secondary-school class codes ("5K4", "5K1") pack the Tingkatan digit
// directly onto the class code with no separating space — unlike a Nama
// Kelas list's "1 ARIF" (splitGradeFromNamaKelas above), which always has
// one. Only matched when the aux column is explicitly labelled TINGKATAN,
// never guessed from a KELAS column's own values — a "1 ADIL"/"5 STEM 2"
// class name under a plain KELAS header could just as easily be a primary
// school's own Tahun-prefixed name, and there's no reliable way to tell
// which without the school confirming, so it's left as plain text there
// instead of risking a wrong split.
function splitTingkatanCode(text) {
  const m = String(text).trim().match(/^([1-5])([A-Za-z].*)$/);
  if (!m) return null;
  return { tingkatan: `TINGKATAN ${m[1]}`, rest: m[2] };
}

function looksLikePriceLine(text) {
  return /PLAK\s*RM/i.test(text);
}
// The nearest real title text above a roster's own header row — usually
// that roster's own specific award sub-title sitting 1-2 rows above its
// "BIL/NAMA MURID/..." header. Skips the sheet's own price line ("plak rm
// 12.00") if that happens to fall in the same band. Scans every column,
// same reasoning as readRefLinesInBand — the exact column a title sits in
// isn't consistent sheet to sheet.
function readNearestTitleAbove(ws, range, rowStart, rowEnd) {
  for (let r = rowEnd; r >= rowStart; r--) {
    for (let c = range.c1; c <= range.c2; c++) {
      const val = cellText(ws, r, c);
      if (val && !looksLikePriceLine(val)) return val;
    }
  }
  return '';
}
// Same idea, opposite direction — the sheet's own OVERALL title (e.g.
// "ANUGERAH KECEMERLANGAN HAL EHWAL MURID TAHUN 2024" at the very top of
// the sheet) needs the FIRST real text found, not whichever specific
// roster sub-title happens to sit closest to the first header row.
function readTopmostTitle(ws, range, rowStart, rowEnd) {
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const val = cellText(ws, r, c);
      if (val && !looksLikePriceLine(val)) return val;
    }
  }
  return '';
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// School-provided workbooks sometimes embed their OWN "what this plaque
// should actually say" preview somewhere else entirely — commonly right
// alongside an order summary sheet — a compact few-line block, distinct
// from the roster/table data itself, that turns out to be the CORRECT
// Reference Sample content: a roster sheet's own title/subtitle can be
// abbreviated or worded slightly differently from what's actually meant
// to be engraved. Anchored on a year-like line ("SESI 2024/2025", "2024")
// — a genuinely low-false-positive signal, since a real award/roster
// title essentially never IS just a bare year run — the line directly
// above (uninterrupted by a blank row) is the real TAJUK BESAR, and the
// lines directly below are ACARA, then whichever recipient-example
// content follows (name, role, ...). A year embedded WITHIN a longer
// title line ("ANUGERAH KECEMERLANGAN 2024") doesn't count as its own
// anchor — matches the app's own existing "leave YEAR blank if it's
// already included in line 1" convention — so scanSheetForRosters below
// falls back to the roster sheet's own title when no separate year-only
// line exists to anchor a card on.
const YEAR_RUN_RE = /(19|20)\d{2}/g;
function looksLikeYearOnlyLine(text) {
  if (!YEAR_RUN_RE.test(text)) return false;
  YEAR_RUN_RE.lastIndex = 0;
  const stripped = text.replace(YEAR_RUN_RE, '').replace(/[/\-–,.]/g, '').trim();
  return stripped.length <= 12;
}
function findSampleCards(wb) {
  const cards = [];
  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    const range = sheetRange(ws);
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const val = cellText(ws, r, c);
        if (!val || !looksLikeYearOnlyLine(val)) continue;
        const tajukBesar = cellText(ws, r - 1, c);
        if (!tajukBesar) continue;
        const extras = [];
        for (let r2 = r + 1; r2 <= Math.min(r + 6, range.r2); r2++) {
          const v = cellText(ws, r2, c);
          if (!v) break;
          extras.push(v);
        }
        if (extras.length === 0) continue;
        cards.push({ tajukBesar, year: val, acara: extras[0] });
      }
    }
  });
  return cards;
}
// Matched by prefix, not exact equality — a card's own ACARA line and a
// roster's own subtitle commonly differ after the award name itself
// (the roster subtitle tacks on "(TINGKATAN 5) - LEMBAGA PENGAWAS"-style
// qualifiers the card never repeats).
function matchSampleCard(subTitle, cards) {
  const upper = (subTitle || '').toUpperCase();
  return cards.find((c) => upper.startsWith(c.acara.toUpperCase())) || null;
}

// Builds a roster-derived section's full Reference Sample lines in one
// place, for both scanSheetForRosters branches below. TAHUN (slot 3) and
// SUBJEK/POSITION (slot 2b) never apply to a named-recipient roster —
// there's no Tahun axis, and a name/role can't sit in SUBJEK/POSITION's
// own red-font styling — so both are hidden outright rather than left for
// the teacher to notice and delete by hand. What WOULD have gone in
// SUBJEK/POSITION (this section's own first real row, as a live example —
// same idea as AppState.jsx's deriveKlasMatrixSectionLines) becomes extra
// Reference Sample rows instead, since that's the only place left with
// room for un-styled free text: the example name, then its example
// role/Jawatan if this shape has one, then a shared group/committee
// caption if the sheet had an extra unlabeled column for one.
function buildRosterSectionLines(sheetTitle, subTitle, firstClass, groupSample, cards) {
  const card = matchSampleCard(subTitle, cards);
  const lines = {};
  if (card) {
    // YEAR row is retired — fold a card's year onto TAJUK BESAR as its
    // second engraved line (slot 0b), same as readRefLinesInBand.
    lines[0] = [card.tajukBesar, card.year].filter(Boolean).join('\n');
    lines[2] = card.acara;
  } else {
    lines[0] = sheetTitle;
    lines[2] = subTitle;
  }
  const hidden = ['1', '2b', '3'];
  lines.hiddenLines = hidden.join(',');
  const extras = [firstClass?.namaKelas, firstClass?.jawatan, firstClass?.kelasName, groupSample].filter(Boolean);
  if (extras.length > 0) {
    lines.extraRefLines = String(extras.length);
    extras.forEach((val, i) => { lines[4 + i] = val; });
  }
  return splitTwoLineTajuk(lines);
}

// Some rosters have one more column with no header label at all — a
// constant group/committee name repeated on every row (e.g. "LEMBAGA
// PENGAWAS") rather than something that varies per person the way
// JAWATAN does. There's nothing to label it by, so it isn't tracked as
// its own per-row field — instead its own value becomes one of the
// Reference Sample example lines above (see buildRosterSectionLines).
function findUnlabeledGroupValue(ws, headerRow, dataRow, usedCols, range) {
  for (let c = range.c1; c <= range.c2; c++) {
    if (usedCols.has(c) || cellStr(ws, headerRow, c)) continue;
    const val = cellText(ws, dataRow, c);
    if (val) return val;
  }
  return '';
}

// Groups every "NAMA ..."-style header cell by its own row (a table can
// carry BOTH a person-name column AND a class-name column at once, e.g.
// "NAMA MURID | NAMA KELAS | JAWATAN") and picks ONE per row as the
// section's actual recipient identity — a person always wins over a
// same-row class name, which becomes its own extra field instead (see
// scanSheetForRosters below) rather than a second, competing "this row is
// its own roster" anchor. A table with ONLY a NAMA KELAS column (no
// person-name column at all — a "best class" style award) uses that as
// the anchor itself, same as any person-name header would be.
function groupRosterHeaders(ws, range) {
  const byRow = new Map();
  findLabelCells(ws, range, ROSTER_NAME_LABELS).forEach((cell) => {
    if (!byRow.has(cell.row)) byRow.set(cell.row, []);
    byRow.get(cell.row).push(cell);
  });
  return [...byRow.entries()].map(([row, cells]) => {
    const primary = cells.find((c) => PERSON_NAME_LABELS.includes(c.label)) || cells[0];
    const kelasCol = cells.find((c) => c !== primary && c.label === CLASS_NAME_LABEL) || null;
    return { row, col: primary.col, label: primary.label, kelasCol };
  }).sort((a, b) => a.row - b.row);
}

function scanSheetForRosters(ws, sampleCards) {
  const range = sheetRange(ws);
  let nameHeaders = groupRosterHeaders(ws, range);
  if (nameHeaders.length === 0) return [];

  // A NAMA KELAS list sitting on a sheet that ALSO has a "JENIS PLAK"
  // footer belongs to that footer's award section — scanSheetForSections
  // reads it (KOSAS PBD's grade×class list is exactly this) — and must not
  // also be picked up here as a standalone "best class" roster. Person-name
  // rosters (NAMA MURID / NAMA GURU) are the genuine roster shape and are
  // never suppressed this way.
  if (findLabelCells(ws, range, ['JENIS PLAK']).length > 0) {
    nameHeaders = nameHeaders.filter((h) => h.label !== CLASS_NAME_LABEL);
    if (nameHeaders.length === 0) return [];
  }

  const sheetTitle = readTopmostTitle(ws, range, range.r1, nameHeaders[0].row - 1);

  const sections = [];
  let bandStart = range.r1;
  nameHeaders.forEach((nameH) => {
    const headerRow = nameH.row;
    // Every aux column present, keeping its own label alongside its column
    // — JENIS ANUGERAH, TINGKATAN, and JAWATAN all get special handling
    // below; anything else (just KELAS, in practice) stays a plain
    // per-row descriptor joined onto Nama Kelas the way it always has,
    // since it complements the class identity rather than being a
    // separate kind of attribute the way a role/position is.
    const auxCols = [];
    for (let c = range.c1; c <= range.c2; c++) {
      if (c === nameH.col) continue;
      const label = cellStr(ws, headerRow, c).toUpperCase();
      if (ROSTER_AUX_LABELS.includes(label)) auxCols.push({ col: c, label });
    }
    const jenisAnugerahCol = auxCols.find((a) => a.label === 'JENIS ANUGERAH');
    const tingkatanCol = auxCols.find((a) => a.label === 'TINGKATAN');
    const jawatanCol = auxCols.find((a) => a.label === 'JAWATAN');
    const descriptorCols = auxCols.filter((a) => a !== jenisAnugerahCol && a !== tingkatanCol && a !== jawatanCol);
    const subTitle = readNearestTitleAbove(ws, range, bandStart, headerRow - 1);
    const namaKelasLabel = titleCase(nameH.label);

    // JENIS ANUGERAH literally means "type of award" — when it's present,
    // each ROW'S OWN value there (not one subtitle shared by the whole
    // roster block) says which award that row actually belongs to. A
    // teacher name can repeat across several distinct JENIS ANUGERAH
    // values in the very same table (e.g. one teacher managing a class
    // AND coordinating a Tingkatan) — grouping by that value, in the
    // order each is first seen, still produces one section per real award
    // even when every row happens to share the same value (then it's
    // just one group, same result as the plain JAWATAN-style path below).
    if (jenisAnugerahCol) {
      const groupsByTitle = new Map();
      const titleOrder = [];
      let r = headerRow + 1;
      while (r <= range.r2) {
        const name = cellText(ws, r, nameH.col);
        if (!name) break;
        const title = cellText(ws, r, jenisAnugerahCol.col) || subTitle || sheetTitle;
        const descriptorParts = descriptorCols.map((a) => cellText(ws, r, a.col)).filter(Boolean);
        const namaKelas = [name, ...descriptorParts].join(' — ');
        const cls = { tahunFrom: '', tahunTo: '', namaKelas, subjects: [{ name: 'KUANTITI', qty: 1 }] };
        if (nameH.kelasCol) cls.kelasName = cellText(ws, r, nameH.kelasCol.col);
        if (!groupsByTitle.has(title)) { groupsByTitle.set(title, []); titleOrder.push(title); }
        groupsByTitle.get(title).push(cls);
        r += 1;
      }
      titleOrder.forEach((title) => {
        const classes = groupsByTitle.get(title);
        sections.push({
          lines: buildRosterSectionLines(sheetTitle, title, classes[0], '', sampleCards),
          classes, jenisPlak: '', skipLineDerivation: true, namaKelasLabel,
        });
      });
      bandStart = r;
      return;
    }

    const classes = [];
    let groupSample = '';
    let r = headerRow + 1;
    while (r <= range.r2) {
      const name = cellText(ws, r, nameH.col);
      if (!name) break;
      if (!groupSample) {
        const usedCols = new Set([nameH.col, ...auxCols.map((a) => a.col), nameH.kelasCol?.col].filter((c) => c != null));
        groupSample = findUnlabeledGroupValue(ws, headerRow, r, usedCols, range);
      }
      const descriptorParts = descriptorCols.map((a) => cellText(ws, r, a.col)).filter(Boolean);
      let tingkatan = '';
      if (tingkatanCol) {
        const raw = cellText(ws, r, tingkatanCol.col);
        const split = splitTingkatanCode(raw);
        if (split) { tingkatan = split.tingkatan; descriptorParts.unshift(split.rest); }
        else if (raw) descriptorParts.unshift(raw);
      }
      const namaKelas = [name, ...descriptorParts].join(' — ');
      const jawatan = jawatanCol ? cellText(ws, r, jawatanCol.col) : '';
      const cls = { tahunFrom: '', tahunTo: '', namaKelas, jawatan, subjects: [{ name: 'KUANTITI', qty: 1 }] };
      if (tingkatan) { cls.tingkatan = tingkatan; cls.tingkatanMode = true; }
      // A same-row NAMA KELAS column alongside a person-name column (see
      // groupRosterHeaders above) — the recipient's own class, tracked
      // separately from their name rather than merged into it.
      if (nameH.kelasCol) cls.kelasName = cellText(ws, r, nameH.kelasCol.col);
      classes.push(cls);
      r += 1;
    }
    if (classes.length > 0) {
      sections.push({
        lines: buildRosterSectionLines(sheetTitle, subTitle, classes[0], groupSample, sampleCards),
        classes, jenisPlak: '', skipLineDerivation: true, namaKelasLabel,
      });
    }
    bandStart = r;
  });
  return sections;
}

// PPKI's own sheet — and MP THP 1 (Kalau ada kelas)'s, same shape with
// TAHUN 1/2/3 instead of PRA PPKI/PPKI/PRASEKOLAH as the 3 levels — is a
// fixed layout, not a generic shape scanSheetForSections can guess at: a
// real "SUBJEK/KUANTITI" matrix (row of subject names down column A, the
// 3 levels as its sub-header columns — subject rows are NOT a fixed list,
// a teacher can rename one or add extra rows, so this reads whatever text
// actually appears down to the TOTAL row rather than assuming the usual
// 13), PLUS — further down the same sheet — three side-by-side "Nama Kelas
// / QTY / Moral Kelas / QTY" breakdown tables (one per level), which a
// teacher can fill in INSTEAD of typing the matrix totals directly. A
// worked-example "CONTOH" box sits above everything in
// the very same shape (title / one "Nama Kelas/QTY/Moral Kelas/QTY" block)
// — never confused with the real ones since the 3 real headers always land
// on the SAME row, side by side, while the CONTOH box only ever has one.
//
// Filling the breakdown tables means every subject's qty is the SAME
// combined total across all three levels: sum each level's own Nama Kelas
// QTY column for every subject except PENDIDIKAN MORAL, which instead sums
// each level's own separate Moral Kelas QTY column (only some classes take
// Moral, so its plaque count is always smaller and tracked as its own
// mini-list rather than folded into the main one). Verified cell-for-cell
// against a real filled sample: 5 PRA PPKI classes + 5 PPKI + 5 PRASEKOLAH
// summed to 59, matching every non-Moral subject's own typed total; the
// Moral sub-lists (2+5+3 classes) summed to 14, matching PENDIDIKAN
// MORAL's own typed total exactly.
function findPpkiNamaKelasBlocks(ws, range) {
  const nkHeaders = findLabelCells(ws, range, ['NAMA KELAS']);
  const byRow = new Map();
  nkHeaders.forEach((h) => { if (!byRow.has(h.row)) byRow.set(h.row, []); byRow.get(h.row).push(h); });
  const headerRow = [...byRow.entries()].find(([, cells]) => cells.length >= 2)?.[0];
  if (headerRow == null) return null;
  const anchors = byRow.get(headerRow).sort((a, b) => a.col - b.col);
  return anchors.map((nk) => {
    const qtyCol = nk.col + 1;
    const moralCell = findLabelCells(
      ws, { r1: headerRow, r2: headerRow, c1: nk.col + 2, c2: Math.min(nk.col + 3, range.c2) }, ['MORAL KELAS'],
    )[0];
    const label = cellText(ws, headerRow - 1, nk.col) || cellText(ws, headerRow - 1, qtyCol);
    return {
      label, nkCol: nk.col, qtyCol,
      moralCol: moralCell ? moralCell.col : null,
      moralQtyCol: moralCell ? moralCell.col + 1 : null,
      headerRow,
    };
  });
}
// Tolerant of a stray blank row (a class the teacher skipped rather than
// deleted) the same way readTahunQtyRows/readNamaKelasQtyRows are — only a
// real TOTAL label ends the list early, otherwise it just reads to the
// bottom of the sheet. Returns every individual (name, qty) row, not just
// their sum — the website's own PPKI review screen shows this same
// Nama Kelas/Moral Kelas breakdown (catalog.js's hasLevelBreakdown), not
// only the totals it adds up to.
function readPpkiListRows(ws, range, nameCol, qtyCol, startRow) {
  const rows = [];
  for (let r = startRow; r <= range.r2; r++) {
    const name = cellText(ws, r, nameCol);
    if (isTotalLabel(name)) break;
    if (!name) continue;
    rows.push({ name, qty: cellNum(ws, r, qtyCol) });
  }
  return rows;
}
function sumPpkiRows(rows) {
  return rows.reduce((sum, r) => sum + r.qty, 0);
}

function parseSubjectLevelSheet(ws) {
  const range = sheetRange(ws);
  const subjekH = findLabelCells(ws, range, ['SUBJEK'])[0];
  if (!subjekH) return null;
  const classHeaderRow = subjekH.row + 1;
  const classCols = [];
  for (let c = subjekH.col + 1; c <= range.c2; c++) {
    if (cellText(ws, classHeaderRow, c)) classCols.push(c);
  }
  let subjectEndRow = range.r2;
  for (let r = classHeaderRow + 1; r <= range.r2; r++) {
    if (isTotalLabel(cellText(ws, r, subjekH.col))) { subjectEndRow = r - 1; break; }
  }

  const blocks = findPpkiNamaKelasBlocks(ws, range);
  const hasNamaKelasData = blocks && blocks.some((b) => cellText(ws, b.headerRow + 1, b.nkCol));

  let classes;
  let subjectOrder = null; // every subject name in sheet order — see readSubjectMatrix
  // The individual rows behind each level's own total (only set when the
  // file actually had a Nama Kelas breakdown to read — Case 2A's direct
  // fill has no such rows) — read back by AppState.jsx's
  // importFormAnugerahExcel into this block's own rowsByBlock, so the
  // website can show (and let the teacher edit) the exact same Nama
  // Kelas/Moral Kelas breakdown the source file had, with the KUANTITI
  // cells above re-summing live off it — see draftUpdaters.js's
  // onLevelKelasField family.
  let levelBreakdown = null;
  if (hasNamaKelasData) {
    // Each level's own Nama Kelas list only ever feeds THAT level's own
    // subject column — PRA PPKI's classes never add into PPKI's or PRA
    // SEKOLAH's totals. Verified cell-for-cell against a corrected real
    // sample: PRA PPKI's 5 classes (2+3+5+3+4) summed to 17 and only PRA
    // PPKI's own column read 17 for every non-Moral subject; PPKI's 5
    // classes summed to 25 and only PPKI's column read 25; PRA SEKOLAH's
    // summed to 17 and only its own column read 17 — same per-level
    // isolation for the Moral Kelas sub-lists (3/6/5 respectively).
    const subjectRows = [];
    for (let r = classHeaderRow + 1; r <= subjectEndRow; r++) {
      const name = cellText(ws, r, subjekH.col);
      if (name) subjectRows.push({ name, row: r });
    }
    if (subjectRows.length === 0) return null;
    const subjectNames = subjectRows.map((s) => s.name);
    subjectOrder = subjectNames;
    // The level-label columns (TAHUN 1/2/3, or PRA PPKI/PPKI/PRASEKOLAH),
    // keyed by their own header text so a Nama Kelas block ("Tahun 1") can
    // find its matching matrix column ("TAHUN 1").
    const colByLabel = new Map();
    classCols.forEach((c) => {
      const raw = cellText(ws, classHeaderRow, c).trim().toUpperCase();
      if (raw) colByLabel.set(raw, c);
    });
    // Whether the teacher typed (or the template's own SUM formula filled)
    // ANY matrix cell. When some cells have values, a BLANK cell is a
    // deliberate "this school doesn't offer this subject at this level" and
    // must stay 0 — not silently get the level's class total like every
    // other subject. Only a wholly-blank matrix (a formula-less sheet where
    // the teacher filled ONLY the Nama Kelas lists) falls back to giving
    // every subject that level's total.
    const matrixHasAnyValue = subjectRows.some((s) => classCols.some((c) => cellNum(ws, s.row, c) > 0));
    const levelRows = blocks.map((b) => ({
      label: b.label,
      mainRows: readPpkiListRows(ws, range, b.nkCol, b.qtyCol, b.headerRow + 1),
      moralRows: b.moralCol ? readPpkiListRows(ws, range, b.moralCol, b.moralQtyCol, b.headerRow + 1) : [],
    }));
    const levelTotals = levelRows.map((lr) => ({
      mainTotal: sumPpkiRows(lr.mainRows), moralTotal: sumPpkiRows(lr.moralRows),
    }));
    if (levelTotals.every((t) => t.mainTotal === 0 && t.moralTotal === 0)) return null;
    // A level named after a real Tahun (MP THP 1 (Kalau ada kelas)'s
    // "Tahun 1"/"Tahun 2"/"Tahun 3") is canonicalized the same way
    // readSubjectMatrix's Case 2A already does, so this level's own
    // composite rowsByBlock key (AppState.jsx) and its class's own
    // tahunFrom both agree on the exact same text the category's own
    // columnsByLanguage uses (catalog.js) — PPKI's own level names
    // (PRA PPKI/PPKI/PRASEKOLAH) aren't real Tahuns, so normalizeTahun
    // leaves them as plain namaKelas text, unchanged from before.
    classes = blocks.map((b, bi) => {
      const tahun = normalizeTahun(b.label);
      const levelCol = colByLabel.get((b.label || '').trim().toUpperCase());
      return {
        tahunFrom: tahun, tahunTo: tahun, namaKelas: tahun ? '' : b.label,
        subjects: subjectRows.map(({ name, row }) => {
          const levelTotal = /^PENDIDIKAN MORAL$/i.test(name.trim())
            ? levelTotals[bi].moralTotal : levelTotals[bi].mainTotal;
          if (!matrixHasAnyValue) return { name, qty: levelTotal };
          // Matrix has values elsewhere → this subject's own cell is the
          // source of truth (blank cell = subject not offered here).
          return { name, qty: levelCol != null ? cellNum(ws, row, levelCol) : 0 };
        }),
      };
    });
    levelBreakdown = levelRows.map((lr) => ({ ...lr, label: normalizeTahun(lr.label) || lr.label }));
  } else {
    // Case: no Nama Kelas breakdown at all — the teacher typed each
    // subject's total straight into the matrix, same shape MP THP's own
    // sheets already use. readSubjectMatrix reads exactly this.
    if (classCols.length === 0) return null;
    const matrix = readSubjectMatrix(ws, range, {
      subjectCol: subjekH.col, subjectStartRow: classHeaderRow + 1, subjectEndRow, classHeaderRow, classCols,
    });
    if (matrix.classes.length === 0) return null;
    classes = matrix.classes;
    subjectOrder = matrix.subjectNames;
  }

  // Reference Sample: the sheet's own "TOLONG ISI DI SINI" instruction sits
  // directly above the real TAJUK BESAR/ACARA lines and must never be read
  // as content. Both those lines and the instruction live in whichever
  // column sits left of the "CONTOH" example box, so the read is narrowed
  // to that column range — otherwise a plain row-wide scan would run
  // straight into the CONTOH box's own header text sharing the same row.
  const contohH = findLabelCells(ws, range, ['CONTOH'])[0];
  const titleColEnd = contohH ? contohH.col - 1 : range.c2;
  const instructionRow = findLabelCells(
    ws, { r1: range.r1, r2: classHeaderRow, c1: range.c1, c2: titleColEnd }, ['TOLONG ISI DI SINI'],
  )[0];
  const linesStart = instructionRow ? instructionRow.row + 1 : range.r1;
  const lines = readRefLinesInBand(
    ws, { r1: linesStart, r2: subjekH.row - 1, c1: range.c1, c2: titleColEnd }, linesStart, subjekH.row - 1,
  );

  let jenisPlak = '';
  const plakH = findLabelCells(ws, range, ['JENIS PLAK'])[0];
  if (plakH) {
    for (let r = plakH.row + 1; r <= range.r2; r++) {
      const val = cellText(ws, r, plakH.col);
      if (val) { jenisPlak = val; break; }
    }
  }

  return { lines, classes, jenisPlak, levelBreakdown, subjectOrder };
}

// PBD TERBAIK's sheet has NO subject axis — just "TAHUN | KUANTITI" down
// the left (one total per TAHUN 1-6), optionally with a per-Tahun Nama
// Kelas breakdown on the right (NAMA KELAS | QTY only, no Moral Kelas)
// that a filled Tahun's KUANTITI is the sum of. Reuses
// findPpkiNamaKelasBlocks / readPpkiListRows (both already tolerate a
// block with no Moral Kelas column). Lands in the PBD category (catalog.js,
// modelled as a 1-column matrix whose rows are the six Tahuns).
function parsePbdSheet(ws) {
  const range = sheetRange(ws);
  const tahunH = findLabelCells(ws, range, ['TAHUN'])[0];
  if (!tahunH) return null;
  const kuantitiH = findLabelCells(
    ws, { r1: tahunH.row, r2: tahunH.row, c1: tahunH.col + 1, c2: range.c2 }, ['KUANTITI'],
  )[0];
  const qtyCol = kuantitiH ? kuantitiH.col : tahunH.col + 1;

  // Direct per-Tahun KUANTITI (Case 2A) — the rows under the "TAHUN" header.
  // The row label is kept EXACTLY as typed (e.g. "TAHUN 1 PKB", not just
  // "TAHUN 1") so the website's PBD tab shows the school's own list rather
  // than a fixed TAHUN 1-6 — `subjectsFromImport` in catalog.js. `norm` is
  // only used to line a Nama Kelas breakdown block (whose header is usually
  // the bare "TAHUN 1") up with its row.
  const tahunRows = [];
  for (let r = tahunH.row + 1; r <= range.r2; r++) {
    const label = cellText(ws, r, tahunH.col);
    if (isTotalLabel(label)) break;
    if (!label) continue;
    tahunRows.push({ tahun: label, norm: normalizeTahun(label), qty: cellNum(ws, r, qtyCol) });
  }

  const blocks = findPpkiNamaKelasBlocks(ws, range);
  const hasNamaKelasData = blocks && blocks.some((b) => cellText(ws, b.headerRow + 1, b.nkCol));
  let levelBreakdown = null;
  if (hasNamaKelasData) {
    levelBreakdown = blocks
      .map((b) => {
        const blkNorm = normalizeTahun(b.label);
        // Attach the breakdown to the main table's OWN row label (which may
        // carry an extra qualifier like "PKB") — matched via normalizeTahun
        // — so computeBlocks/draftUpdaters key it the same way.
        const rowLabel = tahunRows.find((tr) => tr.norm && tr.norm === blkNorm)?.tahun;
        return {
          label: rowLabel || blkNorm || b.label,
          mainRows: readPpkiListRows(ws, range, b.nkCol, b.qtyCol, b.headerRow + 1),
          moralRows: [],
        };
      })
      .filter((lb) => lb.mainRows.length > 0);
    // A level with a Nama Kelas list — its KUANTITI is that list's sum,
    // overriding whatever was (or wasn't) typed directly in the main table.
    levelBreakdown.forEach((lb) => {
      if (!lb.label) return;
      const total = sumPpkiRows(lb.mainRows);
      const existing = tahunRows.find((tr) => tr.tahun === lb.label);
      if (existing) existing.qty = total;
      else tahunRows.push({ tahun: lb.label, norm: normalizeTahun(lb.label), qty: total });
    });
    levelBreakdown = levelBreakdown.filter((lb) => lb.label);
  }

  if (tahunRows.every((tr) => !tr.qty)) return null;
  const subjectOrder = tahunRows.map((tr) => tr.tahun);

  const linesStart = (findLabelCells(
    ws, { r1: range.r1, r2: tahunH.row, c1: range.c1, c2: range.c2 }, ['TOLONG ISI DI SINI'],
  )[0]?.row || 0) + 1;
  const lines = readRefLinesInBand(
    ws, { r1: linesStart, r2: tahunH.row - 1, c1: range.c1, c2: range.c2 }, linesStart, tahunH.row - 1,
  );

  let jenisPlak = '';
  const plakH = findLabelCells(ws, range, ['JENIS PLAK'])[0];
  if (plakH) {
    for (let r = plakH.row + 1; r <= range.r2; r++) {
      const val = cellText(ws, r, plakH.col);
      if (val) { jenisPlak = val; break; }
    }
  }

  return { lines, jenisPlak, levelBreakdown, tahunRows, subjectOrder, isTahunList: true, classes: [] };
}

// ALIRAN TERBAIK's sheet: "TAHUN | KEDUDUKAN (DARI | HINGGA KE) | TOTAL"
// down the left (one KEDUDUKAN range per TAHUN 1-6), plus a multi-row
// "JENIS PLAK | CATATAN (DARI | HINGGA KE) | QTY" footer that maps
// position sub-ranges to plaque types. Every quantity here is DERIVED
// (a range's own size, ranges crossed with the TAHUNs that ordered them)
// so the sheet's own typed TOTAL/QTY figures are ignored — the website
// recomputes them (catalog.js's ALIRAN entry, computeBlocks.js).
function parseAliranSheet(ws) {
  const range = sheetRange(ws);
  const tahunH = findLabelCells(ws, range, ['TAHUN'])[0];
  const kedudukanH = findLabelCells(ws, range, ['KEDUDUKAN'])[0];
  if (!tahunH || !kedudukanH) return null;
  // "DARI" / "HINGGA KE" sub-headers sit on the row under "KEDUDUKAN".
  const dariH = findLabelCells(ws, { r1: kedudukanH.row, r2: kedudukanH.row + 1, c1: range.c1, c2: range.c2 }, ['DARI'])[0];
  const hinggaH = findLabelCells(ws, { r1: kedudukanH.row, r2: kedudukanH.row + 1, c1: range.c1, c2: range.c2 }, ['HINGGA KE'])[0];
  if (!dariH || !hinggaH) return null;
  const headerRow = dariH.row;

  const tahunRows = [];
  for (let r = headerRow + 1; r <= range.r2; r++) {
    const label = cellText(ws, r, tahunH.col);
    if (isTotalLabel(label)) break;
    const tahun = normalizeTahun(label);
    if (!tahun) continue;
    const dari = ordinalToNum(cellText(ws, r, dariH.col));
    const hingga = ordinalToNum(cellText(ws, r, hinggaH.col));
    if (dari && hingga && hingga >= dari) {
      // KEDUDUKAN range — one plaque per place from `dari` to `hingga`.
      tahunRows.push({ tahun, dari, hingga });
    } else {
      // No KEDUDUKAN range — a flat count (teacher's own TOTAL figure),
      // "ikut sample, tukar TAHUN sahaja". Column right after HINGGA KE is
      // the TOTAL.
      const flatQty = cellNum(ws, r, hinggaH.col + 1);
      if (flatQty > 0) tahunRows.push({ tahun, flatQty });
    }
  }
  if (tahunRows.length === 0) return null;

  // JENIS PLAK footer — each row maps a position sub-range to a plaque.
  // Its own typed QTY IS read now (unlike the TAHUN table's, still derived):
  // a teacher may split plaques in a way the position-range × ranked-TAHUN
  // math can't express (see catalog.js's ALIRAN override), so the sheet's
  // number wins when present and the website shows the derived one only as
  // a hint.
  const plakH = findLabelCells(ws, range, ['JENIS PLAK'])[0];
  const plakRanges = [];
  if (plakH) {
    const catatanH = findLabelCells(ws, range, ['CATATAN'])[0];
    const fDariH = catatanH && findLabelCells(ws, { r1: catatanH.row, r2: catatanH.row + 1, c1: range.c1, c2: range.c2 }, ['DARI'])[0];
    const fHinggaH = catatanH && findLabelCells(ws, { r1: catatanH.row, r2: catatanH.row + 1, c1: range.c1, c2: range.c2 }, ['HINGGA KE'])[0];
    const fQtyH = findLabelCells(ws, { r1: plakH.row, r2: (fHinggaH ? fHinggaH.row : plakH.row) + 1, c1: range.c1, c2: range.c2 }, ['QTY', 'KUANTITI'])[0];
    const plakDataStart = (fDariH ? fDariH.row : plakH.row) + 1;
    for (let r = plakDataStart; r <= range.r2; r++) {
      const jp = cellText(ws, r, plakH.col);
      if (isTotalLabel(jp)) break;
      if (!jp) continue;
      const dari = fDariH ? ordinalToNum(cellText(ws, r, fDariH.col)) : null;
      const hingga = fHinggaH ? ordinalToNum(cellText(ws, r, fHinggaH.col)) : null;
      const qty = fQtyH ? cellNum(ws, r, fQtyH.col) : 0;
      plakRanges.push({ jenisPlak: jp, dari, hingga, qty: qty > 0 ? qty : null });
    }
  }

  // Title lines sit in the same column as the "TOLONG ISI DI SINI"
  // instruction — read only that column, not the whole width, or the
  // MALAY_ORDINALS helper list a teacher pasted into some far column
  // (seen in real files) gets swept in as reference text.
  const instructionCell = findLabelCells(
    ws, { r1: range.r1, r2: tahunH.row, c1: range.c1, c2: range.c2 }, ['TOLONG ISI DI SINI'],
  )[0];
  const titleCol = instructionCell ? instructionCell.col : range.c1;
  const linesStart = (instructionCell?.row || 0) + 1;
  const lines = readRefLinesInBand(
    ws, { r1: linesStart, r2: tahunH.row - 1, c1: titleCol, c2: titleCol }, linesStart, tahunH.row - 1,
  );

  return { lines, tahunRows, plakRanges, isAliran: true, classes: [], jenisPlak: '' };
}

// LONJAKAN SAUJANA / KEHADIRAN PENUH — identical shape: "TAHUN | KUANTITI |
// JENIS PLAK | HARGA" down the left, one KUANTITI (and its OWN Jenis Plak)
// per TAHUN 1-6. Lands in the matching plakPerRow list category (catalog.js).
function parseTahunPlakRowSheet(ws) {
  const range = sheetRange(ws);
  const tahunH = findLabelCells(ws, range, ['TAHUN'])[0];
  if (!tahunH) return null;
  const kuantitiH = findLabelCells(
    ws, { r1: tahunH.row, r2: tahunH.row, c1: tahunH.col + 1, c2: range.c2 }, ['KUANTITI'],
  )[0];
  if (!kuantitiH) return null;
  const jpH = findLabelCells(
    ws, { r1: tahunH.row, r2: tahunH.row, c1: kuantitiH.col + 1, c2: range.c2 }, ['JENIS PLAK'],
  )[0];

  const tahunRows = [];
  for (let r = tahunH.row + 1; r <= range.r2; r++) {
    const label = cellText(ws, r, tahunH.col);
    if (isTotalLabel(label)) break;
    const tahun = normalizeTahun(label);
    if (!tahun) continue;
    const qty = cellNum(ws, r, kuantitiH.col);
    const jenisPlak = jpH ? cellText(ws, r, jpH.col) : '';
    if (qty > 0 || jenisPlak) tahunRows.push({ tahun, qty, jenisPlak });
  }
  if (tahunRows.length === 0) return null;

  const instructionCell = findLabelCells(
    ws, { r1: range.r1, r2: tahunH.row, c1: range.c1, c2: range.c2 }, ['TOLONG ISI DI SINI'],
  )[0];
  const titleCol = instructionCell ? instructionCell.col : range.c1;
  const linesStart = (instructionCell?.row || 0) + 1;
  const lines = readRefLinesInBand(
    ws, { r1: linesStart, r2: tahunH.row - 1, c1: titleCol, c2: titleCol }, linesStart, tahunH.row - 1,
  );

  return { lines, tahunRows, isSimpleTahunList: true, classes: [] };
}

// TOKOH's own FORM ANUGERAH sheet — a flat per-honour list:
//   TOKOH (award name) | NAMA MURID | GAMBAR (YES/NO) | KUANTITI |
//   JENIS PLAK | **DESIGN | HARGA
// One honour per row; the award name in the TOKOH column is the engraved
// position (no per-plaque class/year line). Lands in its own TOKOH_SHEET
// list category (catalog.js) — `isTokohList`. GAMBAR / DESIGN are per-row
// metadata for the review table. NAMA MURID (exportCsv.js):
//   * blank  — the row's KUANTITI plaques all engrave the one TOKOH name
//     (same as LONJAKAN/KEHADIRAN).
//   * a name — engraves as the reference sample's line ③ (event_line_1).
//   * "Reserved" (any case) — the teacher pre-books the Jenis Plak before
//     the student's name is known: stock is deducted at submit like any
//     other row, but the row is kept OUT of the production CSV until a real
//     name replaces "Reserved".
function parseTokohAnugerahSheet(ws) {
  const range = sheetRange(ws);
  const tokohH = findLabelCells(ws, range, ['TOKOH'])[0];
  if (!tokohH) return null;
  // Header labels carry extra text ("GAMBAR (YES/NO)", "**DESIGN") so they
  // need a substring scan, not findLabelCells' exact match.
  const headerCol = (re) => {
    for (let c = range.c1; c <= range.c2; c++) {
      if (re.test(cellStr(ws, tokohH.row, c))) return c;
    }
    return null;
  };
  const qtyCol = headerCol(/KUANTITI|KUANTITY|QTY/i);
  if (qtyCol == null) return null;
  const namaCol = headerCol(/NAMA\s*MURID/i);
  const gambarCol = headerCol(/GAMBAR/i);
  const jpCol = headerCol(/JENIS\s*PLAK/i);
  const designCol = headerCol(/DESIGN/i);

  const tokohRows = [];
  for (let r = tokohH.row + 1; r <= range.r2; r++) {
    const name = cellText(ws, r, tokohH.col);
    if (isTotalLabel(name)) break;
    if (!name) continue;
    tokohRows.push({
      desc: name,
      namaMurid: namaCol != null ? cellText(ws, r, namaCol) : '',
      gambar: gambarCol != null ? cellText(ws, r, gambarCol) : '',
      qty: cellNum(ws, r, qtyCol),
      jenisPlak: jpCol != null ? cellText(ws, r, jpCol) : '',
      design: designCol != null ? cellText(ws, r, designCol) : '',
    });
  }
  if (tokohRows.length === 0) return null;

  // The reference box (① majlis title, ② one example TOKOH name) sits to
  // the RIGHT of the honour table, under its own "TOLONG ISI DI SINI".
  const instr = findLabelCells(
    ws, { r1: range.r1, r2: tokohH.row, c1: range.c1, c2: range.c2 }, ['TOLONG ISI DI SINI'],
  )[0];
  const titleCol = instr ? instr.col : range.c1;
  const linesStart = instr ? instr.row + 1 : range.r1;
  const lines = readRefLinesInBand(
    ws, { r1: linesStart, r2: tokohH.row - 1, c1: titleCol, c2: range.c2 }, linesStart, tokohH.row - 1,
  );

  return { lines, tokohRows, isTokohList: true, classes: [] };
}

// SELEMPANG sheet — a plain ACARA / WARNA / KUANTITI table (the CONTOH
// WARNA legend off to the right is just a colour key, never read). Each
// filled row becomes one selempang line; the colour text is normalised the
// same way the website does (resolveSelempangWarna) but an unrecognised one
// is still kept as raw text so the teacher can fix it on Step 2 rather than
// have the row silently vanish.
function parseSelempangSheet(ws) {
  const range = sheetRange(ws);
  const acaraH = findLabelCells(ws, range, ['ACARA'])[0];
  if (!acaraH) return null;
  const onRow = findLabelCells(ws, { r1: acaraH.row, r2: acaraH.row, c1: range.c1, c2: range.c2 }, ['WARNA', 'KUANTITI']);
  const warnaH = onRow.find((h) => h.label === 'WARNA');
  const kuantitiH = onRow.find((h) => h.label === 'KUANTITI');
  if (!warnaH) return null;
  const rows = [];
  for (let r = acaraH.row + 1; r <= range.r2; r++) {
    const acara = cellText(ws, r, acaraH.col);
    const warnaRaw = cellText(ws, r, warnaH.col);
    const qty = kuantitiH ? cellNum(ws, r, kuantitiH.col) : 0;
    if (isTotalLabel(acara)) break;
    if (!acara && !warnaRaw && qty <= 0) continue;
    const resolved = resolveSelempangWarna(warnaRaw);
    rows.push({ acara, warna: resolved ? resolved.warna : warnaRaw, warnaCode: resolved ? resolved.code : '', qty });
  }
  if (rows.length === 0) return null;
  return { lines: {}, selempangRows: rows, isSelempangList: true, skipLineDerivation: true, classes: [] };
}

// A pending/placeholder line item — the school already knows they need it
// (a rough description, a count) but doesn't have real recipient data yet
// (a name, a class) to build an actual KLAS_MATRIX section from, so
// there's nothing here for the teacher to review or edit. It still needs
// to reach Sales/Invoicing/Production some other way, or the order this
// file becomes would silently be missing however many plaques nobody
// remembered to follow up on — surfaced as an order-level Remark instead
// (see AppState.jsx's importFormAnugerahExcel), never as a section.
// Detected purely by the literal marker text a school already writes for
// exactly this ("KIV" — "kept in view", i.e. still pending) landing
// anywhere in a row, rather than assuming any one sheet name/layout — an
// order-summary table's own shape varies file to file just as much as
// everything else here does.
function findKivNotes(wb) {
  const notes = [];
  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    const range = sheetRange(ws);
    for (let r = range.r1; r <= range.r2; r++) {
      const rowTexts = [];
      let hasKiv = false;
      for (let c = range.c1; c <= range.c2; c++) {
        const val = cellText(ws, r, c);
        if (!val) continue;
        if (val.trim().toUpperCase() === 'KIV') hasKiv = true;
        else rowTexts.push(val);
      }
      if (!hasKiv) continue;
      // The row's own description is whichever cell holds the most text —
      // a bare BIL number ("5") or a short "N ORANG" count never outruns
      // an actual award name in length. QTY is read from that same "N
      // ORANG" text specifically (Malay for "N person(s)") rather than
      // just grabbing any bare number, which BIL's own row index also is.
      const desc = rowTexts.filter((t) => !/^\d+$/.test(t.trim())).sort((a, b) => b.length - a.length)[0];
      if (!desc) continue;
      const qtyMatch = rowTexts.map((t) => t.match(/(\d+)\s*ORANG/i)).find(Boolean);
      notes.push({ desc, qty: qtyMatch ? qtyMatch[1] : '' });
    }
  });
  return notes;
}

// A different rare shape again: a single "sekalung penghargaan" (token of
// appreciation) plaque for a named guest of honor, sitting as a short,
// self-contained block of free text — no repeating class/subject list at
// all — often inside the SAME sheet as the order summary rather than its
// own. Anchored on its own distinctive opening line ("PERASMI :"),
// reading whatever non-blank lines follow directly below it in the same
// column. Unlike every other synthetic section above, this one's own
// lines ARE the real Reference Sample content already, in the right
// order — there's no class/subject data to derive TAHUN/SUBJEK-POSITION
// or a display order from, so `skipLineDerivation` tells AppState.jsx's
// importFormAnugerahExcel to use them exactly as read instead of running
// deriveKlasMatrixSectionLines over them. Lines beyond the first 4 spill
// into KLAS_MATRIX's own "+ Add Reference Row" extra-line slots (up to
// its 6-line cap) the same way a teacher manually adding one would.
function findPerasmiSections(wb) {
  const sections = [];
  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    const range = sheetRange(ws);
    // The colon is load-bearing — "PERASMI" bare (no colon) also turns up
    // as an incidental, unrelated line inside some schools' own separate
    // artwork-wording sheets (a different, longer draft of the same
    // plaque, not the one to actually read from), and matching it there
    // too would produce a second, bogus, truncated section.
    const anchor = findLabelCells(ws, range, ['PERASMI :', 'PERASMI:']).sort((a, b) => a.row - b.row)[0];
    if (!anchor) return;
    const lines = [];
    for (let r = anchor.row; r <= range.r2 && lines.length < 6; r++) {
      const val = cellText(ws, r, anchor.col);
      if (val) lines.push(val);
      else if (lines.length > 0) break; // first blank line after content started ends the block
    }
    if (lines.length < 2) return;
    const sectionLines = {};
    lines.slice(0, 4).forEach((val, i) => { sectionLines[i] = val; });
    if (lines.length > 4) {
      sectionLines.extraRefLines = String(lines.length - 4);
      lines.slice(4).forEach((val, i) => { sectionLines[4 + i] = val; });
    }
    sections.push({
      lines: sectionLines,
      classes: [{ tahunFrom: '', tahunTo: '', namaKelas: '', subjects: [{ name: 'KUANTITI', qty: 1 }] }],
      jenisPlak: '',
      skipLineDerivation: true,
      remarkNote: lines.join(' / '),
      sourceSheet: name,
    });
  });
  return sections;
}

function findSheet(wb, name) {
  const found = wb.SheetNames.find((n) => n.trim().toUpperCase() === name.toUpperCase());
  return found ? wb.Sheets[found] : null;
}

// The FRONT PG cover sheet's own JENIS PLAK / QTY table — the school's
// hand-totalled grand total per plaque code, used purely as a cross-check
// oracle against what each imported section actually adds up to (see
// importChecks.js checkExpansionTotals). NOT a data source for the order
// itself — its rows carry no wording or class breakdown. Returns a Map of
// aggressively-normalised code (all spaces/parens stripped, dashes
// collapsed — enough to line "M 1902 A" up with a section's "M1902A", or
// "ACC- 635 (GOLD)" with "ACC-635 (GOLD)") → summed qty, or null when the
// sheet or its table isn't there.
export function frontPgMatchKey(text) {
  return String(text || '').toUpperCase().replace(/[()]/g, '').replace(/\s+/g, '').replace(/-+/g, '-');
}
function readFrontPgTotals(wb) {
  const ws = findSheet(wb, 'FRONT PG');
  if (!ws) return null;
  const range = sheetRange(ws);
  const plakH = findLabelCells(ws, range, ['JENIS PLAK'])[0];
  if (!plakH) return null;
  const qtyH = findLabelCells(ws, { r1: plakH.row, r2: plakH.row, c1: range.c1, c2: range.c2 }, ['QTY'])
    .find((h) => h.col > plakH.col);
  if (!qtyH) return null;
  const totals = new Map();
  for (let r = plakH.row + 1; r <= range.r2; r++) {
    const code = cellText(ws, r, plakH.col);
    if (!code) continue; // TAMBAHAN blocks leave gaps — keep scanning
    if (/^(TAMBAHAN|REMARK|JUMLAH|TOTAL|CATATAN|NOTA)/i.test(code)) break;
    const qty = cellNum(ws, r, qtyH.col);
    if (qty <= 0) continue;
    const key = frontPgMatchKey(code);
    totals.set(key, (totals.get(key) || 0) + qty);
  }
  return totals.size > 0 ? totals : null;
}

// Loosens up a code/text for substring comparison: uppercase, parentheses
// treated as plain separators, and — critically — any spaced-out hyphen
// ("SM - 13187") collapsed to the bare one the catalog actually stores
// ("SM-13187"), since PlakPicker/getStockStatus/standardUnitPrice all match
// a Jenis Plak's full path by exact string equality against a catalog code
// joined with ' / ' (see catalog.js's flattenPlakCatalog) — a code that's
// off by a stray space around its own dash would never match anything.
function normalizeForPlakMatch(s) {
  return String(s || '').toUpperCase().replace(/[()]/g, ' ').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}

// Turns raw Jenis Plak text like "SM - 13187 (GOLD)" or "SM - 13230 (GOLD)
// BASE A" into the exact ' / '-joined path the live catalog tree actually
// uses (e.g. "SM-13187 / GOLD / NORMAL"), by walking the tree level by
// level and matching whichever child's own code text is mentioned anywhere
// in the raw text. A level with no match at all (the teacher wrote a
// finish but no base, say) doesn't stop the walk — every finish's own
// catalog entry always has a "NORMAL" child precisely for "no special base
// requested", so that's the default; failing that, just the first child, so
// the walk always reaches a genuine leaf instead of stopping short on a
// non-orderable middle node. Returns '' if even the top-level code (e.g.
// "SM-13187") can't be found anywhere in the live catalog at all — the
// teacher then sees the raw text as-typed and can pick correctly by hand.
export function matchJenisPlakPath(rawText, plakTree) {
  if (!rawText || !Array.isArray(plakTree) || plakTree.length === 0) return '';
  const normalized = normalizeForPlakMatch(rawText);

  let root = null;
  let rootLen = -1;
  plakTree.forEach((node) => {
    const codeNorm = normalizeForPlakMatch(node.code);
    if (codeNorm && normalized.includes(codeNorm) && codeNorm.length > rootLen) {
      root = node;
      rootLen = codeNorm.length;
    }
  });
  if (!root) return '';

  const pathParts = [root.code];
  let current = root;
  while (current.children && current.children.length > 0) {
    const mentioned = current.children.find((child) => normalized.includes(normalizeForPlakMatch(child.code)));
    const next = mentioned || current.children.find((child) => normalizeForPlakMatch(child.code) === 'NORMAL') || current.children[0];
    pathParts.push(next.code);
    current = next;
  }
  return pathParts.join(' / ');
}

// Top-level entry point. `klasMatrix.sections` is an ARRAY — one entry per
// independent award found anywhere in the workbook (across every sheet
// except "KLAS MATRIX" and "FRONT PG"), whatever shape its own data
// actually was, each with its own Reference Sample lines, class rows, and
// Jenis Plak text (see the header comment above for why every shape folds
// into this one destination). AppState.jsx's importFormAnugerahExcel turns
// each into its own Duplicate-able KLAS_MATRIX section (catalog.js's
// `multiBlock`) instead of merging them into one. Never throws; a missing/
// corrupt file or nothing recognized comes back with an `error` for the
// caller to show.
export function parseFormAnugerahExcel(arrayBuffer) {
  let wb;
  try {
    wb = XLSX.read(arrayBuffer, { type: 'array' });
  } catch {
    return { klasMatrix: null, error: 'Could not read this file — please make sure it is a valid .xlsx file.' };
  }

  const sampleCards = findSampleCards(wb);
  const allSections = [];
  wb.SheetNames.forEach((name) => {
    const upper = name.trim().toUpperCase();
    if (upper === 'KLAS MATRIX' || upper === 'FRONT PG' || upper === 'TOKOH' || upper === 'PPKI' || upper === 'PBD'
      || upper === 'ALIRAN TERBAIK' || upper === 'LONJAKAN SAUJANA' || upper === 'KEHADIRAN PENUH'
      || upper === 'MP THP 1' || upper === 'MP THP 2' || upper === 'SELEMPANG'
      || upper === 'MP THP 1 (KALAU ADA KELAS)' || upper === 'MP THP 2 (KALAU ADA KELAS)') return;
    const ws = wb.Sheets[name];
    // Mutually exclusive in practice — a "JENIS PLAK" footer sheet never
    // also carries a "NAMA MURID"/"NAMA GURU" roster header, so running
    // both scans on every sheet is safe and needs no shape pre-detection.
    // Tagged with the sheet it came from — see `sourceSheet` below —
    // purely so the review screen can label each imported section by its
    // actual origin ("PPKI", "MP THP 1", ...) instead of a bare ordinal
    // when a file lands more than one.
    const sheetSections = [...scanSheetForSections(ws), ...scanSheetForRosters(ws, sampleCards)];
    sheetSections.forEach((s) => { s.sourceSheet = name; });
    allSections.push(...sheetSections);
  });
  const ppkiSheet = findSheet(wb, 'PPKI');
  if (ppkiSheet) {
    const ppkiSection = parseSubjectLevelSheet(ppkiSheet);
    if (ppkiSection) { ppkiSection.sourceSheet = 'PPKI'; allSections.push(ppkiSection); }
  }
  // Plain "MP THP 1" / "MP THP 2" are the same fixed SUBJEK x level matrix,
  // just without the optional Nama Kelas breakdown — parseSubjectLevelSheet's
  // Case 2A reads exactly that, and (unlike the generic scanSheetForSections)
  // reliably skips the "TOLONG ISI DI SINI" instruction row above the
  // reference-sample lines.
  [['MP THP 1', 'MP1'], ['MP THP 2', 'MP2']].forEach(([name]) => {
    const sheet = findSheet(wb, name);
    if (!sheet) return;
    const section = parseSubjectLevelSheet(sheet);
    if (section) { section.sourceSheet = name; allSections.push(section); }
  });
  const mpThp1KelasSheet = findSheet(wb, 'MP THP 1 (Kalau ada kelas)');
  if (mpThp1KelasSheet) {
    const mpThp1KelasSection = parseSubjectLevelSheet(mpThp1KelasSheet);
    if (mpThp1KelasSection) { mpThp1KelasSection.sourceSheet = 'MP THP 1 (Kalau ada kelas)'; allSections.push(mpThp1KelasSection); }
  }
  const mpThp2KelasSheet = findSheet(wb, 'MP THP 2 (Kalau ada kelas)');
  if (mpThp2KelasSheet) {
    const mpThp2KelasSection = parseSubjectLevelSheet(mpThp2KelasSheet);
    if (mpThp2KelasSection) { mpThp2KelasSection.sourceSheet = 'MP THP 2 (Kalau ada kelas)'; allSections.push(mpThp2KelasSection); }
  }
  const pbdSheet = findSheet(wb, 'PBD');
  if (pbdSheet) {
    const pbdSection = parsePbdSheet(pbdSheet);
    if (pbdSection) { pbdSection.sourceSheet = 'PBD'; allSections.push(pbdSection); }
  }
  const aliranSheet = findSheet(wb, 'ALIRAN TERBAIK');
  if (aliranSheet) {
    const aliranSection = parseAliranSheet(aliranSheet);
    if (aliranSection) { aliranSection.sourceSheet = 'ALIRAN TERBAIK'; allSections.push(aliranSection); }
  }
  [['LONJAKAN SAUJANA'], ['KEHADIRAN PENUH']].forEach(([name]) => {
    const sheet = findSheet(wb, name);
    if (!sheet) return;
    const parsed2 = parseTahunPlakRowSheet(sheet);
    if (parsed2) { parsed2.sourceSheet = name; allSections.push(parsed2); }
  });

  const klasSheet = findSheet(wb, 'KLAS MATRIX');
  if (klasSheet) {
    const nativeClasses = [];
    for (let row = 8; row <= 17; row++) {
      const tahunFrom = normalizeTahun(cellText(klasSheet, row, 1));
      const tahunTo = normalizeTahun(cellText(klasSheet, row, 2));
      const namaKelas = cellText(klasSheet, row, 3);
      const subjects = [];
      for (let i = 0; i < 13; i++) {
        const subjName = cellText(klasSheet, 7, 4 + i);
        const qty = cellNum(klasSheet, row, 4 + i);
        if (qty > 0) subjects.push({ name: subjName, qty });
      }
      if (!tahunFrom && !tahunTo && !namaKelas && subjects.length === 0) continue;
      nativeClasses.push({ tahunFrom, tahunTo, namaKelas, subjects });
    }
    if (nativeClasses.length > 0) {
      // Fixed layout we control (see the "KLAS MATRIX" sheet writer) — a
      // direct 5-line read, not the count-collapsing heuristic every other
      // sheet needs, since this one was never hand-filled around a skipped
      // optional line the way real reused orders are.
      const lines = {};
      ['0', '1', '2', '2b', '3'].forEach((slot, i) => {
        const val = cellText(klasSheet, i + 1, 4);
        if (val) lines[slot] = val;
      });
      // Fixed layout we control — the sheet's own JENIS PLAK footer always
      // sits at B20 (header) / B21 (value), see the sheet writer.
      const jenisPlak = cellText(klasSheet, 21, 2);
      allSections.push({ lines, classes: nativeClasses, jenisPlak, sourceSheet: 'KLAS MATRIX' });
    }
  }

  const tokohSheet = findSheet(wb, 'TOKOH');
  if (tokohSheet) {
    const tokohSection = parseTokohAnugerahSheet(tokohSheet);
    if (tokohSection) { tokohSection.sourceSheet = 'TOKOH'; allSections.push(tokohSection); }
  }

  const selempangSheet = findSheet(wb, 'SELEMPANG');
  if (selempangSheet) {
    const selempangSection = parseSelempangSheet(selempangSheet);
    if (selempangSection) { selempangSection.sourceSheet = 'SELEMPANG'; allSections.push(selempangSection); }
  }

  allSections.push(...findPerasmiSections(wb));
  const kivNotes = findKivNotes(wb);

  // Tag each section with the school's own FRONT PG grand total for its
  // plaque code, when one lines up — a section whose imported classes don't
  // add up to it becomes a question on Step 2 (importChecks.js
  // checkExpansionTotals). Left off when nothing matches, so it's never a
  // false alarm from a code the cover sheet just doesn't list.
  const frontPgTotals = readFrontPgTotals(wb);
  if (frontPgTotals) {
    allSections.forEach((s) => {
      if (!s.jenisPlak) return;
      const qty = frontPgTotals.get(frontPgMatchKey(s.jenisPlak));
      if (qty != null) s.frontPgQty = qty;
    });
  }

  if (allSections.length === 0 && kivNotes.length === 0) {
    return { klasMatrix: null, error: 'No filled-in data found in any recognized sheet of this file.' };
  }

  // Sections from a sheet with its own dedicated real category (PPKI, MP
  // THP 1, ...) land there instead of the generic KLAS_MATRIX catch-all —
  // see catalog.js's PPKI/MP1 entries and the header comment at the top of
  // this file for why every OTHER shape still funnels into one place.
  // AppState.jsx's importFormAnugerahExcel reads `categorized` first, then
  // whatever's left over in `klasMatrix.sections`.
  const categorized = {};
  const klasMatrixSections = [];
  allSections.forEach((s) => {
    const catKey = SOURCE_SHEET_TO_CATEGORY[s.sourceSheet];
    if (catKey) (categorized[catKey] = categorized[catKey] || []).push(s);
    else klasMatrixSections.push(s);
  });

  return {
    categorized,
    klasMatrix: klasMatrixSections.length > 0 ? { sections: klasMatrixSections } : null,
    kivNotes,
  };
}
