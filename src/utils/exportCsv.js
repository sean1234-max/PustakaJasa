import {
  CATEGORIES, getCategorySubjects, getCategoryColumns, tahunRangeYears,
  getCustomMatrixRowIds, customMatrixLabelKey, matrixCellKey,
  flattenPlakCatalog, isCustomPlakCode, MANUAL_MAX_QTY, numToOrdinal,
} from '../data/catalog';

export const CSV_COLUMNS = ['event_header', 'year', 'position', 'event_line_1', 'event_line_2'];

// TOKOH_SHEET only: a NAMA MURID of "Reserved" (any case — the three forms
// teachers use are RESERVED / reserved / Reserved) means the teacher has
// pre-booked that row's Jenis Plak before the student's name is known
// (results not out yet). The plaque's stock is still deducted at submit
// like any other row — it's a real reservation — but it has no confirmed
// engraving text, so it is kept OUT of the production CSV until the real
// name replaces "Reserved" (via Amend / Add-On).
export function isReservedName(name) {
  return typeof name === 'string' && name.trim().toLowerCase() === 'reserved';
}

// Categories actually present in this order's items, in catalog order —
// gives Production stable, ordered tabs even for orders with legacy items
// that never got a categoryKey (those are simply excluded).
export function getOrderCategories(order) {
  return CATEGORIES.filter((cat) => (order.items || []).some((it) => it.categoryKey === cat.key));
}

// Reads one reference-sample line (index 0-3) straight by key — the
// Reference Sample section is a CONTOH (layout/sizing sample), so most of
// these are literal fixed text as typed, except where noted in
// buildMatrixRows below.
function getLine(item, lineIndex) {
  const key = `${item.categoryKey}::${item.blockIdx}::${lineIndex}`;
  return item.detail?.lines?.[key] || '';
}

function getPositionLine2(item) {
  const key = `${item.categoryKey}::${item.blockIdx}::2b`;
  return item.detail?.lines?.[key] || '';
}

// The new per-Tahun-block TAHUN value (OTHERS' hasTahunField — see
// catalog.js/computeBlocks.js), stored under a synthetic `tahun` line key
// distinct from the numbered reference-sample lines (0-3/2b) above.
function getTahunField(item) {
  const key = `${item.categoryKey}::${item.blockIdx}::tahun`;
  return item.detail?.lines?.[key] || '';
}

// Matrix categories (MP THP 1/2): the reference sample's second position
// box and 4th line are only a CONTOH of layout — the real per-plaque data
// comes from the quantity matrix itself. Each (subject, column) cell with
// qty > 0 becomes its own row: subject fills in for the sample's second
// position line, column fills in for event_line_1, repeated `qty` times.
function buildMatrixRows(item, cat, header, year, positionPart1, schoolLanguage) {
  const rows = [];
  const matrix = item.detail?.matrix;
  if (!matrix) return rows;
  const columns = getCategoryColumns(cat, schoolLanguage);

  const emitRow = (subject, column, qty) => {
    if (qty <= 0) return;
    const position = positionPart1 ? `${positionPart1}\n${subject}` : subject;
    const row = [header, year, position, column, ''];
    for (let i = 0; i < qty; i++) rows.push(row);
  };

  // `subjectsFromImport` categories keep every subject as an editable
  // `custom-<id>` row once imported — the fixed catalog list is then just a
  // stale default and must not be emitted alongside them.
  const importedSubjects = !!cat.subjectsFromImport && getCustomMatrixRowIds(cat.key, matrix).length > 0;
  if (!importedSubjects) {
    getCategorySubjects(cat, schoolLanguage).forEach((subject) => {
      columns.forEach((column) => {
        emitRow(subject, column, Number(matrix[matrixCellKey(cat.key, subject, column)]) || 0);
      });
    });
  }

  // Teacher-added rows for a subject/award not on the fixed list above (see
  // OrderCategoryBlock's matrix "+ Add Row") — must be exported too, or
  // Production would never see what to actually engrave for them.
  getCustomMatrixRowIds(cat.key, matrix).forEach((rowId) => {
    const subject = matrix[customMatrixLabelKey(cat.key, rowId)] || '';
    if (!subject) return;
    columns.forEach((column) => {
      emitRow(subject, column, Number(matrix[matrixCellKey(cat.key, `custom-${rowId}`, column)]) || 0);
    });
  });

  return rows;
}

