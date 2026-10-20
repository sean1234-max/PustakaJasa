import { makeDynamicCategoryKey } from '../data/catalog';
import { cleanDocxPlakCode, wordingRowsToCategorized } from './docxImport';
import { fileSaysTempat, withTempat } from './positionWords';

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
// (subjects x years). A printed range ("1 – 6") stands for each number in
// it, and a line can be built from pieces ("TAHUN" + the year) — the
// pattern the file's sample label shows, not text the AI makes up. Tajuk lines become the TAJUK BESAR; the rest follow
// the owner's in-order Word mapping (docxImport.js wordingFields).

const MAX_PLAQUES_PER_LABEL = 2000;

const norm = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/[‐-―−]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

// "p2s10-p2s11" (a run on one printed line) or "p1s64+p1s66" (one item
// printed over two lines, the next part a little lower) -> the segments,
// or null.
function makeSegmentReader(ir) {
  const byId = new Map(ir.segments.map((s, i) => [s.id, { ...s, i }]));
  const run = (ref) => {
    const [a, b = a] = ref.split('-');
    const s = byId.get(a);
    const e = byId.get(b);
    if (!s || !e || s.page !== e.page || e.i < s.i || e.i - s.i > 20) return null;
    return ir.segments.slice(s.i, e.i + 1);
  };
  const segs = (ref) => {
    if (typeof ref !== 'string' || !ref) return null;
    const parts = ref.split('+');
    if (parts.length > 4) return null;
    const runs = parts.map(run);
    if (runs.some((r) => !r)) return null;
    for (let i = 1; i < runs.length; i++) {
      const a = runs[i - 1][runs[i - 1].length - 1];
      const b = runs[i][0];
      if (b.page !== a.page || b.y <= a.y || b.y - a.y > 50) return null;
    }
    return runs.flat();
  };
  const read = (ref) => segs(ref)?.map((x) => x.text).join(' ') ?? null;
  return { read, segs };
}

// Text the AI did not use inside a list it expanded (a line with several
// options): on a row that holds list items, in one list's own column,
// from its first row to just below its last one (the item after the last
// one it took). Most likely a list item it skipped. Counts and notes printed beside a list ("8 KELAS x",
// "48 MURID x") are in other columns and don't count. Returns the skipped
// texts, in reading order.
const LIST_ROW_GAP = 40;

