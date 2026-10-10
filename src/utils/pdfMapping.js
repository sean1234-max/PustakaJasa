import { makeDynamicCategoryKey } from '../data/catalog';
import { cleanDocxPlakCode, wordingRowsToCategorized } from './docxImport';

// Turns the AI's reading of a text PDF (supabase/functions/read-order-file,
// kind "pdf" — segment references, see pdfSchema.ts there) into the same
// `{ categorized, notes }` shape the Word reader returns. The AI never
// types an engraved line: each line is the text of the segment(s) it
// points at, read here from the PDF's own structure map (pdfIr.js). Where
// it quotes part of a segment ("1 HASANAH" of "1 HASANAH – 5"), a number
// or a plaque code, the quote must really be in that segment, or the line
// is dropped with a note. Totals the file states are checked against what
// the labels add up to.
//
// Each label becomes Word-style rows ({ lines, qty, kod }): a line with
// several options is one plaque per option, two such lines multiply
// (subjects x years). Tajuk lines become the TAJUK BESAR; the rest follow
// the owner's in-order Word mapping (docxImport.js wordingFields).

const MAX_PLAQUES_PER_LABEL = 2000;

const norm = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/[‐-―−]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

// "p2s10-p2s11" -> the segments (one printed line), or null.
function makeSegmentReader(ir) {
  const byId = new Map(ir.segments.map((s, i) => [s.id, { ...s, i }]));
  const segs = (ref) => {
    if (typeof ref !== 'string') return null;
    const [a, b = a] = ref.split('-');
    const s = byId.get(a);
    const e = byId.get(b);
    if (!s || !e || s.page !== e.page || e.i < s.i || e.i - s.i > 20) return null;
    return ir.segments.slice(s.i, e.i + 1);
  };
  const read = (ref) => segs(ref)?.map((x) => x.text).join(' ') ?? null;
  return { read, segs };
}

// A list the AI expanded (a line with several options) whose printed rows
// hold text it did not use: most likely a list item it skipped. Returns the
// skipped texts, in reading order.
function skippedListItems(ir, listSegs, usedIds) {
  const rows = new Set(listSegs.map((s) => `${s.page}:${s.y}`));
  const out = [];
  let prev = null;
  ir.segments.forEach((s, i) => {
    if (usedIds.has(s.id) || !rows.has(`${s.page}:${s.y}`)) return;
    // Next to the last one on the same line: one item split in two.
    if (prev && prev.i === i - 1 && prev.page === s.page && prev.y === s.y) out[out.length - 1] += ` ${s.text}`;
    else out.push(s.text);
    prev = { i, page: s.page, y: s.y };
  });
  return out;
}

function hasNumber(text, value) {
  return new RegExp(`(^|[^\\d])${value}([^\\d]|$)`).test(text);
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);
}