// OTHERS' Kuantiti (`hasNamaKelasList`/`hasTahunField` — see catalog.js):
// one TAHUN value for the whole block + a Description/QTY list + a separate
// Nama Kelas name list. Each Description row's QTY is meant to equal the
// Nama Kelas count (one plaque per class, enforced at Add to Cart time —
// see AppState.jsx) — split as evenly as possible across the Nama Kelas
// list here (any remainder to the earliest ones), same idea as PBD's
// per-year split, just keyed by class name instead of Tahun. A block with
// no Nama Kelas filled in yet just emits its TAHUN value alone, instead of
// being dropped entirely. Line 4 (the CONTOH toggle — see buildMatrixRows'
// old comment, still true here) controls whether "TAHUN" is prefixed to
// the block's own TAHUN value.
function buildOthersRows(item, header, year, positionPart1) {
  const rows = [];
  const tahunValue = getTahunField(item);
  const includeTahunWord = /tahun/i.test(getLine(item, 3));
  const tahunPart = tahunValue ? (includeTahunWord ? `TAHUN ${tahunValue}` : tahunValue) : '';
  const namaKelasRows = (item.detail?.columns || []).filter((nk) => (nk.name || '').trim());

  (item.detail?.rows || []).forEach((row) => {
    const qty = Number(row.qty) || 0;
    if (qty <= 0) return;
    const position = positionPart1 ? `${positionPart1}\n${row.desc || ''}` : (row.desc || '');
    if (namaKelasRows.length === 0) {
      const csvRow = [header, year, position, tahunPart, ''];
      for (let i = 0; i < qty; i++) rows.push(csvRow);
      return;
    }
    const base = Math.floor(qty / namaKelasRows.length);
    const remainder = qty % namaKelasRows.length;
    namaKelasRows.forEach((nk, i) => {
      const count = base + (i < remainder ? 1 : 0);
      const eventLine1 = [tahunPart, nk.name].filter(Boolean).join(' ');
      const csvRow = [header, year, position, eventLine1, ''];
      for (let n = 0; n < count; n++) rows.push(csvRow);
    });
  });

  return rows;
}

// Fallback for a category matching neither `mode` ('matrix'/'dynamicMatrix')
// nor `positionFromRows` (defensively covers an unrecognized categoryKey):
// every reference-sample line is fixed as typed, repeated once per unit
// of the item's aggregate qty.
function buildFixedRows(item, header, year, positionPart1) {
  const position2 = getPositionLine2(item);
  const position = position2 ? (positionPart1 ? `${positionPart1}\n${position2}` : position2) : positionPart1;
  const eventLine1 = getLine(item, 3);
  const row = [header, year, position, eventLine1, ''];
  const qty = Number(item.qty) || 0;
  const rows = [];
  for (let i = 0; i < qty; i++) rows.push(row);
  return rows;
}

// LONJAKAN, TOKOH (`positionFromRows` categories): the reference sample's
// last "position" line is only a CONTOH — the real per-plaque position is
// each quantity-table row's own description (e.g. "TAHUN 3", "TOKOH
// NILAM"), repeated that row's own qty times.
// LONJAKAN also has a fixed line 3 ("LONJAKAN SAUJANA") that prefixes the
// engraved position — `positionPart1` carries it in for that category only
// (LONJAKAN sets positionPrefixFromLine3).
//
// `tokohNames` is set only for TOKOH_SHEET (catalog.js's tokohRowFields):
//   * a filled NAMA MURID engraves as the reference sample's line ③ —
//     it fills event_line_1 (the CSV's 4th column) for that row's plaques.
//   * a "Reserved" NAMA MURID (isReservedName) is a stock hold with no
//     confirmed name — the row is skipped entirely (no engraving row).
// For LONJAKAN and Main Template, `tokohNames` is falsy: rows have no
// namaMurid, event_line_1 stays blank, nothing is skipped — same as before.
function buildRowsFromDescriptionRows(item, header, year, positionPart1, tokohNames) {
  const rows = [];
  (item.detail?.rows || []).forEach((r) => {
    const qty = Number(r.qty) || 0;
    if (qty <= 0) return;
    if (tokohNames && isReservedName(r.namaMurid)) return;
    const position = positionPart1 ? `${positionPart1}\n${r.desc || ''}` : (r.desc || '');
    const eventLine1 = tokohNames ? (r.namaMurid || '').trim() : '';
    const row = [header, year, position, eventLine1, ''];
    for (let i = 0; i < qty; i++) rows.push(row);
  });
  return rows;
}

