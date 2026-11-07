// The website's own "file read → draft" step (Sean, 2026-11-07: moved out of AppState.jsx's
// importFormAnugerahExcelInto so the Telegram form bot submits orders exactly as the website does —
// scripts/telegram-bot/order-entry.js bundles it). Pure: `st` is the state (or a bot's stand-in for it) the
// parsed file goes into; `fields` maps the generic draft names onto that state's keys (NEW_ORDER_IMPORT_FIELDS
// / AddOn's DRAFT_FIELDS). Returns the new state and what the page tells the user — nothing is written.
import {
  CATEGORIES, getCategorySubjects, matrixCellKey, customMatrixLabelKey,
  resolveCategory, isDynamicCategoryKey, nextFreeCategoryKey, malaysiaToday,
} from '../data/catalog';
import { matchJenisPlakPath, deriveKlasMatrixSectionLines, populateMatrixSectionBlock } from '../utils/excelImport';
import { checkColumnTotals, checkExpansionTotals, checkLevelBreakdownMatch, checkAliranKelasTotals } from '../utils/importChecks';
import { frontPgToFunctionDetails } from '../utils/frontPgDetails';
import { REMARK_ITEMS_HEADER } from '../utils/schoolList';

// The New Order draft's own keys (AppState.jsx; the Telegram bot's order builder uses the same)
export const NEW_ORDER_IMPORT_FIELDS = {
  lineValues: 'lineValues', matrixValues: 'matrixValues', rowsByBlock: 'rowsByBlock', columnsByBlock: 'columnsByBlock', plakRows: 'plakRows',
  nextRowId: 'nextRowId', nextColumnId: 'nextColumnId', nextPlakRowId: 'nextPlakRowId',
  visibleBlocksByCategory: 'visibleBlocksByCategory', category: 'category',
  remark: 'remark', importFilePath: 'importFilePath', importFileName: 'importFileName',
  // FRONT PG's header fills this New Order's Function Details (Step 1).
  functionDetails: true,
};

