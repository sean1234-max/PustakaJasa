import * as XLSX from 'xlsx';

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
// "_ _ _ _ ..." placeholder string (the printed underline a teacher would
// otherwise write on top of) — a real, non-blank cell VALUE, not visual
// formatting, so a naive read treats an entirely-untouched sheet as if it
// were filled in.
function isPlaceholderDash(str) {
  return /^[_\s]+$/.test(str);
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
const KLAS_MATRIX_SLOTS_BY_COUNT = { 0: [], 1: [], 2: ['0', '2'], 3: ['0', '2', '3'], 4: ['0', '1', '2', '3'] };
const TOKOH_SLOTS_BY_COUNT = { 0: [], 1: [], 2: ['0', '1'], 3: ['0', '1', '2'] };

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
    if (values.length >= maxSlots) break;
  }
  const slots = slotsByCount[Math.min(values.length, maxSlots)] || slotsByCount[maxSlots];
  const lines = {};
  values.slice(0, slots.length).forEach((val, i) => { lines[slots[i]] = val; });
  return lines;
}

function hasAnyValue(obj) {
  return Object.keys(obj).length > 0;
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
    if (label && label.toUpperCase().startsWith('TOTAL')) break;
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
    if (raw && raw.toUpperCase().startsWith('TOTAL')) break;
    const qty = cellNum(ws, r, qtyCol);
    if (!raw || qty <= 0) continue;
    const { tahun, namaKelas } = splitGradeFromNamaKelas(raw);
    classes.push({ tahunFrom: tahun, tahunTo: tahun, namaKelas, subjects: [{ name: subjectLabel, qty }] });
  }
  return classes;
}
// MP THP-style subject-by-class matrix: SUBJECT names run down a column,
// class-level labels (PPKI/PRASEKOLAH/TAHUN N) run across a row — each
// class-level COLUMN becomes one KLAS_MATRIX class row (transposed),
// carrying every subject's own qty from that column.
function readSubjectMatrix(ws, range, { subjectCol, subjectStartRow, subjectEndRow, classHeaderRow, classCols }) {
  const subjectNames = [];
  for (let r = subjectStartRow; r <= subjectEndRow; r++) {
    const name = cellText(ws, r, subjectCol);
    if (name && name.toUpperCase().startsWith('TOTAL')) break;
    if (name) subjectNames.push({ row: r, name });
  }
  const classes = [];
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
  });
  return classes;
}
// A subject list with no class axis at all — each row is just its own
// Description (subject name) and QTY, the same flat shape Mata Pelajaran/
// Klas (OTHERS) already uses for a teacher-typed row.
function readSubjectFlatRows(ws, { subjectCol, qtyCol, startRow, endRow }) {
  const rows = [];
  for (let r = startRow; r <= endRow; r++) {
    const desc = cellText(ws, r, subjectCol);
    if (desc && desc.toUpperCase().startsWith('TOTAL')) break;
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

      if (subjekH) {
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
          classes = readSubjectMatrix(ws, range, {
            subjectCol: subjekH.col, subjectStartRow: headerRow + (classHeaderRow > headerRow ? 2 : 1),
            subjectEndRow: plakAnchor.row - 1, classHeaderRow, classCols,
          });
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
      sections.push({ lines, classes, jenisPlak });
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
const ROSTER_NAME_LABELS = ['NAMA MURID', 'NAMA PELAJAR', 'NAMA GURU', 'NAMA'];
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
    lines[0] = card.tajukBesar;
    lines[1] = card.year;
    lines[2] = card.acara;
  } else {
    lines[0] = sheetTitle;
    lines[2] = subTitle;
  }
  const hidden = ['2b', '3'];
  if (!lines[1]) hidden.push('1');
  lines.hiddenLines = hidden.join(',');
  const extras = [firstClass?.namaKelas, firstClass?.jawatan, groupSample].filter(Boolean);
  if (extras.length > 0) {
    lines.extraRefLines = String(extras.length);
    extras.forEach((val, i) => { lines[4 + i] = val; });
  }
  return lines;
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

function scanSheetForRosters(ws, sampleCards) {
  const range = sheetRange(ws);
  const nameHeaders = findLabelCells(ws, range, ROSTER_NAME_LABELS).sort((a, b) => a.row - b.row);
  if (nameHeaders.length === 0) return [];

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
        if (!groupsByTitle.has(title)) { groupsByTitle.set(title, []); titleOrder.push(title); }
        groupsByTitle.get(title).push({ tahunFrom: '', tahunTo: '', namaKelas, subjects: [{ name: 'KUANTITI', qty: 1 }] });
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
        const usedCols = new Set([nameH.col, ...auxCols.map((a) => a.col)]);
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

// TOKOH's own sheet still gets read (it's still an active category on its
// own, with its own evolved data model for a manually-started order) but an
// IMPORTED TOKOH sheet folds into KLAS_MATRIX like everything else, for the
// one-place-to-review reason described up top. Its Section A (5 fixed award
// types) is what a real past order actually used (a picked-per-award Jenis
// Plak, no explicit quantity — one plaque per award type ordered) — each
// ordered award type becomes its own class row (Nama Kelas = the award's
// name) with a single "KUANTITI" column of 1, same trick as a roster's named
// row. Found by NAME, not row position, same reasoning as everything else
// here. Jenis Plak itself is NOT imported — Section A can name a different
// Jenis Plak per award, which one shared Jenis Plak per KLAS_MATRIX section
// can't represent, so it's left for the teacher to pick fresh on Step 2,
// same as any manually-started order.
const TOKOH_AWARD_NAMES = ['TOKOH MURID', 'TOKOH NILAM', 'TOKOH KURIKULUM', 'TOKOH KOKURIKULUM', 'TOKOH AKADEMIK'];

function parseTokohSheet(ws) {
  const range = sheetRange(ws);
  const anchors = findLabelCells(ws, range, TOKOH_AWARD_NAMES).sort((a, b) => a.row - b.row);
  if (anchors.length === 0) return null;
  const classes = [];
  anchors.forEach(({ row, col, label }) => {
    let hasData = false;
    for (let c = col + 1; c <= Math.min(col + 4, range.c2); c++) {
      if (cellText(ws, row, c)) { hasData = true; break; }
    }
    if (hasData) classes.push({ tahunFrom: '', tahunTo: '', namaKelas: label, subjects: [{ name: 'KUANTITI', qty: 1 }] });
  });
  // The award table's own column headers ("TOKOH"/"JENIS PLAK"/"**DESIGN"/
  // "HARGA") sit on one row just above the first award name — without
  // excluding it, that whole header row reads as one more "reference
  // line" of garbage text. Whichever "JENIS PLAK" label appears closest
  // above the first award marks that header row.
  const headerAbove = findLabelCells(ws, { r1: range.r1, r2: anchors[0].row - 1, c1: range.c1, c2: range.c2 }, ['JENIS PLAK']);
  const bandEnd = headerAbove.length > 0 ? Math.min(...headerAbove.map((h) => h.row)) - 1 : anchors[0].row - 1;
  const lines = readRefLinesInBand(ws, range, range.r1, bandEnd, TOKOH_SLOTS_BY_COUNT);
  if (!hasAnyValue(lines) && classes.length === 0) return null;
  return { lines, classes, jenisPlak: '' };
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
    });
  });
  return sections;
}