// ALIRAN TERBAIK (catalog.js's aliranKedudukan). One plaque per
// (TAHUN, place). Each cart item is one JENIS PLAK footer row carrying its
// own place range on `item.posDari/posHingga` (AppState.jsx's addToCart);
// a footer row with no range (a flat "ikut sample" plak) engraves ACARA
// only, `qty` times, per flat TAHUN. `item.detail.rows` are the six TAHUN
// rows, each with its own KEDUDUKAN "hingga" place (or 0 for a flat row).
//
// If the teacher OVERRODE the footer row's qty (item.qty differs from what
// the range × ranked-TAHUNs math derives), the per-(TAHUN, place) grid no
// longer applies — emit exactly item.qty rows instead: for a ranged row,
// the position cycles through its own ordinals (year left blank, since we
// no longer know which TAHUN); for a flat row, ACARA only.
function buildAliranRows(item, header, year, acara) {
  const rows = [];
  const tahunRows = item.detail?.rows || [];
  const pos = (p) => (acara ? `${acara}\n${numToOrdinal(p)}` : numToOrdinal(p));

  const derived = tahunRows.reduce((sum, tr) => {
    const hingga = Number(tr.kedudukanHingga) || 0;
    if (item.posDari) {
      if (hingga <= 0) return sum;
      const lo = Number(item.posDari);
      const hi = Math.min(Number(item.posHingga) || lo, hingga);
      return sum + Math.max(0, hi - lo + 1);
    }
    return sum + (hingga > 0 ? 0 : (Number(tr.qty) || 0));
  }, 0);
  const wantQty = Number(item.qty);
  const overridden = Number.isFinite(wantQty) && wantQty !== derived;

  if (overridden) {
    const lo = Number(item.posDari) || 0;
    const span = lo ? Math.max(1, (Number(item.posHingga) || lo) - lo + 1) : 0;
    for (let n = 0; n < wantQty; n++) {
      const position = lo ? pos(lo + (n % span)) : (acara || '');
      rows.push([header, year, position, '', '']);
    }
    return rows;
  }

  tahunRows.forEach((tr) => {
    const hingga = Number(tr.kedudukanHingga) || 0;
    if (hingga > 0) {
      if (!item.posDari) return; // a flat plak doesn't take the KEDUDUKAN TAHUNs
      const lo = Number(item.posDari);
      const hi = Math.min(Number(item.posHingga) || lo, hingga);
      for (let p = lo; p <= hi; p++) rows.push([header, year, pos(p), tr.desc || '', '']);
    } else if (!item.posDari) {
      // flat TAHUN + flat plak — ACARA only, one row per plaque
      const qty = Number(tr.qty) || 0;
      for (let n = 0; n < qty; n++) rows.push([header, year, acara || '', tr.desc || '', '']);
    }
  });
  return rows;
}