export function applyParsedImport(st, parsedIn, fields, { applyFilter = null, keep = null } = {}) {
  let parsed = parsedIn;
  const messages = [];
  const warnings = [];
  const remarkNotes = [];
  let landOn = null;

  // Computed from a plain snapshot (stateRef.current — nothing else can
  // change it between here and the setState call below, since there's no
  // `await` in between) rather than inside a setState updater function:
  // React 18 Strict Mode deliberately invokes an updater function TWICE
  // in development to catch impurity, and `warnings`/`messages`
  // above are mutated (via .push) as a side effect of running this block
  // — a second invocation would silently double every warning/message
  // (exactly what duplicated every "couldn't match Jenis Plak" line in
  // the review list). Computing the whole result once, up front, and
  // handing setState an already-finished plain object sidesteps the
  // problem entirely — merging the same finished object twice is a
  // no-op, not a double-push.
  // `st`: the state the file is imported into (a plain snapshot, see the note above)
  let next = st;

  // `keep`: tabs another uploaded file of this order already filled (NewOrderStep2.jsx, several
  // files) — this file's copy of one opens as "<tab> (2)" instead of replacing it.
  if (keep?.size && parsed.categorized) {
    const used = new Set([...keep, ...Object.keys(parsed.categorized)]);
    const categorized = Object.fromEntries(Object.entries(parsed.categorized).map(([k, secs]) => {
      if (!keep.has(k)) return [k, secs];
      const free = nextFreeCategoryKey(k, used);
      used.add(free);
      return [free, [].concat(secs || []).map((sec) => ({ ...sec, dynamicCategoryKey: free }))];
    }));
    parsed = { ...parsed, categorized };
  }

  // A school's own list (excelImport.js parseSchoolListSheet): a row whose code the website
  // doesn't sell (or with no wording) goes to the Remark as "KOD/RM unit/RM total" instead
  // (Sean, 2026-10-22); a tab left with no rows isn't opened at all.
  if (parsed.categorized) {
    const toRemark = (ur) => ur.toRemark && (ur.noWording || !matchJenisPlakPath(ur.jenisPlak, st.plakCatalog));
    const itemRows = [];
    const categorized = Object.fromEntries(Object.entries(parsed.categorized).map(([k, secs]) => [k, [].concat(secs || []).flatMap((sec) => {
      if (!sec.isUmumList) return [sec];
      sec.umumRows.filter(toRemark).forEach((ur) => itemRows.push(ur.toRemark));
      const umumRows = sec.umumRows.filter((ur) => !toRemark(ur));
      return umumRows.length ? [{ ...sec, umumRows }] : [];
    })]).filter(([, secs]) => secs.length));
    parsed = { ...parsed, categorized };
    // under one header line, so the Remark shows them as a table
    if (itemRows.length) remarkNotes.push(REMARK_ITEMS_HEADER, ...itemRows);
  }

  // Jenis Plak text the catalog can't place is left BLANK (never the raw
  // text — see the populateMatrixSectionBlock note below) and recorded
  // here, so the page can tell the teacher right after the import which
  // ones to pick by hand instead of leaving it to Add to Cart.
  const matchPlakOrWarn = (raw, catKey, label) => {
    const matched = raw ? matchJenisPlakPath(raw, st.plakCatalog) : '';
    if (raw && !matched) {
      warnings.push({ type: 'plakMismatch', blockIdx: 0, catKey, raw, text: `${label}: couldn't match Jenis Plak "${raw}" to anything in the catalog — please choose it manually.` });
    }
    return matched;
  };

  // KLAS_MATRIX ("Mata Pelajaran / Klas (Matrix)") is retired from new
  // orders (catalog.js) — every FORM ANUGERAH sheet now has its own
  // category. A generic/legacy sheet that would once have landed there
  // (e.g. a stray "TOKOH" or "KLAS MATRIX" sheet) is reported as skipped
  // rather than filling a category the teacher can no longer see or edit.
  const klasMatrixActive = CATEGORIES.find((c) => c.key === 'KLAS_MATRIX')?.active !== false;
  if (parsed.klasMatrix && !klasMatrixActive) {
    warnings.push({
      type: 'truncated',
      text: `${parsed.klasMatrix.sections.length} section(s) in this file didn't match any FORM ANUGERAH sheet and were skipped — please add them by hand.`,
    });
  }

  if (parsed.klasMatrix && klasMatrixActive) {
    const catKey = 'KLAS_MATRIX';
    const cat = CATEGORIES.find((c) => c.key === catKey);
    const maxSections = Math.min(parsed.klasMatrix.sections.length, cat.blocksCount || 1);
    // A file with more independent awards than KLAS_MATRIX has room for
    // (catalog.js's blocksCount) would otherwise just silently lose the
    // rest — nothing else here would ever tell the teacher a whole
    // section didn't make it in at all.
    if (parsed.klasMatrix.sections.length > maxSections) {
      warnings.push({ type: 'truncated', text: `This file has ${parsed.klasMatrix.sections.length} sections, but only the first ${maxSections} could be imported — please upload the rest separately.` });
    }
    const defaultNames = getCategorySubjects(cat, next.schoolLanguage);
    let nextRowId = next[fields.nextRowId];
    let nextColumnId = next[fields.nextColumnId];
    let nextPlakRowId = next[fields.nextPlakRowId];
    const newLineValues = { ...next[fields.lineValues] };
    const newMatrixValues = { ...next[fields.matrixValues] };
    const newRowsByBlock = { ...next[fields.rowsByBlock] };
    const newColumnsByBlock = { ...next[fields.columnsByBlock] };
    const newPlakRows = { ...next[fields.plakRows] };
    // Clear every pre-allocated block's own draft first — a fresh import
    // is meant to fully replace whatever was there, not layer on top,
    // including any block this file's sections don't reach.
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      const key = `${catKey}::${b}`;
      Object.keys(newLineValues).forEach((k) => { if (k.startsWith(`${key}::`)) delete newLineValues[k]; });
      Object.keys(newMatrixValues).forEach((k) => { if (k.startsWith(`${key}::`)) delete newMatrixValues[k]; });
    }

    for (let b = 0; b < maxSections; b++) {
      const section = parsed.klasMatrix.sections[b];
      const key = `${catKey}::${b}`;
      // Only subjects this section's own source actually carried any
      // qty for — a section imported from PBD/LONJAKAN (their own
      // synthetic "KUANTITI"/"KEDUDUKAN" single-column stand-in) or from
      // a Nama Kelas list has no real subject breakdown at all, and
      // padding it out with the other 12 always-empty default subject
      // columns would just be noise the teacher has to scroll past and
      // manually delete. Subjects actually present are ordered to match
      // the familiar default-13 order first, with any name outside that
      // list (MP THP 2's own SEJARAH/REKA BENTUK & TEKNOLOGI, or the
      // synthetic stand-ins above) appended after — see
      // populateMatrixSectionBlock.
      //
      // "SM - 13187 (GOLD)" etc isn't itself a valid Jenis Plak value —
      // PlakPicker/pricing need the exact ' / '-joined catalog path
      // (e.g. "SM-13187 / GOLD / NORMAL") — matchJenisPlakPath walks the
      // LIVE catalog tree to build it, defaulting an unmentioned base to
      // "NORMAL" the same way a teacher would if they left it out. Left
      // BLANK (never the raw, un-matched text) when even the code itself
      // can't be found in the catalog at all — raw text sitting in this
      // field would otherwise look like a real, chosen Jenis Plak (it
      // satisfies addToCart's own hasJenisPlak check, silently letting a
      // completely un-priced, unstocked value through to checkout);
      // leaving it genuinely blank routes it through that SAME existing
      // "please choose a Jenis Plak" gate instead of past it. The
      // teacher would never otherwise realize this one field didn't
      // actually come from their file — flagged in `warnings` below.
      // `blockIdx` lets NewOrderStep2.jsx re-check THIS specific block's
      // own live plakRows on every render and drop the warning the
      // moment the teacher actually picks something — a warning that
      // still said "please choose manually" after they just did would
      // read as broken, not helpful.
      const ids = { nextRowId, nextColumnId, nextPlakRowId };
      const matchedPlak = populateMatrixSectionBlock(
        section, key, defaultNames, ids,
        { newLineValues, newMatrixValues, newRowsByBlock, newColumnsByBlock, newPlakRows },
        next.plakCatalog,
      );
      ({ nextRowId, nextColumnId, nextPlakRowId } = ids);
      if (section.jenisPlak && !matchedPlak) {
        warnings.push({ type: 'plakMismatch', blockIdx: b, raw: section.jenisPlak, text: `Section ${b + 1}: couldn't match Jenis Plak "${section.jenisPlak}" to anything in the catalog — please choose it manually.` });
      }
      // A PERASMI section's own wording (findPerasmiSections) also goes
      // into the order's Remark, not just its own Reference Sample —
      // Sales/Invoicing/Production reading the order later never open
      // Step 2's block editor, so the ONLY place they'd otherwise see
      // this at all is the printed plaque preview itself.
      if (section.remarkNote) remarkNotes.push(section.remarkNote);
    }

    next = {
      ...next,
      [fields.lineValues]: newLineValues, [fields.matrixValues]: newMatrixValues,
      [fields.rowsByBlock]: newRowsByBlock, [fields.columnsByBlock]: newColumnsByBlock, [fields.plakRows]: newPlakRows,
      [fields.visibleBlocksByCategory]: { ...next[fields.visibleBlocksByCategory], [catKey]: maxSections },
      [fields.nextRowId]: nextRowId, [fields.nextColumnId]: nextColumnId, [fields.nextPlakRowId]: nextPlakRowId,
    };
    landOn = catKey;
    messages.push(`Mata Pelajaran/Klas (Matrix): ${maxSections} section(s)`);

    // Cross-check each subject matrix against the teacher's own TOTAL row.
    // A mismatch becomes a `type:'choice'` warning the teacher must answer
    // on Step 2 before Add to Cart (see NewOrderStep2's "Confirm before continuing"
    // panel) — never auto-corrected here. Each option carries the exact
    // draft edits its answer implies, resolved to real row/column ids now
    // while newRowsByBlock/newColumnsByBlock are in scope.
    const importedSections = parsed.klasMatrix.sections.slice(0, maxSections);
    const columnTotalIssues = checkColumnTotals(importedSections);
    columnTotalIssues.forEach((iss) => {
      const key = `${catKey}::${iss.sectionIdx}`;
      const rows = newRowsByBlock[key] || [];
      const cols = newColumnsByBlock[key] || [];
      const col = cols.find((c) => (c.namaKelas || c.tahunFrom || c.tahunTo || '') === iss.classLabel);
      const addPatches = [];
      if (col) {
        iss.missing.forEach((m) => {
          const row = rows.find((r) => r.desc === m.name);
          if (row) addPatches.push({ mkey: `${key}::${row.id}::${col.id}`, value: String(m.qty) });
        });
      }
      const options = [];
      if (iss.missing.length > 0 && addPatches.length === iss.missing.length) {
        options.push({ key: 'add', label: `${iss.missing.map((m) => m.name).join(', ')} was left blank — fill it back in` });
      }
      options.push({ key: 'total', label: `The TOTAL figure is wrong — it should be ${iss.computed}` });
      options.push({ key: 'keep', label: 'Neither is right — I will fix it myself below' });
      warnings.push({
        type: 'choice',
        id: iss.id,
        blockIdx: iss.sectionIdx,
        text: `Section ${iss.sectionIdx + 1} · ${iss.classLabel}: you filled in ${iss.computed}, but the TOTAL says ${iss.stated}.`,
        options,
        addPatches,
      });
    });

    // Second cross-check: what each plaque code's sections add up to vs
    // the school's own FRONT PG grand total. No auto-fix — the parser
    // can't know where a shortfall belongs — so this only asks, and it
    // skips any code already covered by a column-total question above.
    checkExpansionTotals(importedSections, columnTotalIssues.map((i) => i.sectionIdx)).forEach((iss) => {
      const where = iss.sectionIdxs.map((i) => i + 1).join(', ');
      warnings.push({
        type: 'choice',
        id: iss.id,
        blockIdx: iss.sectionIdxs[0],
        text: `${iss.jenisPlak} (section ${where}): the imported classes add up to ${iss.computed}, but FRONT PG says ${iss.stated}. Something didn't come through — check this section below.`,
        options: [{ key: 'keep', label: 'Got it — take me to that section' }],
        addPatches: [],
      });
    });

  }

  // Sections from a sheet with its own dedicated real category (PPKI, MP
  // THP 1, ...) — see excelImport.js's `categorized` split — write
  // straight into that category's own fixed matrix instead of
  // KLAS_MATRIX. These are `mode:'matrix'` categories (catalog.js): the
  // subject/column list is a fixed catalog list, not per-order like
  // KLAS_MATRIX's own teacher-defined rows/columns, so there's no
  // rowsByBlock/columnsByBlock bookkeeping needed here at all — just one
  // matrixValues cell per (subject, column) pair, keyed by their own
  // literal text (matrixCellKey), the same key shape MP THP has always
  // used for a hand-filled block.
  if (parsed.categorized) {
    Object.entries(parsed.categorized).forEach(([catKey, sections]) => {
      // resolveCategory (not a raw CATEGORIES.find) also resolves a
      // renamed/duplicated template sheet's synthetic key — see
      // excelImport.js's dynamicCategoryKey / catalog.js's
      // makeDynamicCategoryKey.
      const cat = resolveCategory(catKey);
      if (!cat || sections.length === 0) return;
      // blocksCount is always 1 for these categories today — a file with
      // more than one independent section for the same sheet has nowhere
      // else to land the rest, same overflow story as KLAS_MATRIX's own
      // maxSections above.
      if (sections.length > (cat.blocksCount || 1)) {
        warnings.push({ type: 'truncated', text: `${cat.label}: this file has ${sections.length} sections, but only the first could be imported — please upload the rest separately.` });
      }
      const section = sections[0];
      const key = `${catKey}::0`;
      const newLineValues = { ...next[fields.lineValues] };
      const newMatrixValues = { ...next[fields.matrixValues] };
      const newRowsByBlock = { ...next[fields.rowsByBlock] };
      let nextRowId = next[fields.nextRowId];
      // Subject name -> the `custom-<id>` row it became (subjectsFromImport
      // branch below) — used to resolve a level-breakdown mismatch
      // question's "betulkan" fix to the exact matrix cell.
      let importedRowIdByName = null;
      // A fresh import fully replaces whatever was there before, same as
      // KLAS_MATRIX's own per-block clear above.
      Object.keys(newLineValues).forEach((k) => { if (k.startsWith(`${key}::`)) delete newLineValues[k]; });
      Object.keys(newMatrixValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete newMatrixValues[k]; });
      Object.keys(newRowsByBlock).forEach((k) => { if (k.startsWith(`${key}::`)) delete newRowsByBlock[k]; });

      // A renamed/duplicated PPKI/MP-THP-shaped sheet (excelImport.js's
      // dynamicCategoryKey, templateKind 'KLAS_MATRIX') needs the SAME
      // rows-as-subjects + columns-as-classes storage the KLAS_MATRIX
      // multi-section import above uses (mode: 'dynamicMatrix') — quite
      // unlike every branch below, which all populate either a FIXED
      // matrix (mode: 'matrix') or a plain row list (mode: 'list'), and
      // none of which ever touch columnsByBlock. Handled as its own
      // self-contained branch (via the shared populateMatrixSectionBlock
      // the KLAS_MATRIX loop above also uses) and returned early, rather
      // than threaded through the generic chain below.
      if (cat.mode === 'dynamicMatrix') {
        const newColumnsByBlockDyn = { ...next[fields.columnsByBlock] };
        Object.keys(newColumnsByBlockDyn).forEach((k) => { if (k.startsWith(`${key}::`)) delete newColumnsByBlockDyn[k]; });
        const newPlakRowsDyn = { ...next[fields.plakRows] };
        const defaultNamesDyn = getCategorySubjects(cat, next.schoolLanguage);
        const ids = { nextRowId, nextColumnId: next[fields.nextColumnId], nextPlakRowId: next[fields.nextPlakRowId] };
        const matchedPlak = populateMatrixSectionBlock(
          section, key, defaultNamesDyn, ids,
          { newLineValues, newMatrixValues, newRowsByBlock, newColumnsByBlock: newColumnsByBlockDyn, newPlakRows: newPlakRowsDyn },
          next.plakCatalog,
        );
        if (section.jenisPlak && !matchedPlak) {
          warnings.push({ type: 'plakMismatch', blockIdx: 0, catKey, raw: section.jenisPlak, text: `${cat.label}: couldn't match Jenis Plak "${section.jenisPlak}" to anything in the catalog — please choose it manually.` });
        }
        if (section.remarkNote) remarkNotes.push(section.remarkNote);
        if (applyFilter) applyFilter(catKey, key, { newLineValues, newMatrixValues, newRowsByBlock, newPlakRows: newPlakRowsDyn });
        next = {
          ...next,
          [fields.lineValues]: newLineValues, [fields.matrixValues]: newMatrixValues, [fields.rowsByBlock]: newRowsByBlock,
          [fields.columnsByBlock]: newColumnsByBlockDyn, [fields.plakRows]: newPlakRowsDyn,
          [fields.nextRowId]: ids.nextRowId, [fields.nextColumnId]: ids.nextColumnId, [fields.nextPlakRowId]: ids.nextPlakRowId,
          [fields.visibleBlocksByCategory]: { ...next[fields.visibleBlocksByCategory], [catKey]: 1 },
        };
        if (!landOn) landOn = catKey;
        messages.push(`${cat.label}: imported`);
        return;
      }

      if (section.isSimpleTahunList) {
        // LONJAKAN SAUJANA — TAHUN 1-6, each with its own QTY + Jenis Plak.
        const byTahun = new Map(section.tahunRows.filter((tr) => tr.tahun).map((tr) => [tr.tahun, tr]));
        // An un-matched Jenis Plak just leaves the row blank — the teacher
        // picks it here. NewOrderStep2's "can't add to cart" panel
        // (buildCategoryCartItems) names every such row, so no separate
        // import warning is raised.
        const fixedRows = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'].map((tahun) => {
          const tr = byTahun.get(tahun);
          const matched = matchPlakOrWarn(tr?.jenisPlak, catKey, cat.label);
          return { id: nextRowId++, desc: tahun, qty: tr && tr.qty ? String(tr.qty) : '', jenisPlak: matched };
        });
        // A row whose own label isn't a plain "TAHUN n" (e.g. "TAHAP 1",
        // "TAHAP 2") is an extra row the teacher added on the sheet, not a
        // same-numbered TAHUN slot — kept as its own row with that exact
        // wording instead of being folded into the fixed 6 above.
        const extraRows = section.tahunRows.filter((tr) => !tr.tahun).map((tr) => {
          const matched = matchPlakOrWarn(tr.jenisPlak, catKey, cat.label);
          return { id: nextRowId++, desc: tr.label, qty: tr.qty ? String(tr.qty) : '', jenisPlak: matched };
        });
        newRowsByBlock[key] = [...fixedRows, ...extraRows];
      } else if (section.isTokohList) {
        // TOKOH (excelImport.js's parseTokohAnugerahSheet) — one honour
        // per row, in sheet order (not a fixed preset). Each row keeps
        // its own NAMA MURID / GAMBAR / DESIGN metadata + its own Jenis
        // Plak (plakPerRow).
        newRowsByBlock[key] = section.tokohRows.map((tr) => {
          const matched = matchPlakOrWarn(tr.jenisPlak, catKey, cat.label);
          // Un-matched → blank, picked here; flagged by buildCategoryCartItems.
          return {
            id: nextRowId++, desc: tr.desc, qty: tr.qty ? String(tr.qty) : '',
            jenisPlak: matched, namaMurid: tr.namaMurid || '', gambar: tr.gambar || '', design: tr.design || '',
          };
        });
      } else if (section.isUmumList) {
        // UMUM (ORDER LAIN-LAIN) (excelImport.js's parseUmumSheet) — one row per plak
        // row of the sheet: its own ①–④ changes (l0–l3), KUANTITI, Jenis
        // Plak (plakPerRow) and the sheet's HARGA PER UNIT, kept only to
        // show it (catalog.js's UMUM_ROW_FIELDS).
        newRowsByBlock[key] = section.umumRows.map((ur) => ({
          id: nextRowId++, desc: ur.no, qty: ur.qty ? String(ur.qty) : '',
          jenisPlak: matchPlakOrWarn(ur.jenisPlak, catKey, cat.label),
          l0: ur.l0, l1: ur.l1, l2: ur.l2, l3: ur.l3, hargaExcel: ur.harga,
        }));
      } else if (section.isAliran || section.isAliranKelas) {
        // ALIRAN TERBAIK (excelImport.js's parseAliranSheet) — six fixed
        // TAHUN rows, each carrying a KEDUDUKAN "hingga" place or a flat
        // qty; plus a multi-row JENIS PLAK footer of position ranges.
        const byTahun = new Map(section.tahunRows.map((tr) => [tr.tahun, tr]));
        // TAHUN 1-6, then the sheet's own extra levels (PRA SEKOLAH, PPKI — excelImport.js aliranLevel)
        const extraLevels = section.tahunRows.map((tr) => tr.tahun).filter((t) => !/^TAHUN [1-6]$/.test(t));
        newRowsByBlock[key] = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6', ...extraLevels].map((tahun) => {
          const tr = byTahun.get(tahun);
          if (tr && tr.hingga) return { id: nextRowId++, desc: tahun, qty: String(tr.hingga - (tr.dari || 1) + 1), kedudukanHingga: tr.hingga };
          if (tr && tr.flatQty) return { id: nextRowId++, desc: tahun, qty: String(tr.flatQty), kedudukanHingga: 0 };
          return { id: nextRowId++, desc: tahun, qty: '', kedudukanHingga: 0 };
        });
        // "Kalau ada kelas" — each Tahun's own Nama Kelas list, stored the
        // same way PPKI/PBD's level breakdown is (`${key}::${tahun}::main`),
        // so computeBlocks / draftUpdaters can show and re-sum it.
        (section.levelBreakdown || []).forEach(({ label, mainRows }) => {
          newRowsByBlock[`${key}::${label}::main`] = mainRows.map((r) => ({ id: nextRowId++, desc: r.name, qty: String(r.qty) }));
        });
        // A Tahun whose typed TOTAL disagrees with (class QTY sum ×
        // KEDUDUKAN places) — usually an old form where QTY was typed as
        // the class's whole total. Surfaced as a Step-2 question; the
        // website always uses the computed figure regardless of the answer.
        if (section.isAliranKelas) {
          checkAliranKelasTotals(section).forEach((iss) => {
            const how = iss.places > 1 ? `${iss.classSum} × ${iss.places} kedudukan` : `${iss.classSum}`;
            warnings.push({
              type: 'choice',
              id: `${catKey}::${iss.id}`,
              blockIdx: 0,
              catKey,
              text: `${cat.label} · ${iss.level}: TOTAL dalam fail ialah ${iss.stated}, tapi ikut senarai Nama Kelas sepatutnya ${iss.computed} (${how}). QTY setiap kelas = bilangan plak untuk SETIAP kedudukan (biasanya 1), bukan jumlah. Sila semak.`,
              options: [{ key: 'keep', label: 'OK, saya semak' }],
              addPatches: [],
            });
          });
        }
      } else if (section.isSelempangList) {
        // SELEMPANG (excelImport.js's parseSelempangSheet) — plain
        // ACARA / WARNA / KUANTITI rows. computeBlocks re-resolves the
        // colour text, so only the raw values are stored here.
        newRowsByBlock[key] = (section.selempangRows || []).map((sr) => ({
          id: nextRowId++, acara: sr.acara || '', warna: sr.warna || '', qty: sr.qty ? String(sr.qty) : '',
        }));
        if (newRowsByBlock[key].length === 0) newRowsByBlock[key] = [{ id: nextRowId++, acara: '', warna: '', qty: '' }];
      } else if (section.isTahunList) {
        // PBD (excelImport.js's parsePbdSheet) — no subject axis, one
        // KUANTITI total per Tahun. The category is a 1-column matrix
        // whose "subject" rows ARE the Tahuns, kept as editable
        // `custom-<id>` rows built from the sheet's own labels (which can
        // carry a qualifier like "PKB", or be an added row) — same as
        // PPKI/MP THP's subjects. The single column is "KUANTITI".
        importedRowIdByName = new Map();
        (section.subjectOrder || section.tahunRows.map((tr) => tr.tahun)).forEach((label) => {
          if (!label || importedRowIdByName.has(label)) return;
          const rowId = nextRowId++;
          importedRowIdByName.set(label, rowId);
          newMatrixValues[customMatrixLabelKey(catKey, rowId)] = label;
        });
        section.tahunRows.forEach(({ tahun, qty }) => {
          const rowId = importedRowIdByName.get(tahun);
          if (rowId == null || !qty) return;
          newMatrixValues[matrixCellKey(catKey, `custom-${rowId}`, 'KUANTITI')] = String(qty);
        });
      } else if (cat.subjectsFromImport && section.subjectOrder) {
        // PPKI / MP THP 1 / MP THP 2 (+ variants): the subject list is
        // whatever the sheet has — renamed, added or blank rows and all —
        // so every subject becomes an editable `custom-<id>` matrix row
        // (getCustomMatrixRowIds), in sheet order, rather than being
        // matched against the fixed catalog list. The column labels are
        // still the fixed catalog ones (PRA PPKI/PPKI/PRASEKOLAH, TAHUN N).
        const qtyByColThenName = new Map();
        section.classes.forEach((cls) => {
          const column = cls.namaKelas || cls.tahunFrom;
          if (!column) return;
          const byName = qtyByColThenName.get(column) || new Map();
          cls.subjects.forEach(({ name, qty }) => { if (name) byName.set(name, qty); });
          qtyByColThenName.set(column, byName);
        });
        importedRowIdByName = new Map();
        section.subjectOrder.forEach((name) => {
          if (!name) return;
          const rowId = nextRowId++;
          if (!importedRowIdByName.has(name)) importedRowIdByName.set(name, rowId);
          newMatrixValues[customMatrixLabelKey(catKey, rowId)] = name;
          qtyByColThenName.forEach((byName, column) => {
            const qty = byName.get(name);
            if (qty) newMatrixValues[matrixCellKey(catKey, `custom-${rowId}`, column)] = String(qty);
          });
        });
      } else {
        section.classes.forEach((cls) => {
          // PPKI's classes carry their level in `namaKelas` (PRA PPKI/PPKI/
          // PRASEKOLAH — free text, not a real TAHUN), MP THP 1's in
          // `tahunFrom` (TAHUN 1/2/3) — either way this must exactly match
          // one of the category's own fixed columnsByLanguage labels.
          const column = cls.namaKelas || cls.tahunFrom;
          if (!column) return;
          cls.subjects.forEach(({ name, qty }) => {
            if (!name || !qty) return;
            newMatrixValues[matrixCellKey(catKey, name, column)] = String(qty);
          });
        });
      }
      // PPKI's own Nama Kelas + Moral Kelas breakdown behind those KUANTITI
      // totals (catalog.js's hasLevelBreakdown, excelImport.js's
      // parsePpkiSheet) — stored per level under its own composite
      // rowsByBlock key so computeBlocks.js/draftUpdaters.js can show and
      // re-sum it independently of the other levels.
      if (cat.hasLevelBreakdown && section.levelBreakdown) {
        section.levelBreakdown.forEach(({ label, mainRows, moralRows }) => {
          newRowsByBlock[`${key}::${label}::main`] = mainRows.map((r) => ({ id: nextRowId++, desc: r.name, qty: String(r.qty) }));
          newRowsByBlock[`${key}::${label}::moral`] = moralRows.map((r) => ({ id: nextRowId++, desc: r.name, qty: String(r.qty) }));
        });
        if (section.kelasSubject) newLineValues[`${key}::kelasSubject`] = section.kelasSubject;

        // A subject whose imported KUANTITI for a level doesn't match that
        // level's own Nama Kelas breakdown total (every subject offered at
        // a level takes that same total — see importChecks.js) becomes a
        // `type:'choice'` question on Step 2. "Betulkan" writes the level
        // total straight into that one cell; "Betul" just acknowledges.
        checkLevelBreakdownMatch(section).forEach((iss) => {
          const rowId = importedRowIdByName ? importedRowIdByName.get(iss.subject) : null;
          const fixPatches = rowId != null
            ? [{ mkey: matrixCellKey(catKey, `custom-${rowId}`, iss.level), value: String(iss.expected) }]
            : [];
          const options = [];
          if (fixPatches.length > 0) {
            options.push({ key: 'fix', label: `Salah taip — betulkan jadi ${iss.expected}` });
          }
          options.push({ key: 'keep', label: 'Betul — memang lain, biar macam ni' });
          warnings.push({
            type: 'choice',
            id: `${catKey}::${iss.id}`,
            blockIdx: 0,
            catKey,
            text: `${cat.label} · ${iss.subject} — ${iss.level}: awak isi ${iss.qty}, tapi ikut senarai Nama Kelas ${iss.level} (${iss.classCount} kelas) sepatutnya ${iss.expected}.`,
            options,
            addPatches: fixPatches,
          });
        });
      }
      const sectionLines = section.skipLineDerivation ? section.lines : deriveKlasMatrixSectionLines(section);
      Object.entries(sectionLines).forEach(([slot, val]) => { newLineValues[`${key}::${slot}`] = val; });

      let nextPlakRowId = next[fields.nextPlakRowId];
      let newPlakRows;
      if (section.isSimpleTahunList || section.isTokohList || section.isSelempangList || section.isUmumList) {
        // LONJAKAN / TOKOH — Jenis Plak lives per row (plakPerRow); SELEMPANG
        // has one implicit shared code. Either way, no block-level plak row.
        newPlakRows = { ...next[fields.plakRows], [key]: [] };
      } else if (section.isAliran || section.isAliranKelas) {
        // One plak row per JENIS PLAK footer entry, each carrying its own
        // position range (posDari/posHingga). QTY per row is derived later
        // (computeBlocks.js) UNLESS the sheet typed its own — then that's
        // carried as an override. An un-matched code is left blank and
        // flagged, same as everywhere else.
        // The sheet's own footer QTY is only pinned as an override when it
        // DIFFERS from what the position-range × ranked-TAHUNs math derives
        // — a matching number stays null (reactive) so later TAHUN edits
        // still reflow it. `flatTotal` covers a rangeless (flat) footer row.
        const flatTotal = (section.tahunRows || []).reduce((s, tr) => s + (tr.hingga ? 0 : (tr.flatQty || 0)), 0);
        const derivedFor = (dari, hingga) => {
          if (!dari) return flatTotal;
          return (section.tahunRows || []).reduce((s, tr) => (
            s + (tr.hingga ? Math.max(0, Math.min(hingga || dari, tr.hingga) - dari + 1) : 0)
          ), 0);
        };
        const aliranRows = (section.plakRanges || []).map((pr) => {
          // Un-matched → blank, picked here; flagged by buildCategoryCartItems.
          const matched = matchPlakOrWarn(pr.jenisPlak, catKey, cat.label);
          // "Kalau ada kelas" footer QTY is always derived (Nama Kelas ×
          // range), never a teacher override — the sheet's own number, if
          // any, is just the school's arithmetic, not a real override.
          const override = !section.isAliranKelas && pr.qty && pr.qty !== derivedFor(pr.dari || null, pr.hingga || null) ? pr.qty : null;
          return { id: nextPlakRowId++, jenisPlak: matched, posDari: pr.dari || null, posHingga: pr.hingga || null, qty: override };
        });
        // Any TAHUN with no KEDUDUKAN (a flat "ikut sample" count) needs
        // its own Jenis Plak row with no position range — seed a blank one
        // if the sheet didn't already give a rangeless footer entry, so the
        // teacher just has to pick the plak instead of remembering to add
        // the row (its qty derives from those flat TAHUNs' totals). For
        // "Kalau ada kelas" a flat TAHUN is one with a Nama Kelas list but
        // no KEDUDUKAN range.
        const rangedTahuns = new Set((section.tahunRows || []).filter((tr) => tr.hingga).map((tr) => tr.tahun));
        const hasFlatTahun = (section.tahunRows || []).some((tr) => !tr.hingga && (tr.flatQty || 0) > 0)
          || (section.isAliranKelas && (section.levelBreakdown || []).some((lb) => lb.mainRows.length > 0 && !rangedTahuns.has(lb.label)));
        const hasRangelessRow = aliranRows.some((r) => !r.posDari);
        if (hasFlatTahun && !hasRangelessRow) {
          aliranRows.push({ id: nextPlakRowId++, jenisPlak: '', posDari: null, posHingga: null, qty: null });
        }
        if (aliranRows.length === 0) aliranRows.push({ id: nextPlakRowId++, jenisPlak: '', posDari: 1, posHingga: null, qty: null });
        newPlakRows = { ...next[fields.plakRows], [key]: aliranRows };
      } else {
        // Un-matched → blank, picked here; flagged by buildCategoryCartItems.
        const matchedPlak = matchPlakOrWarn(section.jenisPlak, catKey, cat.label);
        newPlakRows = { ...next[fields.plakRows], [key]: [{ id: nextPlakRowId++, jenisPlak: matchedPlak }] };
      }
      if (applyFilter) applyFilter(catKey, key, { newLineValues, newMatrixValues, newRowsByBlock, newPlakRows });
      next = {
        ...next,
        [fields.lineValues]: newLineValues, [fields.matrixValues]: newMatrixValues, [fields.rowsByBlock]: newRowsByBlock, [fields.plakRows]: newPlakRows,
        [fields.nextPlakRowId]: nextPlakRowId, [fields.nextRowId]: nextRowId,
        // Every category here is single-block, so nothing else ever needs
        // to read visibleBlocksByCategory for a FIXED key (a static
        // ACTIVE_CATEGORIES tab is always shown regardless). A dynamic
        // key has no such standing tab — this is the only signal
        // NewOrderStep2.jsx/AddOn.jsx have that it now exists in the
        // draft, so it's set only for those.
        ...(isDynamicCategoryKey(catKey) ? { [fields.visibleBlocksByCategory]: { ...next[fields.visibleBlocksByCategory], [catKey]: 1 } } : {}),
      };
      if (!landOn) landOn = catKey;
      messages.push(`${cat.label}: imported`);
    });
  }

  // A sheet that had something typed into it but matched no recognized
  // format at all (excelImport.js's unrecognizedSheets) — surfaced so the
  // teacher/production knows to check it by hand, instead of that data
  // silently not appearing anywhere.
  // Anything a Word order table had that docxImport.js couldn't place with
  // certainty (an unreadable quantity, a row with no wording, a JUMLAH
  // that disagrees) — shown for the teacher to check, never guessed.
  if (parsed.notes?.length) {
    parsed.notes.forEach((text) => warnings.push({ type: 'truncated', text }));
  }
  if (parsed.unrecognizedSheets?.length) {
    parsed.unrecognizedSheets.forEach((name) => {
      warnings.push({ type: 'truncated', text: `Couldn't recognize the format of sheet "${name}" — please check it and add its data by hand if needed.` });
    });
  }

  // A KIV line (excelImport.js's findKivNotes) has no recipient data at
  // all yet, so it never becomes a KLAS_MATRIX section the teacher could
  // review — it only reaches Sales/Invoicing/Production at all if it
  // lands somewhere they actually look. Appended (never replacing)
  // whatever Remark text is already there, so a fresh import can't wipe
  // out a note the teacher already typed by hand.
  if (parsed.kivNotes?.length) {
    parsed.kivNotes.forEach((n) => remarkNotes.push(`${n.desc}${n.qty ? ` — ${n.qty} ORANG` : ''} — KIV (belum ada nama, jangan cetak buat masa ini)`));
  }
  // FRONT PG's header (excelImport.js readFrontPgInfo) → Function Details
  // (Sean, 2026-10-03): a blank field is filled; one that already says
  // something else becomes a question (Step 2's "Confirm before
  // continuing" — each option carries what to write, so "change" undoes
  // it). Its REMARK goes into the Remark like the notes below.
  if (fields.functionDetails && parsed.frontPg) {
    const fp = frontPgToFunctionDetails(parsed.frontPg, next, malaysiaToday());
    next = { ...next, ...fp.patch };
    if (fp.remark) remarkNotes.unshift(fp.remark);
    fp.notes.forEach((text) => warnings.push({ type: 'truncated', text }));
    fp.questions.forEach((q) => warnings.push({
      type: 'choice', id: `frontpg-${q.id}`, addPatches: [],
      text: `${q.label}: the Excel's FRONT PG says "${q.excel.text}", but Function Details says "${q.current.text}". Which one is right?`,
      options: [
        { key: 'excel', label: `Use the Excel: ${q.excel.text}`, fieldPatch: q.excel.patch },
        { key: 'website', label: `Keep: ${q.current.text}`, fieldPatch: q.current.patch },
      ],
    }));
  }
  // No AddOn-side equivalent (fields.remark undefined there) — AddOn
  // uploads simply don't surface KIV/PERASMI notes anywhere, rather than
  // building new addOnRemark plumbing nothing else in that flow reads.
  // A note the Remark already says (a FORM ANUGERAH downloaded from this
  // page and uploaded again carries the Remark in FRONT PG) isn't added
  // twice.
  const haveRemark = fields.remark ? String(next[fields.remark] || '').toUpperCase() : '';
  const newNotes = remarkNotes.filter((n) => !haveRemark.includes(String(n).trim().toUpperCase()));
  if (fields.remark && newNotes.length > 0) {
    next = { ...next, [fields.remark]: next[fields.remark] ? `${next[fields.remark]}\n${newNotes.join('\n')}` : newNotes.join('\n') };
    messages.push(`${newNotes.length} note(s) added to Remark`);
  }

  const finalState = { ...next, [fields.category]: landOn || next[fields.category] };

  // Sheets the rule-based reader skipped, and the tabs this file filled
  const skippedSheets = [...new Set([
    ...(parsed.unrecognizedSheets || []),
    ...(!klasMatrixActive && parsed.klasMatrix ? parsed.klasMatrix.sections.map((sec) => sec.sourceSheet).filter(Boolean) : []),
  ])];
  const categories = [
    ...(parsed.klasMatrix && klasMatrixActive ? ['KLAS_MATRIX'] : []),
    ...Object.entries(parsed.categorized || {}).filter(([k, secs]) => resolveCategory(k) && secs?.length).map(([k]) => k),
  ];
  return { finalState, messages, warnings, skippedSheets, categories, parsed };
}
