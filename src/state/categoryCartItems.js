import { resolveCategory, SELEMPANG_CODE, isCustomPlakCode } from '../data/catalog';
import { computeBlocks, snapshotDetail, noopUpdaters } from '../utils/computeBlocks';
import { buildCsvRows } from '../utils/exportCsv';
import { hasStudentName, takesNameSurcharge, NAME_SURCHARGE } from '../utils/studentName';

// Turns one category's live draft (lineValues / matrixValues / rowsByBlock
// / plakRows / columnsByBlock on `st`) into the cart items it would add,
// OR the first blocking problem it hit. Shared by:
//   * AppState's addToCart / addAllToCart (the actual "Add" action), and
//   * NewOrderStep2's up-front readiness banner (same check, run for every
//     category at once so the teacher sees all the gaps together instead
//     of one toast at a time).
//
// Returns { engaged, error?, items? }:
//   engaged  — has this category been touched at all (a qty, a line, a plak)
//   error    — a human message if it's engaged but not ready (missing Jenis
//              Plak, a total that doesn't add up, a required line blank, …)
//   items    — the cart items, when there's no error
// `{ lenient: true }` (the FORM ANUGERAH download, draftForm.js): no
// readiness checks, and a row or block with a quantity but no Jenis Plak
// still becomes an item (jenisPlak ''), so the form can be downloaded,
// finished in Excel and uploaded again (Sean, 2026-10-17).
// `{ allowTypos: true }` (Production's corrected Excel): a possible-typo hint
// doesn't block — a student's name ("HANI", "AINA") isn't a typo, and
// blocking dropped the whole category back to the order's old details
// (ORD-0065, Sean 2026-10-20).
export function buildCategoryCartItems(st, catKey, { lenient = false, allowTypos = false } = {}) {
  const { blocks, isMatrix, isDynamicMatrix } = computeBlocks(
    catKey, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.columnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage,
  );
  const cat = resolveCategory(catKey);
  let engaged = false;

  // Catches the ways a category can be left half-finished — a reference
  // line, the qty table, or the Jenis Plak forgotten — before it's silently
  // either dropped or added without the info Production needs. Checked
  // across every block (OTHERS can have up to 6, one per Tahun — see
  // catalog.js's blocksCount), but only fires once a given block has
  // actually been touched (any line typed, any qty entered, or a Jenis Plak
  // chosen); an untouched block (every category but OTHERS only ever has
  // one) is just skipped.
  // SELEMPANG — its own tiny shape (ACARA/WARNA/KUANTITI rows, one shared
  // Jenis Plak). Handled here up front so the generic Reference Sample /
  // Jenis Plak checks below don't apply to it.
  if (cat?.selempang) {
    const blk = blocks[0];
    const filled = (blk.rows || []).filter((r) => (r.acara || '').trim() || (r.warna || '').trim() || Number(r.qty) > 0);
    if (filled.length === 0) return { engaged: false };
    for (const r of filled) {
      if (!(r.acara || '').trim()) return { engaged: true, error: 'Isi ACARA untuk setiap baris selempang sebelum masuk troli.' };
      if (!r.warnaResolved) return { engaged: true, error: `Warna selempang "${r.warna || '(kosong)'}" tak dikenali — guna BIRU / HIJAU / KUNING / MERAH atau kod 0050–0053.` };
      if (!(Number(r.qty) > 0)) return { engaged: true, error: `Isi kuantiti untuk selempang "${r.acara}" sebelum masuk troli.` };
    }
    const totalQty = filled.reduce((s, r) => s + Number(r.qty), 0);
    const unitPrice = blk.selempangUnitPrice;
    return {
      engaged: true,
      items: [{
        id: crypto.randomUUID(),
        jenisPlak: SELEMPANG_CODE,
        qty: totalQty,
        unitPrice,
        harga: unitPrice * totalQty,
        categoryLabel: cat.label,
        categoryKey: cat.key,
        blockIdx: blk.idx,
        detail: {
          rows: filled.map((r) => ({
            id: r.id, acara: r.acara.trim(), warna: r.warnaResolved.warna,
            warnaCode: r.warnaResolved.code, qty: String(r.qty),
          })),
        },
      }],
    };
  }

  for (const blk of blocks) {
    const lineHasValue = (line) => Boolean(String(line.value).trim());
    // A category marks the lines it needs (`line.required` — see
    // computeBlocks.js's requiredLineIndices; TAJUK BESAR may be blank) —
    // everything else (year, ACARA, position
    // CONTOH, etc.) is reference-sample context the teacher may not
    // always have yet, so it can stay blank.
    const hasQty = blk.blockTotalQty > 0;
    const hasJenisPlak = blk.plakPerRow
      ? blk.rows.some((r) => r.jenisPlak && Number(r.qty) > 0)
      : blk.plakRows.some((pr) => pr.jenisPlak);
    const blkEngaged = hasQty || hasJenisPlak || blk.lines.some(lineHasValue);
    if (!blkEngaged) continue;
    engaged = true;
    if (lenient) continue;
    // hasNamaKelasList categories (OTHERS) can have several blocks
    // sharing the same qtyLabel — the Kuantiti TAHUN value, when set,
    // is included too so the message says which Tahun part has
    // the problem instead of just repeating the category name.
    // qtyLabel is blank on hideQtyLabelSuffix categories (UMUM, TOKOH …) —
    // the category's own name then.
    const baseLabel = blk.qtyLabel || cat?.label || catKey;
    const blockLabel = blk.tahun?.value ? `${baseLabel} (${blk.tahun.value})` : baseLabel;
    const incompleteLine = blk.lines.find((line) => line.required && !lineHasValue(line));
    if (incompleteLine) {
      return { engaged, error: `Please fill in line ${incompleteLine.num} for ${blockLabel} before adding to cart.` };
    }
    // Same "possible typo" hint shown on screen (src/utils/typoCheck.js) —
    // now blocking, not just a nudge. findPossibleTypo only flags a word
    // that's a near-miss (edit distance 1) of a known dictionary word, so
    // a legitimate word it's never seen (a school's own event name, a
    // person's name) never trips this — only fixing the actual typo clears it.
    const typoLine = blk.lines.find((line) => line.typoHint) || (blk.rows || []).find((row) => row.typoHint);
    if (typoLine && !allowTypos) {
      return { engaged, error: `Possible typo in ${blockLabel}: "${typoLine.typoHint.word}" — or "${typoLine.typoHint.suggestion}"? Pick the right one under the word before adding to cart.` };
    }
    if (!hasQty) {
      return { engaged, error: `Please enter a quantity for ${blockLabel} before adding to cart.` };
    }
    if (!hasJenisPlak) {
      return { engaged, error: `Please choose a Jenis Plak for ${blockLabel} before adding to cart.` };
    }
    // plakPerRow (TOKOH / LONJAKAN): "some row has a Jenis Plak" isn't
    // enough — every row with a quantity needs its own. Names the rows
    // still missing it (an import's "couldn't match Jenis Plak" ends up
    // here too, once the auto-match failed and left the row blank).
    if (blk.plakPerRow) {
      const missing = blk.rows.filter((r) => Number(r.qty) > 0 && !r.jenisPlak).map((r) => r.desc || 'a row');
      if (missing.length) {
        return { engaged, error: `Choose a Jenis Plak for ${missing.join(', ')} in ${blockLabel} before adding to cart.` };
      }
    }
    // "OTHER - …" has no website price — it needs its own (typed with it,
    // or the sheet's HARGA PER UNIT).
    const unpricedOther = [...(blk.plakPerRow ? blk.rows : blk.plakRows)]
      .find((r) => isCustomPlakCode(r.jenisPlak) && r.unitPrice == null);
    if (unpricedOther) {
      return { engaged, error: `"${unpricedOther.jenisPlak}" in ${blockLabel} has no price — pick it again and fill in its Harga before adding to cart.` };
    }
    // ALIRAN TERBAIK: every plaque the Tahun table asks for must be covered
    // by a Jenis Plak footer row. The footer QTY can be derived or a
    // teacher override (computeBlocks.js) — either way its sum has to equal
    // the Tahun total, and no footer row can carry a QTY with no plak
    // picked. Same check as the on-screen red warning, but blocking here.
    if (blk.aliranKedudukan) {
      const plakTotal = blk.plakRows.reduce((s, pr) => s + (Number(pr.qty) || 0), 0);
      if (blk.plakRows.some((pr) => (Number(pr.qty) || 0) > 0 && !pr.jenisPlak)) {
        return { engaged, error: `A Jenis Plak row for ${blockLabel} has a quantity but no Jenis Plak selected — choose one or clear its quantity.` };
      }
      if (plakTotal !== blk.blockTotalQty) {
        const diff = blk.blockTotalQty - plakTotal;
        return { engaged, error: `Jenis Plak total (${plakTotal}) doesn't match the Tahun total (${blk.blockTotalQty}) for ${blockLabel} — ${diff > 0 ? `${diff} plaque(s) still have no Jenis Plak` : `${-diff} plaque(s) too many`}. Fix it before adding to cart.` };
      }
    }
    // A Tahun range spanning N years needs at least N medals per
    // subject (one per year) — a qty below that would silently lose
    // years when exportCsv.js splits it back out per-year.
    if (isDynamicMatrix) {
      const shortRow = blk.matrixRows.find((row) => row.cells.some((cell) => {
        const qty = Number(cell.value) || 0;
        return qty > 0 && qty < row.minQty;
      }));
      if (shortRow) {
        const rangeLabel = shortRow.tahunTo && shortRow.tahunTo !== shortRow.tahunFrom
          ? `${shortRow.tahunFrom} – ${shortRow.tahunTo}` : shortRow.tahunFrom;
        return { engaged, error: `${rangeLabel} ${shortRow.namaKelas} covers ${shortRow.minQty} year(s) — enter at least ${shortRow.minQty} for any subject you fill in.` };
      }
    }
    // OTHERS (`hasNamaKelasList`): each Description row's QTY is meant to
    // equal how many Nama Kelas are filled in (one plaque per class) —
    // a mismatch usually means the teacher forgot to update one side
    // after editing the other.
    if (blk.hasNamaKelasList) {
      const mismatchRow = blk.rows.find((row) => row.qtyMismatch);
      if (mismatchRow) {
        return { engaged, error: `${mismatchRow.desc || 'Description'} has QTY ${mismatchRow.qty}, but ${blk.namaKelasCount} Nama Kelas filled in for ${blockLabel} — please make them match.` };
      }
    }
  }

  const newItems = [];
  blocks.forEach((b) => {
    const baseDetail = snapshotDetail(catKey, b.idx, isMatrix, isDynamicMatrix, st.lineValues, st.matrixValues, st.rowsByBlock, st.columnsByBlock);
    if (cat?.plakPerRow) {
      // LONJAKAN / TOKOH — one item per row, each with its own Jenis Plak;
      // the item's detail carries only that row so exportCsv emits just
      // its own plaques.
      b.rows.forEach((row) => {
        if (row.jenisPlak ? row.qty : lenient && Number(row.qty) > 0) {
          const tokoh = {};
          (row.tokohFields || []).forEach((f) => { if (f.value) tokoh[f.key] = f.value; });
          newItems.push({
            id: crypto.randomUUID(), jenisPlak: row.jenisPlak || '', qty: row.qty, harga: row.rawHarga, unitPrice: row.unitPrice,
            // cat.label (not b.qtyLabel) — qtyLabel is blank for every
            // hideQtyLabelSuffix category (ALIRAN/LONJAKAN/KEHADIRAN/
            // TOKOH_SHEET/SELEMPANG, catalog.js) since that flag is meant
            // to drop the "Kuantiti — X" heading's OWN suffix, not to blank
            // the item's stored category identity — this field is what
            // PriceTable's Category column (and anything else reading
            // item.categoryLabel directly, not re-resolving the category)
            // actually displays.
            categoryLabel: cat?.label || b.qtyLabel, categoryKey: catKey, blockIdx: b.idx,
            // jenisPlak + unitPrice must travel with the row snapshot too,
            // not just the item's own top-level fields above — every
            // read-only view (Order Details, print, Store Admin, Production)
            // rebuilds its rows from `detail.rows` (reconstructBlocksForCategory
            // -> mergeItemDetailIntoMaps), not from the item fields directly.
            // Without them a row reconstructed this way shows "—" for Jenis
            // Plak and RM 0.00 for Harga even though the order's own
            // total/CSV were always correct (those read the item fields).
            // unitPrice (not just jenisPlak) is snapshotted so a later
            // catalog price change can't make a past order's printout show
            // a different price than what was actually charged.
            detail: { ...baseDetail, rows: [{ id: row.id, desc: row.desc, qty: row.qty, jenisPlak: row.jenisPlak, unitPrice: row.unitPrice, ...tokoh }] },
          });
        }
      });
      return;
    }
    // lenient: a footer row with a quantity but no Jenis Plak goes in with a
    // blank code. Every footer row but ALIRAN's is the whole block's total,
    // so a blank one counts only when none has a Jenis Plak yet; with no
    // footer row at all, the whole block goes in as one.
    let plakRows = b.plakRows;
    const coded = plakRows.some((pr) => pr.jenisPlak && Number(pr.qty) > 0);
    if (lenient && !coded && !plakRows.some((pr) => Number(pr.qty) > 0) && b.blockTotalQty > 0) {
      plakRows = [{ id: `${catKey}::${b.idx}::noplak`, jenisPlak: '', qty: b.blockTotalQty }];
    }
    const blankCounts = lenient && (b.aliranKedudukan || !coded);
    plakRows.forEach((pr) => {
      if (pr.jenisPlak ? pr.qty : blankCounts && Number(pr.qty) > 0) newItems.push({
        id: crypto.randomUUID(), jenisPlak: pr.jenisPlak || '', qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice,
        // See the plakPerRow branch above for why this is cat.label, not b.qtyLabel.
        categoryLabel: cat?.label || b.qtyLabel, categoryKey: catKey, blockIdx: b.idx,
        // ALIRAN — which places (1st..Nth) this plak covers, so
        // exportCsv can engrave one plaque per (Tahun, place).
        ...(pr.posDari ? { posDari: pr.posDari, posHingga: pr.posHingga } : {}),
        detail: baseDetail,
      });
    });
  });
  return { engaged, items: newItems.map((it) => withNameSurcharge(it, catKey, st.schoolLanguage)) };
}

// Every plaque of the item engraved with a student's name: the catalog price
// + RM1 (studentName.js) — not a crystal or VB. An item mixing named and unnamed plaques keeps its
// price — TOKOH / ORDER LAIN-LAIN are an item per row, so theirs never mix.
function withNameSurcharge(item, catKey, schoolLanguage) {
  if (item.unitPrice == null || !item.jenisPlak || !takesNameSurcharge(item.jenisPlak)) return item;
  const { rows } = buildCsvRows({ schoolLanguage, items: [item] }, catKey, [item]);
  if (!rows.length || !rows.every((r) => hasStudentName(r.slice(0, 5).join('\n')))) return item;
  const unitPrice = Number(item.unitPrice) + NAME_SURCHARGE;
  const detailRows = item.detail?.rows;
  return {
    ...item, unitPrice, harga: unitPrice * (Number(item.qty) || 0), nameSurcharge: NAME_SURCHARGE,
    ...(detailRows?.length === 1 ? { detail: { ...item.detail, rows: [{ ...detailRows[0], unitPrice }] } } : {}),
  };
}