// PBD TERBAIK / ALIRAN TERBAIK (dynamicMatrix): same shape as
// buildMatrixRows above, except both axes are per-order data instead of
// catalog-fixed — subject rows (default 13 + any teacher-added extras)
// come from item.detail.rows, and columns (a Tahun range + Nama Kelas,
// entirely teacher-defined) from item.detail.columns. Each (row, column)
// cell's qty is the total across every Tahun the column's range covers
// (e.g. TAHUN 3 - TAHUN 6 needs at least 4 — one per year, enforced at Add
// to Cart time) — split back out as evenly as possible per individual year
// here (any remainder going to the earliest years), each becoming its own
// CSV row: subject fills in for the sample's second position line same as
// MP THP, that year + Nama Kelas joined together fill in event_line_1.
// Tahun is optional (a teacher may leave a class row's Dari/Hingga blank)
// — in that case there's nothing to split by, so the full qty goes into a
// single set of rows using just Nama Kelas for event_line_1, instead of
// being dropped entirely.
function buildPbdMatrixRows(item, header, year, positionPart1, posFromKelas) {
  const rows = [];
  const subjectRows = item.detail?.rows || [];
  const columns = item.detail?.columns || [];
  const matrix = item.detail?.matrix || {};
  subjectRows.forEach((subjectRow) => {
    columns.forEach((col) => {
      const key = `${item.categoryKey}::${item.blockIdx}::${subjectRow.id}::${col.id}`;
      const qty = Number(matrix[key]) || 0;
      if (qty <= 0) return;
      // A combined TOKOH section (excelImport.js's parseTokohSheet): the
      // honour name is carried as the row's Nama Kelas and IS the engraved
      // position on its own — no slot-2 prefix, no event_line_1 (TOKOH
      // plaques have none), no Tahun split.
      if (posFromKelas) {
        const row = [header, year, col.namaKelas || '', '', col.eline2 || ''];
        for (let n = 0; n < qty; n++) rows.push(row);
        return;
      }
      // "KUANTITI" / "KEDUDUKAN" is a synthetic stand-in for "no subject
      // axis" (a plain Tahun quantity list, a flat count) — it is not an
      // engraved line.
      const subj = ['KUANTITI', 'KEDUDUKAN'].includes(String(subjectRow.desc).trim().toUpperCase())
        ? '' : subjectRow.desc;
      const position = [positionPart1, subj].filter(Boolean).join('\n');
      // The 5th CSV column, normally blank — a parallel-class-list import
      // (excelImport.js's readParallelClassLists) puts a fixed "TAHAP 1" /
      // "TAHAP 2" line here. Plain for every other order.
      const eventLine2 = col.eline2 || '';
      const tahunLabels = tahunRangeYears(col.tahunFrom, col.tahunTo);
      if (tahunLabels.length === 0) {
        const eventLine1 = col.namaKelas || '';
        const row = [header, year, position, eventLine1, eventLine2];
        for (let n = 0; n < qty; n++) rows.push(row);
        return;
      }
      const base = Math.floor(qty / tahunLabels.length);
      const remainder = qty % tahunLabels.length;
      tahunLabels.forEach((tahunLabel, i) => {
        const count = base + (i < remainder ? 1 : 0);
        const eventLine1 = [tahunLabel, col.namaKelas].filter(Boolean).join(' ');
        const row = [header, year, position, eventLine1, eventLine2];
        for (let n = 0; n < count; n++) rows.push(row);
      });
    });
  });
  return rows;
}

// Builds every CSV row for one category of one order — or, when `items` is
// passed explicitly, just that subset. `items` doesn't have to share one
// category (each item's own category is looked up individually below), so
// the same function also backs a Jenis-Plak-combined export that spans
// multiple categories — see getOrderJenisPlakGroups and
// reconstructOrderDetailGroups (computeBlocks.js) / ProductionOrderDetail.jsx.
// Items with no `detail` at all (legacy items predating the real submit
// flow) are skipped (reported via skippedItemIds) rather than producing
// blank rows.
export function buildCsvRows(order, categoryKey, items) {
  const schoolLanguage = order.schoolLanguage === 'SJKC' ? 'SJKC' : 'SK';
  const scopedItems = items || (order.items || []).filter((it) => it.categoryKey === categoryKey);
  const rows = [];
  const skippedItemIds = [];
  // TOKOH_SHEET plaques whose NAMA MURID is "Reserved" — stock is held for
  // them but they're deliberately left out of the CSV (isReservedName).
  // Summed as plaque count so validateExport can tell "nothing to engrave
  // yet" apart from "the data is broken".
  let reservedCount = 0;

  scopedItems.forEach((item) => {
    if (!item.detail || !item.detail.lines || Object.keys(item.detail.lines).length === 0) {
      skippedItemIds.push(item.id);
      return;
    }
    const cat = CATEGORIES.find((c) => c.key === item.categoryKey);
    // TAJUK BESAR can be two engraved lines (school + event) — a
    // pre-written / roster import splits them into slot 0 + slot 0b so the
    // teacher edits each as its own single-line field. Joined back here for
    // the CSV's one event_header column. No slot 0b => header unchanged.
    const header = [getLine(item, 0), getLine(item, '0b')].filter(Boolean).join('\n');
    const year = getLine(item, 1);

    if (cat?.mode === 'matrix') {
      rows.push(...buildMatrixRows(item, cat, header, year, getLine(item, 2), schoolLanguage));
    } else if (cat?.mode === 'dynamicMatrix') {
      // A combined TOKOH section marks slot '2' as a sample-only example
      // (posFromKelas) — its real positions are the honour names carried
      // as each row's Nama Kelas.
      const posFromKelas = !!getLine(item, 'posFromKelas');
      rows.push(...buildPbdMatrixRows(item, header, year, posFromKelas ? '' : getLine(item, 2), posFromKelas));
    } else if (cat?.aliranKedudukan) {
      rows.push(...buildAliranRows(item, header, year, getLine(item, 2)));
    } else if (cat?.hasNamaKelasList) {
      rows.push(...buildOthersRows(item, header, year, getLine(item, 2)));
    } else if (cat?.positionFromRows) {
      if (cat.tokohRowFields) {
        (item.detail?.rows || []).forEach((r) => {
          if (isReservedName(r.namaMurid)) reservedCount += Number(r.qty) || 0;
        });
      }
      rows.push(...buildRowsFromDescriptionRows(
        item, header, year,
        cat.positionPrefixFromLine3 ? getLine(item, 2) : '',
        cat.tokohRowFields,
      ));
    } else {
      rows.push(...buildFixedRows(item, header, year, getLine(item, 2)));
    }
  });

  return { rows, skippedItemIds, reservedCount };
}

