import { CATEGORIES, SELEMPANG_CODE } from '../data/catalog';
import { computeBlocks, snapshotDetail, noopUpdaters } from '../utils/computeBlocks';

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
export function buildCategoryCartItems(st, catKey) {
  const { blocks, isMatrix, isDynamicMatrix } = computeBlocks(
    catKey, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.columnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage,
  );
  const cat = CATEGORIES.find((c) => c.key === catKey);
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
    // Line 1 (the event name) is always required; a category can mark
    // extra lines required too (`line.required` — see computeBlocks.js's
    // requiredLineIndices) — everything else (year, ACARA, position
    // CONTOH, etc.) is reference-sample context the teacher may not
    // always have yet, so it can stay blank.
    const hasQty = blk.blockTotalQty > 0;
    const hasJenisPlak = blk.plakPerRow
      ? blk.rows.some((r) => r.jenisPlak && Number(r.qty) > 0)
      : blk.plakRows.some((pr) => pr.jenisPlak);
    const blkEngaged = hasQty || hasJenisPlak || blk.lines.some(lineHasValue);
    if (!blkEngaged) continue;
    engaged = true;
    // hasNamaKelasList categories (OTHERS) can have several blocks
    // sharing the same qtyLabel — the Kuantiti TAHUN value, when set,
    // is included too so the message says which Tahun part has
    // the problem instead of just repeating the category name.
    const blockLabel = blk.tahun?.value ? `${blk.qtyLabel} (${blk.tahun.value})` : blk.qtyLabel;
    const incompleteLine = blk.lines.find((line) => line.required && !lineHasValue(line));
    if (incompleteLine) {
      return { engaged, error: `Please fill in line ${incompleteLine.num} for ${blockLabel} before adding to cart.` };
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
        if (row.jenisPlak && row.qty) {
          const tokoh = {};
          (row.tokohFields || []).forEach((f) => { if (f.value) tokoh[f.key] = f.value; });
          newItems.push({
            id: crypto.randomUUID(), jenisPlak: row.jenisPlak, qty: row.qty, harga: row.rawHarga, unitPrice: row.unitPrice,
            categoryLabel: b.qtyLabel, categoryKey: catKey, blockIdx: b.idx,
            detail: { ...baseDetail, rows: [{ id: row.id, desc: row.desc, qty: row.qty, ...tokoh }] },
          });
        }
      });
      return;
    }
    b.plakRows.forEach((pr) => {
      if (pr.jenisPlak && pr.qty) newItems.push({
        id: crypto.randomUUID(), jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice,
        categoryLabel: b.qtyLabel, categoryKey: catKey, blockIdx: b.idx,
        // ALIRAN — which places (1st..Nth) this plak covers, so
        // exportCsv can engrave one plaque per (Tahun, place).
        ...(pr.posDari ? { posDari: pr.posDari, posHingga: pr.posHingga } : {}),
        detail: baseDetail,
      });
    });
  });
  return { engaged, items: newItems };
}