export function applyPdfReading(ir, reading) {
  const notes = [];
  const { read, segs } = makeSegmentReader(ir);
  const usedIds = new Set();
  const listSegs = [];
  const markUsed = (ref) => (segs(ref) || []).forEach((x) => usedIds.add(x.id));
  const rowsByHeading = new Map();
  let bad = 0;

  // One option ("REF", "REF|TEXT" or "REF|TEXT|QTY|QTYREF" — see
  // pdfSchema.ts) -> its engraved text + own qty, or null when the AI's
  // ref, quote or number doesn't hold up.
  const optionOf = (raw) => {
    const [ref, part = '', qtyRaw = '', qtyRef = ''] = String(raw ?? '').split('|');
    const seg = read(ref);
    if (seg == null) return null;
    markUsed(ref);
    markUsed(qtyRef);
    let text = seg;
    if (part.trim()) {
      if (!norm(seg).includes(norm(part))) return null;
      text = part;
    }
    let qty = null;
    if (qtyRaw.trim()) {
      qty = Number(qtyRaw);
      const qSeg = read(qtyRef || ref);
      if (!Number.isInteger(qty) || qty < 0 || qSeg == null || !hasNumber(qSeg, qty)) return null;
    }
    return { text: text.replace(/\s+/g, ' ').trim(), qty };
  };

  (reading?.groups || []).forEach((g, gi) => {
    const where = `"${String(g.name || `Batch ${gi + 1}`).slice(0, 80)}"`;
    if (g.confidence === 'low') notes.push(`${where}: the AI wasn't sure how to read this part of the PDF — please check every plaque carefully.`);
    if (g.note) notes.push(`${where}: ${g.note}`);

    let kod = '';
    if (g.code) {
      const seg = read(g.code.ref);
      if (seg != null && norm(seg).includes(norm(g.code.text))) kod = cleanDocxPlakCode(g.code.text);
      else notes.push(`${where}: the plaque code the AI gave isn't in the file — please pick the Jenis Plak by hand.`);
    }

    const tajukLines = (g.tajuk || []).map(read);
    if (tajukLines.some((t) => t == null)) { bad++; notes.push(`${where}: the AI pointed at header text that isn't in the file — please type the TAJUK BESAR by hand.`); }
    const heading = tajukLines.filter((t) => t != null).join('\n');

    let sum = 0;
    let assumedOne = 0;
    const rows = [];
    let each = 1;
    if (g.each) {
      const seg = read(g.each.ref);
      if (Number.isInteger(g.each.value) && g.each.value > 0 && seg != null && hasNumber(seg, g.each.value)) each = g.each.value;
      else notes.push(`${where}: the AI gave a count per label that isn't in the file — 1 per label was used; please check.`);
    }
    (g.labels || []).forEach((label) => {
      const lines = (Array.isArray(label) ? label : []).map((ln) => (Array.isArray(ln) ? ln : []).map(optionOf));
      if (lines.length === 0) return;
      if (lines.some((opts) => opts.length === 0 || opts.some((o) => o == null))) {
        bad++;
        notes.push(`${where}: a label's wording didn't match the file, so it was left out — please add it by hand.`);
        return;
      }
      const varies = lines.some((opts) => opts.length > 1);
      label.forEach((ln, i) => {
        if (lines[i].length > 1) ln.forEach((o) => listSegs.push(...(segs(String(o).split('|')[0]) || [])));
      });
      const combos = cartesian(lines);
      if (combos.length > MAX_PLAQUES_PER_LABEL) { bad++; notes.push(`${where}: a list was too long to expand — please add it by hand.`); return; }
      combos.forEach((combo) => {
        const qtys = combo.map((o) => o.qty).filter((q) => q != null);
        const qty = qtys.reduce((a, q) => a * q, 1) * each;
        if (varies && qtys.length === 0 && !g.each) assumedOne++;
        if (qty <= 0) return;
        sum += qty;
        rows.push({ lines: combo.map((o) => o.text).filter(Boolean), qty, kod });
      });
    });

    if (assumedOne > 0) notes.push(`${where}: the PDF gives no quantity for its list, so 1 plaque per item was used (${assumedOne} plaques) — please check the quantities.`);
    if (g.total) {
      const seg = read(g.total.ref);
      if (seg == null || !hasNumber(seg, g.total.value)) {
        notes.push(`${where}: the total the AI gave isn't in the file — please check the quantities.`);
      } else if (g.total.value !== sum) {
        notes.push(`${where}: the PDF says ${g.total.value} in total, but the labels add up to ${sum} — please check nothing is missing or extra.`);
      }
    }
    if (!rowsByHeading.has(heading)) rowsByHeading.set(heading, []);
    rowsByHeading.get(heading).push(...rows);
  });

  [...(reading?.groups || []).flatMap((g) => [...(g.tajuk || []), g.code?.ref, g.total?.ref, g.each?.ref])].forEach(markUsed);
  const skipped = skippedListItems(ir, listSegs, usedIds);
  if (skipped.length) {
    notes.push(`The AI may have skipped ${skipped.length} item(s) in the PDF's lists: ${skipped.slice(0, 8).map((t) => `"${t}"`).join(', ')}${skipped.length > 8 ? ', …' : ''} — please check and add them by hand if they are needed.`);
  }

  const categorized = {};
  let count = 0;
  rowsByHeading.forEach((rows, heading) => {
    if (!rows.length) return;
    const grouped = wordingRowsToCategorized(rows, heading);
    Object.entries(grouped.categorized).forEach(([key, sections]) => {
      // Same award under two different headings: its own tab, numbered.
      let k = key;
      for (let n = 2; categorized[k]; n++) {
        sections[0].sourceSheet = `${sections[0].sourceSheet.replace(/ \(\d+\)$/, '')} (${n})`;
        k = makeDynamicCategoryKey('KLAS_MATRIX', sections[0].sourceSheet);
      }
      categorized[k] = sections;
    });
    count += grouped.count;
    notes.push(...grouped.notes);
  });
  if (count > 0 && [...rowsByHeading.keys()].every((h) => !h)) notes.push('No event heading was found on the labels — please type the TAJUK BESAR by hand.');
  if (ir.truncated) notes.push('This PDF is very long — only the first part was sent to the AI; please add anything after that by hand.');
  (reading?.questions || []).forEach((q) => notes.push(String(q)));
  return { categorized, notes, count, bad };
}