// Groups an order's items by Jenis Plak, regardless of which category or
// batch each came from — the CSV's own columns (event_header, year,
// position, event_line_1, event_line_2) carry no Jenis Plak info at all,
// so two items sharing the same Jenis Plak are, for export purposes,
// interchangeable rows bound for the exact same physical AI file. Lets
// Production export one combined CSV per Jenis Plak instead of one per
// category/order-detail, when the same Jenis Plak was ordered in more than
// one place.
export function getOrderJenisPlakGroups(order) {
  const byPlak = new Map();
  (order.items || []).forEach((item) => {
    if (!item.jenisPlak) return;
    if (!byPlak.has(item.jenisPlak)) byPlak.set(item.jenisPlak, []);
    byPlak.get(item.jenisPlak).push(item);
  });
  return [...byPlak.entries()].map(([jenisPlak, items]) => ({ jenisPlak, items }));
}

// For each Jenis Plak group (getOrderJenisPlakGroups), whether Production
// should export a CSV or type the plaques by hand. Keyed by the exact
// jenisPlak string. `totalQty` is the sum of every item's qty for that
// Jenis Plak across the whole order — the same number the school's FRONT
// PG page totals — so a Jenis Plak ordered in several places is judged on
// its combined size, not each line. Computed live (never stored) so it
// stays correct after an amend. See catalog.js's MANUAL_MAX_QTY.
export function getPlakProductionMode(order) {
  const modes = new Map();
  getOrderJenisPlakGroups(order).forEach(({ jenisPlak, items }) => {
    const totalQty = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
    modes.set(jenisPlak, {
      mode: totalQty <= MANUAL_MAX_QTY ? 'manual' : 'csv',
      totalQty,
    });
  });
  return modes;
}