function findSheet(wb, name) {
  const found = wb.SheetNames.find((n) => n.trim().toUpperCase() === name.toUpperCase());
  return found ? wb.Sheets[found] : null;
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
    if (upper === 'KLAS MATRIX' || upper === 'FRONT PG' || upper === 'TOKOH') return;
    const ws = wb.Sheets[name];
    // Mutually exclusive in practice — a "JENIS PLAK" footer sheet never
    // also carries a "NAMA MURID"/"NAMA GURU" roster header, so running
    // both scans on every sheet is safe and needs no shape pre-detection.
    allSections.push(...scanSheetForSections(ws), ...scanSheetForRosters(ws, sampleCards));
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
      allSections.push({ lines, classes: nativeClasses, jenisPlak });
    }
  }

  const tokohSheet = findSheet(wb, 'TOKOH');
  const tokoh = tokohSheet ? parseTokohSheet(tokohSheet) : null;
  if (tokoh) allSections.push(tokoh);

  allSections.push(...findPerasmiSections(wb));
  const kivNotes = findKivNotes(wb);

  if (allSections.length === 0 && kivNotes.length === 0) {
    return { klasMatrix: null, error: 'No filled-in data found in any recognized sheet of this file.' };
  }
  return {
    klasMatrix: allSections.length > 0 ? { sections: allSections } : null,
    kivNotes,
  };
}
