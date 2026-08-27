import {
  CATEGORIES, customMatrixLabelKey, getCategoryLinePlaceholders, getCategoryPositionLine2Placeholder,
} from '../data/catalog';

// Reference Sample's base line count (catalog lines + optional second box),
// resolved the same way computeBlocks.js does — length is identical across
// schoolLanguage variants (only the wording differs), so 'SK' is fine to use
// here purely for counting.
function baseReferenceLineCount(cat) {
  return getCategoryLinePlaceholders(cat, 'SK').length + (getCategoryPositionLine2Placeholder(cat, 'SK') ? 1 : 0);
}

// Builds the block-editing callbacks (onLine, onMatrix, onRowField, ...) for
// a given "draft" namespace inside global state — the same set of fields is
// duplicated twice in state (main New Order draft, Add On draft), so this
// factory avoids writing the wiring twice.
export function createDraftUpdaters(patch, fields) {
  const {
    lineValues, matrixValues, rowsByBlock, plakRows, columnsByBlock,
    nextRowId, nextColumnId, visibleBlocksByCategory,
  } = fields;

  return {
    // Reference Sample fields (hasNamaKelasList categories — OTHERS) are
    // only ever shown/edited on block 0 (see OrderCategoryBlock.jsx's
    // showSharedSections), but every duplicated block needs its own copy
    // for its own export/validation. onDuplicateBlock below only copies
    // ONCE, at the moment "Duplicate" is clicked — editing block 0's
    // Reference Sample afterward (a very normal thing to do, e.g. filling
    // it in only after duplicating) would otherwise leave every
    // already-duplicated block holding a stale, blank copy, silently
    // failing that block's own required-line check with an error that
    // doesn't explain which block's copy is stale. Keep every revealed
    // block's copy in sync going forward instead — the Kuantiti TAHUN
    // value (`::tahun`) is deliberately excluded since that's genuinely
    // per-block, not shared.
    onLine: (key, val) => patch((st) => {
      const newLineValues = { ...st[lineValues], [key]: val };
      const match = /^(.+)::0::(.+)$/.exec(key);
      if (match) {
        const [, catKey, fieldKey] = match;
        const cat = CATEGORIES.find((c) => c.key === catKey);
        if (cat?.hasNamaKelasList && fieldKey !== 'tahun') {
          const visibleCount = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
          for (let b = 1; b < visibleCount; b++) {
            newLineValues[`${catKey}::${b}::${fieldKey}`] = val;
          }
        }
      }
      return { [lineValues]: newLineValues };
    }),
    onMatrix: (key, val) => patch((st) => ({ [matrixValues]: { ...st[matrixValues], [key]: val } })),
    onRowField: (rowsKey, id, field, val) => patch((st) => ({
      [rowsByBlock]: {
        ...st[rowsByBlock],
        [rowsKey]: st[rowsByBlock][rowsKey].map((r) => (r.id === id ? { ...r, [field]: val } : r)),
      },
    })),
    onRowRemove: (rowsKey, id) => patch((st) => ({
      [rowsByBlock]: { ...st[rowsByBlock], [rowsKey]: st[rowsByBlock][rowsKey].filter((r) => r.id !== id) },
    })),
    // `custom: true` marks a row added by the teacher rather than seeded by
    // default (e.g. PBD's fixed 13 subjects) — OrderCategoryBlock only lets
    // custom rows be renamed/removed. Harmless for plain list categories
    // (LONJAKAN/OTHERS), which don't look at `custom` at all.
    //
    // Main Template (TOKOH, catalog.js's capRowsAt5/defaultRowDescFromPosition)
    // caps Kuantiti at 5 rows total — mirroring Reference Sample's own
    // 5-row cap — and seeds each newly-added row's Description as "Row N"
    // (N = its own 1-based position) so it visually lines up with the
    // correspondingly-numbered Reference Sample row; still a normal
    // editable text field, so the teacher can overwrite it. The cap is
    // enforced here (not just by hiding the button) so it holds regardless
    // of how the action is triggered.
    onAddRow: (rowsKey) => patch((st) => {
      const existing = st[rowsByBlock][rowsKey] || [];
      const catKey = (/^(.+)::\d+$/.exec(rowsKey) || [])[1];
      const cat = CATEGORIES.find((c) => c.key === catKey);
      if (cat?.capRowsAt5 && existing.length >= 5) return {};
      const desc = cat?.defaultRowDescFromPosition ? `Row ${existing.length + 1}` : '';
      return {
        [rowsByBlock]: {
          ...st[rowsByBlock],
          [rowsKey]: [...existing, { id: st[nextRowId], desc, qty: '', custom: true }],
        },
        [nextRowId]: st[nextRowId] + 1,
      };
    }),
    // "+ Add Description" (`hasNamaKelasList` categories only — OTHERS):
    // every Description row in a Tahun block is almost always the same QTY
    // (one plaque per class, same class list for every subject) — carrying
    // the previous row's QTY over, same idea as onAddColumnSameTahun below,
    // saves re-typing it for every subject and only leaves it blank if the
    // teacher hasn't filled one in yet.
    onAddRowSameQty: (rowsKey) => patch((st) => {
      const existing = st[rowsByBlock][rowsKey] || [];
      const last = existing[existing.length - 1];
      return {
        [rowsByBlock]: {
          ...st[rowsByBlock],
          [rowsKey]: [...existing, { id: st[nextRowId], desc: '', qty: last ? last.qty : '', custom: true }],
        },
        [nextRowId]: st[nextRowId] + 1,
      };
    }),
    // "+ Add Reference Row" — Main Template/Mata Pelajaran-Klas (catalog.js's
    // extendableReferenceSample). The count lives inside lineValues itself
    // as a synthetic `${catKey}::${blockIdx}::extraRefLines` entry (read by
    // computeBlocks.js when building that block's Reference Sample lines)
    // rather than a separate state field, so it rides along for free with
    // every mechanism that already snapshots/resets/reconstructs
    // lineValues by key prefix — no other call site needs to change.
    // Capped at `cat.maxReferenceLines` (falls back to 5) total VISIBLE
    // lines — a category with individually-deletable rows
    // (deletableReferenceLines) frees up room as rows are deleted, so
    // hidden ones don't count against the cap — enforced here rather than
    // only by hiding the button.
    onAddReferenceLine: (catKey, blockIdx) => patch((st) => {
      const cat = CATEGORIES.find((c) => c.key === catKey);
      if (!cat?.extendableReferenceSample) return {};
      const baseLen = baseReferenceLineCount(cat);
      const key = `${catKey}::${blockIdx}::extraRefLines`;
      const current = Number(st[lineValues][key]) || 0;
      const hiddenKey = `${catKey}::${blockIdx}::hiddenLines`;
      const hiddenCount = (st[lineValues][hiddenKey] || '').split(',').filter(Boolean).length;
      const maxLines = cat.maxReferenceLines || 5;
      if (baseLen + current - hiddenCount >= maxLines) return {};
      const newLineValues = { ...st[lineValues], [key]: String(current + 1) };
      // hasNamaKelasList categories (OTHERS) share ONE Reference Sample
      // across every duplicated Tahun block (same stale-copy problem onLine
      // solves above, since the "+Add Reference Row" button is only ever
      // shown on block 0) — keep every revealed block's own count in sync
      // so each block's own Kuantiti table shows the same "Row N" column.
      if (cat.hasNamaKelasList) {
        const visibleCount = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
        for (let b = 0; b < visibleCount; b++) {
          if (b !== blockIdx) newLineValues[`${catKey}::${b}::extraRefLines`] = String(current + 1);
        }
      }
      return { [lineValues]: newLineValues };
    }),
    // "Delete Reference Row" — the reverse of onAddReferenceLine: removes
    // the LAST added Reference Sample row and, in the same step, deletes
    // that row's matching Kuantiti column (`refCol{N}`, N = the row's own
    // 1-based number — see computeBlocks.js's extraRefColumns) from every
    // Kuantiti row in this block, so a later re-add doesn't resurrect
    // stale column data under a reused number.
    onRemoveReferenceLine: (catKey, blockIdx) => patch((st) => {
      const cat = CATEGORIES.find((c) => c.key === catKey);
      if (!cat?.extendableReferenceSample) return {};
      const origLen = getCategoryLinePlaceholders(cat, 'SK').length;
      const baseLen = baseReferenceLineCount(cat);
      const key = `${catKey}::${blockIdx}::extraRefLines`;
      const current = Number(st[lineValues][key]) || 0;
      if (current <= 0) return {};
      // The removed row's raw lineValues index sits right after the base
      // (non-second-box) placeholders, at origLen + (current - 1) — NOT
      // baseLen + current - 1, which double-counts the second box (2b isn't
      // its own entry in the placeholder array computeBlocks.js maps over,
      // it's injected separately as line 2's secondLine).
      const removedRawIdx = origLen + current - 1;
      const removedNum = baseLen + current;
      const refColKey = `refCol${removedNum}`;
      const newLineValues = { ...st[lineValues], [key]: String(current - 1) };
      delete newLineValues[`${catKey}::${blockIdx}::${removedRawIdx}`];
      const newRowsByBlock = { ...st[rowsByBlock] };
      const stripRefCol = (rowsKey) => {
        newRowsByBlock[rowsKey] = (newRowsByBlock[rowsKey] || []).map((r) => {
          if (!(refColKey in r)) return r;
          const next = { ...r };
          delete next[refColKey];
          return next;
        });
      };
      stripRefCol(`${catKey}::${blockIdx}`);
      // Same cross-block sync as onAddReferenceLine above — a shared
      // Reference Sample means every revealed block's Kuantiti table must
      // drop the same "Row N" column, not just the block the button lives on.
      if (cat.hasNamaKelasList) {
        const visibleCount = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
        for (let b = 0; b < visibleCount; b++) {
          if (b === blockIdx) continue;
          newLineValues[`${catKey}::${b}::extraRefLines`] = String(current - 1);
          delete newLineValues[`${catKey}::${b}::${removedRawIdx}`];
          stripRefCol(`${catKey}::${b}`);
        }
      }
      return { [lineValues]: newLineValues, [rowsByBlock]: newRowsByBlock };
    }),
    // "Delete row" ✕ — Mata Pelajaran/Klas only (catalog.js's
    // deletableReferenceLines). TAJUK BESAR (slotId '0') and the
    // SUBJEK/POSITION second box (slotId '2b') can never be deleted this way
    // (guarded here, not just by the UI omitting their ✕ button).
    //
    // Two different removals, depending on which kind of row it is:
    //  - A teacher-ADDED row (slotId's raw index falls in the
    //    extraRefLines-counted range): closes the gap by shifting every
    //    later extra row (and its matching Kuantiti `refCol` column) down
    //    one slot and shrinking the counter — so extras always stay
    //    contiguous and the next "+ Add Reference Row" lands on
    //    (current max shown + 1), instead of the counter just ticking up
    //    forever and leaving a permanently orphaned number behind.
    //  - A base catalog row (YEAR/ACARA/TAHUN) — simply hidden (kept as a
    //    comma-joined `${catKey}::${blockIdx}::hiddenLines` entry, the same
    //    "ride along inside lineValues" trick extraRefLines uses).
    //    computeBlocks.js filters it out of `lines` (dropping it from
    //    required-line validation for free) — it doesn't need shifting
    //    since extras are always numbered after every base row regardless
    //    of which base rows are currently hidden. Its own value is cleared
    //    too, so stale text can't leak into exportCsv.js (which reads
    //    lineValues by raw index regardless of what's currently shown).
    onDeleteReferenceLine: (catKey, blockIdx, slotId) => patch((st) => {
      const cat = CATEGORIES.find((c) => c.key === catKey);
      if (!cat?.deletableReferenceLines) return {};
      if (slotId === '0' || slotId === '2b') return {};
      const origLen = getCategoryLinePlaceholders(cat, 'SK').length;
      const baseLen = baseReferenceLineCount(cat);
      const slotIdx = Number(slotId);
      const extraKey = `${catKey}::${blockIdx}::extraRefLines`;
      const extraCount = Number(st[lineValues][extraKey]) || 0;

      if (Number.isInteger(slotIdx) && slotIdx >= origLen && slotIdx < origLen + extraCount) {
        const removedK = slotIdx - origLen;
        const applyToBlock = (bIdx, lv, rb) => {
          const values = Array.from({ length: extraCount }, (_, k) => lv[`${catKey}::${bIdx}::${origLen + k}`] || '');
          values.splice(removedK, 1);
          for (let k = 0; k < extraCount; k++) delete lv[`${catKey}::${bIdx}::${origLen + k}`];
          values.forEach((v, k) => { if (v) lv[`${catKey}::${bIdx}::${origLen + k}`] = v; });
          lv[`${catKey}::${bIdx}::extraRefLines`] = String(extraCount - 1);
          const rowsKeyName = `${catKey}::${bIdx}`;
          if (rb[rowsKeyName]) {
            rb[rowsKeyName] = rb[rowsKeyName].map((r) => {
              const cols = Array.from({ length: extraCount }, (_, k) => r[`refCol${baseLen + k + 1}`]);
              cols.splice(removedK, 1);
              const next = { ...r };
              for (let k = 0; k < extraCount; k++) delete next[`refCol${baseLen + k + 1}`];
              cols.forEach((v, k) => { if (v !== undefined) next[`refCol${baseLen + k + 1}`] = v; });
              return next;
            });
          }
        };
        const newLineValues = { ...st[lineValues] };
        const newRowsByBlock = { ...st[rowsByBlock] };
        applyToBlock(blockIdx, newLineValues, newRowsByBlock);
        if (cat.hasNamaKelasList) {
          const visibleCount = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
          for (let b = 0; b < visibleCount; b++) {
            if (b !== blockIdx) applyToBlock(b, newLineValues, newRowsByBlock);
          }
        }
        return { [lineValues]: newLineValues, [rowsByBlock]: newRowsByBlock };
      }

      const hiddenKey = `${catKey}::${blockIdx}::hiddenLines`;
      const hidden = new Set((st[lineValues][hiddenKey] || '').split(',').filter(Boolean));
      if (hidden.has(slotId)) return {};
      hidden.add(slotId);
      const hiddenList = Array.from(hidden).join(',');
      const newLineValues = { ...st[lineValues], [hiddenKey]: hiddenList };
      delete newLineValues[`${catKey}::${blockIdx}::${slotId}`];
      // Same cross-block sync onAddReferenceLine above uses — Mata
      // Pelajaran/Klas shares ONE Reference Sample across every revealed
      // Tahun block.
      if (cat.hasNamaKelasList) {
        const visibleCount = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
        for (let b = 0; b < visibleCount; b++) {
          if (b === blockIdx) continue;
          newLineValues[`${catKey}::${b}::hiddenLines`] = hiddenList;
          delete newLineValues[`${catKey}::${b}::${slotId}`];
        }
      }
      return { [lineValues]: newLineValues };
    }),
    // Jenis Plak — each Tahun block (`hasNamaKelasList` categories — OTHERS)
    // picks its own Jenis Plak independently (shown above its own Tahun
    // field, not a single shared table on block 0 any more). "Duplicate"
    // still copies the PREVIOUS block's choice forward as a starting point
    // (see onDuplicateBlock below), but editing it afterward only ever
    // touches this one block — no cross-block sync.
    onPlakSelect: (rowsKey, id, val) => patch((st) => ({
      [plakRows]: {
        ...st[plakRows],
        [rowsKey]: st[plakRows][rowsKey].map((r) => (r.id === id ? { ...r, jenisPlak: val } : r)),
      },
    })),
    // Columns (Tahun + Nama Kelas) — dynamicMatrix categories only (PBD).
    // "+ Add Tahun" — a genuinely new Tahun range, so both Tahun and Nama
    // Kelas start blank for the teacher to fill in. Also reused as-is for
    // `hasNamaKelasList` categories' Nama Kelas list (OTHERS) via
    // onAddNamaKelas below — this generic field-merge/remove pair doesn't
    // care which shape ({tahunFrom,tahunTo,namaKelas} vs {name}) lives in
    // the array.
    onColumnField: (colsKey, id, field, val) => patch((st) => ({
      [columnsByBlock]: {
        ...st[columnsByBlock],
        [colsKey]: st[columnsByBlock][colsKey].map((c) => (c.id === id ? { ...c, [field]: val } : c)),
      },
    })),
    onColumnRemove: (colsKey, id) => patch((st) => ({
      [columnsByBlock]: { ...st[columnsByBlock], [colsKey]: st[columnsByBlock][colsKey].filter((c) => c.id !== id) },
    })),
    onAddColumn: (colsKey) => patch((st) => ({
      [columnsByBlock]: {
        ...st[columnsByBlock],
        [colsKey]: [...(st[columnsByBlock][colsKey] || []), { id: st[nextColumnId], tahunFrom: '', tahunTo: '', namaKelas: '' }],
      },
      [nextColumnId]: st[nextColumnId] + 1,
    })),
    // "+ Add Kelas" — another class under the same Tahun range as the last
    // row, so Tahun carries over automatically and only Nama Kelas is left
    // blank for the teacher to fill in.
    onAddColumnSameTahun: (colsKey) => patch((st) => {
      const existing = st[columnsByBlock][colsKey] || [];
      const last = existing[existing.length - 1];
      return {
        [columnsByBlock]: {
          ...st[columnsByBlock],
          [colsKey]: [...existing, {
            id: st[nextColumnId],
            tahunFrom: last ? last.tahunFrom : '',
            tahunTo: last ? last.tahunTo : '',
            namaKelas: '',
          }],
        },
        [nextColumnId]: st[nextColumnId] + 1,
      };
    }),
    // "+ Add Nama Kelas" (`hasNamaKelasList` categories only — OTHERS): a
    // fresh, blank class-name entry — see onColumnField/onColumnRemove above
    // for editing/removing it.
    onAddNamaKelas: (colsKey) => patch((st) => ({
      [columnsByBlock]: {
        ...st[columnsByBlock],
        [colsKey]: [...(st[columnsByBlock][colsKey] || []), { id: st[nextColumnId], name: '' }],
      },
      [nextColumnId]: st[nextColumnId] + 1,
    })),
    // Matrix "+ Add Row" (see OrderCategoryBlock / getCustomMatrixRowIds in
    // src/data/catalog.js): a custom row's existence is just its
    // `__label__` key being present in matrixValues, so adding one is a
    // plain onMatrix write with a fresh id — no separate row-list state to
    // keep in sync. Removing deletes every key under that row's id
    // (label + every column cell) in one pass.
    onAddMatrixRow: (catKey) => patch((st) => ({
      [matrixValues]: { ...st[matrixValues], [customMatrixLabelKey(catKey, st[nextRowId])]: '' },
      [nextRowId]: st[nextRowId] + 1,
    })),
    onMatrixRowRemove: (catKey, rowId) => patch((st) => {
      const prefix = `${catKey}::custom-${rowId}::`;
      const next = { ...st[matrixValues] };
      Object.keys(next).forEach((k) => { if (k.startsWith(prefix)) delete next[k]; });
      return { [matrixValues]: next };
    }),
    // "Duplicate" (`hasNamaKelasList` categories only — OTHERS, see
    // catalog.js's blocksCount: 6 pre-allocating one slot per Malaysian
    // primary grade): clones every field of block `fromBlockIdx` — its
    // Reference Sample lines and Jenis Plak selection (needed so each
    // duplicated block's own cart item/CSV export still carries a real
    // event header/position/Jenis Plak, even though OrderCategoryBlock only
    // ever *displays* those two sections on the first block — they're
    // meant to apply to every Tahun part, not be re-entered each time) plus
    // its Kuantiti (TAHUN value, Description/QTY rows, Nama Kelas list) —
    // into the next block, then reveals that block (see NewOrderStep2/
    // AddOn's visible-block slicing). The teacher only needs to change
    // TAHUN afterward; editing Reference Sample/Jenis Plak again means
    // going back to the first block; changes there won't retroactively
    // reach already-duplicated blocks. IDs are carried over as-is rather
    // than reminted — each block's rowsByBlock/columnsByBlock entry is its
    // own independently-keyed array, so ids only ever need to be unique
    // within one block's own array, never across blocks.
    onDuplicateBlock: (catKey, fromBlockIdx) => patch((st) => {
      const cat = CATEGORIES.find((c) => c.key === catKey);
      const toBlockIdx = fromBlockIdx + 1;
      if (!cat || toBlockIdx >= (cat.blocksCount || 1)) return {};
      const fromLinePrefix = `${catKey}::${fromBlockIdx}::`;
      const toLinePrefix = `${catKey}::${toBlockIdx}::`;
      const newLineValues = { ...st[lineValues] };
      Object.keys(st[lineValues]).forEach((k) => {
        if (k.startsWith(fromLinePrefix)) newLineValues[`${toLinePrefix}${k.slice(fromLinePrefix.length)}`] = st[lineValues][k];
      });
      const fromKey = `${catKey}::${fromBlockIdx}`;
      const toKey = `${catKey}::${toBlockIdx}`;
      const newRowsByBlock = {
        ...st[rowsByBlock],
        [toKey]: JSON.parse(JSON.stringify(st[rowsByBlock][fromKey] || [])),
      };
      const newColumnsByBlock = {
        ...st[columnsByBlock],
        [toKey]: JSON.parse(JSON.stringify((st[columnsByBlock] && st[columnsByBlock][fromKey]) || [])),
      };
      // dynamicMatrix categories (KLAS_MATRIX, via multiBlock) keep each
      // cell's own qty in matrixValues (keyed by `${catKey}::${blockIdx}::
      // ${subjectRowId}::${classColId}`), a state field entirely separate
      // from rowsByBlock/columnsByBlock above — those two only carry the
      // subject/class DEFINITIONS. The deep-cloned copies keep every id
      // identical to the source block's own (JSON clone never remints
      // `id`), so each matrixValues entry can move straight across by
      // swapping just the blockIdx segment of its key, with no id remapping
      // needed.
      const newMatrixValues = { ...st[matrixValues] };
      Object.keys(st[matrixValues]).forEach((k) => {
        if (k.startsWith(fromLinePrefix)) newMatrixValues[`${toLinePrefix}${k.slice(fromLinePrefix.length)}`] = st[matrixValues][k];
      });
      const fromPlak = (st[plakRows][fromKey] || [])[0];
      const newPlakRows = {
        ...st[plakRows],
        [toKey]: (st[plakRows][toKey] || []).map((pr, i) => (i === 0 && fromPlak ? { ...pr, jenisPlak: fromPlak.jenisPlak } : pr)),
      };
      const currentVisible = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
      const newVisibleBlocksByCategory = {
        ...st[visibleBlocksByCategory],
        [catKey]: Math.min(cat.blocksCount || 1, Math.max(currentVisible, toBlockIdx + 1)),
      };
      return {
        [lineValues]: newLineValues, [matrixValues]: newMatrixValues, [rowsByBlock]: newRowsByBlock, [columnsByBlock]: newColumnsByBlock,
        [plakRows]: newPlakRows, [visibleBlocksByCategory]: newVisibleBlocksByCategory,
      };
    }),
    // "Delete section" — the reverse of onDuplicateBlock above, for a
    // teacher who clicked Duplicate by mistake (`hasNamaKelasList`
    // categories only — OTHERS/Mata Pelajaran-Klas). Only ever removes the
    // CURRENT last visible block, and never block 0 (the original
    // section) — mirrors exactly where Duplicate itself is allowed, so
    // there's never a numbering gap in the middle. Clears that block's own
    // lineValues/rowsByBlock/columnsByBlock/plakRows entries (not just
    // hides it) so a later re-Duplicate doesn't resurrect stale data — the
    // same staleness concern onLine/onPlakSelect above already guard
    // against for block 0's shared fields.
    onRemoveBlock: (catKey, blockIdx) => patch((st) => {
      const currentVisible = (st[visibleBlocksByCategory] && st[visibleBlocksByCategory][catKey]) || 1;
      if (blockIdx <= 0 || blockIdx !== currentVisible - 1) return {};
      const linePrefix = `${catKey}::${blockIdx}::`;
      const newLineValues = { ...st[lineValues] };
      Object.keys(newLineValues).forEach((k) => { if (k.startsWith(linePrefix)) delete newLineValues[k]; });
      const newMatrixValues = { ...st[matrixValues] };
      Object.keys(newMatrixValues).forEach((k) => { if (k.startsWith(linePrefix)) delete newMatrixValues[k]; });
      const blockKey = `${catKey}::${blockIdx}`;
      const newRowsByBlock = { ...st[rowsByBlock] };
      delete newRowsByBlock[blockKey];
      const newColumnsByBlock = { ...st[columnsByBlock] };
      delete newColumnsByBlock[blockKey];
      const newPlakRows = { ...st[plakRows] };
      delete newPlakRows[blockKey];
      return {
        [lineValues]: newLineValues, [matrixValues]: newMatrixValues, [rowsByBlock]: newRowsByBlock, [columnsByBlock]: newColumnsByBlock,
        [plakRows]: newPlakRows,
        [visibleBlocksByCategory]: { ...st[visibleBlocksByCategory], [catKey]: blockIdx },
      };
    }),
  };
}