// Collapses a group's built CSV rows down to the distinct plaque texts a
// Production operator would hand-type, each with how many to make — for
// the "BUAT MANUAL" checklist shown instead of an export button. Order of
// first appearance is kept. Rows whose position AND event lines are all
// blank collapse into one "(no text)" entry rather than vanishing.
export function summarizeRowsForManual(rows) {
  const seen = new Map();
  (rows || []).forEach((r) => {
    const text = [r[2], r[3], r[4]].map((v) => String(v ?? '').trim()).filter(Boolean).join('  ·  ');
    const key = text || '(tiada teks)';
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  return [...seen.entries()].map(([text, count]) => ({ text, count }));
}

// RFC4180-quoted CSV text. Any value containing a newline, comma, or quote
// gets wrapped in double quotes with embedded quotes doubled — critically,
// an embedded newline (the manual line break a teacher types into the
// "position" field) is preserved raw inside the quotes, which is what
// Excel/Illustrator render as an in-cell line break (the Alt+Enter result).
function quoteCsvValue(value) {
  let str = String(value ?? '');
  // A leading =, +, -, or @ makes Excel/Sheets read the cell as a formula
  // instead of text — a teacher-typed field (e.g. a plaque line) starting
  // with one of these would otherwise execute as a formula for whoever
  // opens the exported CSV. Prefixing with a tab neutralizes it while
  // staying invisible in the cell.
  if (/^[=+\-@]/.test(str)) str = `\t${str}`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function rowsToCsv(rows) {
  const lines = [CSV_COLUMNS, ...rows].map((row) => row.map(quoteCsvValue).join(','));
  return lines.join('\r\n');
}

const WINDOWS_RESERVED_CHARS = /[\\/:*?"<>|]/g;

function sanitizeFilenamePart(part) {
  return part.replace(WINDOWS_RESERVED_CHARS, '-').replace(/\s+/g, ' ').trim();
}

export function buildCategoryCsvFilename(order, categoryLabel) {
  const invoice = sanitizeFilenamePart(order.invoiceId || order.id);
  const category = sanitizeFilenamePart(categoryLabel);
  return `(${invoice}) - ${category}.csv`;
}

// The gate between "here are some rows" and "hand this file to production".
// `csvData` is the { rows, skippedItemIds } that buildCsvRows already
// produced for this same `items` selection — passed in rather than
// recomputed so the caller and the check can never disagree about what's
// being exported. `errors` block the export outright (the data would reach
// an engraving machine wrong or incomplete); `warnings` are surfaced but
// don't block (the operator may know the blank is intentional).
export function validateExport(order, items, plakCatalog, csvData) {
  const errors = [];
  const warnings = [];
  const scoped = items || (order.items || []);
  const { rows = [], skippedItemIds = [], reservedCount = 0 } = csvData || {};

  // 1. An item with no reference-sample data at all is silently dropped by
  //    buildCsvRows (skippedItemIds) — those plaques would just be missing
  //    from the file with nothing telling production they were ordered.
  if (skippedItemIds.length > 0) {
    errors.push(`${skippedItemIds.length} item(s) have no Reference Sample data — they would be missing from the CSV entirely. Fill them in before exporting.`);
  }

  // 2. Every item must carry a Jenis Plak that actually resolves — either a
  //    real catalog path, or a deliberate "OTHER - ..." custom pick. Raw,
  //    un-matched text (e.g. straight from an import) can't be routed to a
  //    production file.
  const flatCatalog = flattenPlakCatalog(plakCatalog);
  const validPaths = new Set(flatCatalog.map((p) => p.code));
  const missingPlak = scoped.filter((it) => !it.jenisPlak).length;
  if (missingPlak > 0) {
    errors.push(`${missingPlak} item(s) have no Jenis Plak selected.`);
  }
  // Only cross-check against the catalog when it's actually loaded — an
  // empty tree means "not fetched yet", not "every code is invalid".
  if (flatCatalog.length > 0) {
    const unknownPlak = [...new Set(
      scoped.filter((it) => it.jenisPlak && !isCustomPlakCode(it.jenisPlak) && !validPaths.has(it.jenisPlak))
        .map((it) => it.jenisPlak),
    )];
    if (unknownPlak.length > 0) {
      errors.push(`Jenis Plak not found in the catalog: ${unknownPlak.join(', ')}.`);
    }
  }

  // 3. Something was selected but it produced nothing to engrave.
  if (rows.length === 0 && reservedCount > 0 && skippedItemIds.length === 0) {
    // Every TOKOH plaque here is still "Reserved" — the stock is held, but
    // there is genuinely nothing to engrave yet. A clear message, not the
    // generic "data is incomplete" one below.
    errors.push(`All ${reservedCount} plaque(s) in this selection are still "Reserved" (stock is held, names not confirmed). Nothing to engrave yet — export again once the names are filled in.`);
  } else if (rows.length === 0 && scoped.length > 0 && skippedItemIds.length === 0) {
    errors.push('This selection produces no CSV rows — every quantity is 0, or the reference data is incomplete.');
  }

  // 4. Non-blocking: rows that would engrave with an empty title / position.
  const blankHeader = rows.filter((r) => !String(r[0] ?? '').trim()).length;
  if (blankHeader > 0) {
    warnings.push(`${blankHeader} row(s) would engrave with no event header (TAJUK BESAR).`);
  }
  const blankPosition = rows.filter((r) => !String(r[2] ?? '').trim()).length;
  if (blankPosition > 0) {
    warnings.push(`${blankPosition} row(s) have a blank "position" field.`);
  }

  // 5. Non-blocking: some (not all) plaques are still "Reserved" — held for
  //    stock, left out of this file on purpose. Flag so production knows to
  //    expect a follow-up export once those names are confirmed.
  if (reservedCount > 0 && rows.length > 0) {
    warnings.push(`${reservedCount} "Reserved" plaque(s) are held for stock but left out of this CSV — export again once their names are confirmed.`);
  }

  return { ok: errors.length === 0, errors, warnings, rowCount: rows.length };
}