function skippedListItems(ir, lists, usedIds) {
  const rows = new Set(lists.flat().map((l) => `${l.page}:${l.y}`));
  const inList = (s) => rows.has(`${s.page}:${s.y}`) && lists.some((list) => {
    const mine = list.filter((l) => l.page === s.page);
    if (!mine.length) return false;
    const ys = mine.map((l) => l.y);
    return s.y >= Math.min(...ys) && s.y <= Math.max(...ys) + LIST_ROW_GAP
      && mine.some((l) => Math.abs(l.x - s.x) <= 25);
  });
  const out = [];
  let prev = null;
  ir.segments.forEach((s, i) => {
    if (usedIds.has(s.id) || !inList(s)) return;
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

// "1 - 6", "1 – 6", "4 HINGGA 6" printed in the segment.
function hasRange(text, from, to) {
  return new RegExp(`(^|[^\\d])${from}\\s*(-|HINGGA|SAMPAI|TO)\\s*${to}([^\\d]|$)`).test(norm(text));
}

const MAX_RANGE = 30;

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);
}

// A line on one finished label that matches the same line on the group's
// other labels except for one word ("SAHAJA MAHATMA GANDHI" among several
// "ANUGERAH MAHATMA GANDHI"): most likely the AI took the text beside the
// right one. Returns [odd, usual] pairs; nothing is changed.
function oddOneOut(labels) {
  const out = [];
  const byLine = new Map();
  labels.forEach((lines) => lines.forEach((t, i) => {
    const key = `${lines.length}:${i}`;
    if (!byLine.has(key)) byLine.set(key, new Map());
    const m = byLine.get(key);
    m.set(t, (m.get(t) || 0) + 1);
  }));
  byLine.forEach((counts) => {
    const values = [...counts];
    values.forEach(([odd, n]) => {
      if (n !== 1) return;
      const a = odd.split(' ');
      const usual = values.find(([t, m]) => {
        const b = t.split(' ');
        return m >= 2 && a.length >= 2 && b.length === a.length && b.filter((w, i) => w !== a[i]).length === 1;
      });
      if (usual) out.push([odd, usual[0]]);
    });
  });
  return out;
}

// Owner (2026-10-16): one engraved line never holds two schools. A line
// like "SEKOLAH KEBANGSAAN TAMAN MELAWATI 2SEKOLAH KLUSTER" is split before
// the second SEKOLAH, and that school's words carried on the next line
// ("KECEMERLANGAN") join it again: "SEKOLAH KLUSTER KECEMERLANGAN".
const SECOND_SCHOOL_RE = /(?<=[^A-Za-z])\s*(?=SEKOLAH\b)/gi;
const LINE_START_RE = /^(SEKOLAH|SK|SJK|SMK|MAJLIS|HARI|ANUGERAH|SESI|\(|\d)/i;
export function splitSchoolLines(lines) {
  const out = [];
  let carry = false;
  (lines || []).forEach((raw) => {
    const line = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!line) return;
    if (carry && !LINE_START_RE.test(line)) { out[out.length - 1] += ` ${line}`; carry = false; return; }
    const parts = line.split(SECOND_SCHOOL_RE).map((p) => p.trim()).filter(Boolean);
    out.push(...parts);
    carry = parts.length > 1;
  });
  return out;
}

export function applyPdfReading(ir, reading) {
  const notes = [];
  const { read, segs } = makeSegmentReader(ir);
  const usedIds = new Set();
  const lists = [];
  const runs = [];
  let bad = 0;
  // The file says "Tempat Pertama" somewhere: a bare PERTAMA line gets it too.
  const tempat = fileSaysTempat(ir.segments.map((s) => s.text).join(' '));
  let tempatAdded = 0;

  // REF without a "#1-6" range suffix.
  const baseRef = (ref) => String(ref ?? '').split('#')[0];
  const markUsed = (ref) => (segs(baseRef(ref)) || []).forEach((x) => usedIds.add(x.id));

  // One option ("REF", "REF|TEXT", "REF|TEXT|QTY|QTYREF" or a printed
  // range "REF#1-6" — see pdfSchema.ts) -> its engraved text(s) + own qty,
  // or null when the AI's ref, quote, number or range doesn't hold up. A
  // range gives one option per number in it.
  const optionsOf = (raw) => {
    const [refRaw, part = '', qtyRaw = '', qtyRef = ''] = String(raw ?? '').split('|');
    const [ref, range] = String(refRaw).split('#');
    const seg = read(ref);
    if (seg == null) return null;
    markUsed(ref);
    markUsed(qtyRef);
    if (range != null) {
      const m = /^(\d+)-(\d+)$/.exec(range);
      if (!m || part.trim() || qtyRaw.trim()) return null;
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (to <= from || to - from > MAX_RANGE || !hasRange(seg, from, to)) return null;
      return Array.from({ length: to - from + 1 }, (_, k) => ({ text: String(from + k), qty: null }));
    }
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
    return [{ text: text.replace(/\s+/g, ' ').trim(), qty }];
  };

  // A label line: its options, and whether it joins onto the line before
  // it (first option "&": pieces of one engraved line, e.g. "TAHUN" + the
  // year). null when any option fails.
  const lineOf = (ln) => {
    const raw = Array.isArray(ln) ? ln : [];
    const join = raw[0] === '&';
    const opts = (join ? raw.slice(1) : raw).map(optionsOf);
    if (opts.length === 0 || opts.some((o) => o == null)) return null;
    return { join, raw: join ? raw.slice(1) : raw, opts: opts.flat() };
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
    const heading = splitSchoolLines(tajukLines.filter((t) => t != null)).join('\n');

    let sum = 0;
    let assumedOne = 0;
    let multiplied = false;
    const rows = [];
    const fixedLines = [];
    let each = 1;
    if (g.each) {
      const seg = read(g.each.ref);
      if (Number.isInteger(g.each.value) && g.each.value > 0 && seg != null && hasNumber(seg, g.each.value)) each = g.each.value;
      else notes.push(`${where}: the AI gave a count per label that isn't in the file — 1 per label was used; please check.`);
    }
    // A name list (the AI's `names`): each label starts with the person's
    // name and the award is below it — engraved name first, one tab per
    // award.
    const nameFirst = g.names === true;
    (g.labels || []).forEach((label) => {
      const lines = (Array.isArray(label) ? label : []).map(lineOf);
      if (lines.length === 0) return;
      if (lines.some((l) => l == null)) {
        bad++;
        notes.push(`${where}: a label's wording didn't match the file, so it was left out — please add it by hand.`);
        return;
      }
      const varies = lines.some((l) => l.opts.length > 1);
      lines.forEach((l) => {
        if (l.opts.length > 1) lists.push(l.raw.flatMap((o) => segs(baseRef(String(o).split('|')[0])) || []));
      });
      // A count printed for one option, multiplied by another varying line.
      if (lines.some((l, i) => l.opts.some((o) => o.qty != null) && lines.some((m, j) => j !== i && m.opts.length > 1 && m.opts.every((o) => o.qty == null)))) multiplied = true;
      const combos = cartesian(lines.map((l) => l.opts));
      if (combos.length > MAX_PLAQUES_PER_LABEL) { bad++; notes.push(`${where}: a list was too long to expand — please add it by hand.`); return; }
      combos.forEach((combo) => {
        const qtys = combo.map((o) => o.qty).filter((q) => q != null);
        const qty = qtys.reduce((a, q) => a * q, 1) * each;
        if (varies && qtys.length === 0 && !g.each) assumedOne++;
        if (qty <= 0) return;
        sum += qty;
        const text = [];
        combo.forEach((o, i) => {
          if (!o.text) return;
          if (lines[i].join && text.length) text[text.length - 1] += ` ${o.text}`;
          else text.push(o.text);
        });
        const engraved = tempat ? text.map(withTempat) : text;
        if (engraved.some((l, i) => l !== text[i])) tempatAdded += qty;
        rows.push({ lines: engraved, qty, kod, nameFirst });
        if (!varies) fixedLines.push(text);
      });
    });
    oddOneOut(fixedLines).forEach(([odd, usual]) => notes.push(`${where}: one label reads "${odd}" where the others read "${usual}" — please check that label.`));

    let totalMatches = false;
    if (g.total) {
      const seg = read(g.total.ref);
      if (seg == null || !hasNumber(seg, g.total.value)) {
        notes.push(`${where}: the total the AI gave isn't in the file — please check the quantities.`);
      } else if (g.total.value !== sum) {
        notes.push(`${where}: the PDF says ${g.total.value} in total, but the labels add up to ${sum} — please check nothing is missing or extra.`);
      } else totalMatches = true;
    }
    if (assumedOne > 0 && !totalMatches) notes.push(`${where}: the PDF gives no quantity for its list, so 1 plaque per item was used (${assumedOne} plaques) — please check the quantities.`);
    if (multiplied && !totalMatches) notes.push(`${where}: a count printed in the PDF was used for every combination of another list (${sum} plaques in all) — please check the quantities.`);
    // Runs of labels under one heading, in the file's order.
    const last = runs[runs.length - 1];
    if (last && last.heading === heading) last.rows.push(...rows);
    else runs.push({ heading, rows });
  });

  if (tempatAdded) notes.push(`The file says "Tempat Pertama", so TEMPAT was added before PERTAMA / KEDUA … on ${tempatAdded} plaque(s) — please check.`);
  (reading?.groups || []).flatMap((g) => [...(g.tajuk || []), g.code?.ref, g.total?.ref, g.each?.ref]).forEach(markUsed);
  const skipped = skippedListItems(ir, lists, usedIds);
  if (skipped.length) {
    notes.push(`The AI may have skipped ${skipped.length} item(s) in the PDF's lists: ${skipped.slice(0, 8).map((t) => `"${t}"`).join(', ')}${skipped.length > 8 ? ', …' : ''} — please check and add them by hand if they are needed.`);
  }

  const categorized = {};
  let count = 0;
  runs.forEach(({ rows, heading }) => {
    if (!rows.length) return;
    const grouped = wordingRowsToCategorized(rows, heading, { keepOrder: true });
    Object.entries(grouped.categorized).forEach(([key, sections]) => {
      // Same award again further down the file: its own tab, numbered.
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
  if (count > 0 && runs.every((r) => !r.heading)) notes.push('No event heading was found on the labels — please type the TAJUK BESAR by hand.');
  if (ir.truncated) notes.push('This PDF is very long — only the first part was sent to the AI; please add anything after that by hand.');
  (reading?.questions || []).forEach((q) => notes.push(String(q)));
  return { categorized, notes, count, bad };
}

// The fixed header lines of a sample label the PDF draws as a picture
// (school, ceremony, SESI — read-order-file kind "pdf-heading"), put into
// TAJUK BESAR. They can't be checked against the PDF's text, so they are
// only used where they agree with what the text has: a tab whose heading
// is empty, or whose every heading line is found in the picture's lines
// ("MAJLIS APRESIASI AKADEMIK" in "MAJLIS APRESIASI AKADEMIK 2026"). Changes
// `categorized` in place; returns the notes.
export function applyPictureHeading(categorized, picture) {
  const pic = splitSchoolLines(picture?.lines);
  if (!pic.length || picture.confidence === 'low') return [];
  const sections = Object.values(categorized || {}).flatMap((list) => list || []);
  const headingOf = (section) => String(section.lines?.['0'] || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const inText = new Set(sections.flatMap(headingOf).map(norm));
  const added = new Set();
  sections.forEach((section) => {
    const own = headingOf(section);
    const fits = own.every((t) => pic.some((p) => norm(p).includes(norm(t))));
    if (!fits || own.join('\n') === pic.join('\n')) return;
    pic.filter((p) => !inText.has(norm(p))).forEach((p) => added.add(p));
    section.lines = { ...section.lines, 0: pic.join('\n') };
  });
  if (!added.size) return [];
  return [`TAJUK BESAR: ${[...added].map((l) => `"${l}"`).join(', ')} ${added.size > 1 ? 'were' : 'was'} read from a picture of the sample label (not the PDF's text) — please check ${added.size > 1 ? 'them' : 'it'} against the PDF.`];
}

// Plaque photos read by the AI (read-order-file kind "pdf-plaques") complete
// a batch's Jenis Plak where the PDF's text leaves it short: a code with no
// design ("0011A" + a photo marked DESIGN A), or no code at all (the photo
// placed by the award it is for). Only used when every photo that fits says
// the same thing; never replaces a code the text gives. Returns notes.
const plakKey = (s) => String(s || '').toUpperCase().replace(/^\s*CODE\s*:?/, '').replace(/[^A-Z0-9]/g, '');
export function applyPlaquePictures(categorized, pictures) {
  const usable = (pictures || []).filter((p) => p && p.code && p.confidence !== 'low');
  if (!usable.length) return [];
  const notes = [];
  const awardOf = (section) => Object.entries(section.lines || {}).filter(([k]) => k !== '0').map(([, v]) => v).find(Boolean) || '';
  const agreed = (list, key) => {
    const values = [...new Set(list.map(key))];
    return values.length === 1 ? values[0] : null;
  };
  Object.values(categorized || {}).flatMap((list) => list || []).forEach((section) => {
    const own = String(section.jenisPlak || '').trim();
    const award = awardOf(section);
    let plak = null;
    if (own) {
      if (/DESIGN/i.test(own)) return;
      const design = agreed(usable.filter((p) => p.design && plakKey(p.code) === plakKey(own)), (p) => p.design);
      if (design) plak = `${own} ${design}`;
    } else if (award) {
      const fits = usable.filter((p) => p.award && (norm(p.award).includes(norm(award)) || norm(award).includes(norm(p.award))));
      const picked = agreed(fits, (p) => [p.code, p.design].filter(Boolean).join(' '));
      if (picked) plak = picked;
    }
    if (!plak) return;
    section.jenisPlak = plak;
    notes.push(`${award || 'A batch'}: Jenis Plak "${plak}" was read from a photo of the plaque in the PDF — please check it.`);
  });
  return [...new Set(notes)];
}
