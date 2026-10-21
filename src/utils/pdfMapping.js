import { makeDynamicCategoryKey } from '../data/catalog';
import { cleanDocxPlakCode, wordingRowsToCategorized, wordingRowsToUmum } from './docxImport';
import { fileSaysTempat, tahunDigits, withTempat } from './positionWords';

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

// A plaque code written over several lines of one table cell ("SM-13187" / "SILVER" / "BASE C" /
// "(6 UNIT)"): when the AI quoted the whole first line, the short code-like lines right below it
// in the same column join it — "SM-13187 / SILVER / BASE C" (Sean, 2026-10-21). A count, a price
// or a bracketed note ends it.
const CODE_PART_RE = /^[A-Z][A-Z0-9 .#-]{0,14}$/i;
const CODE_STOP_RE = /^\(|UNIT|^RM\b|^\d+$/i;
function codeLinesBelow(ir, seg, text) {
  const last = seg?.[seg.length - 1];
  if (!last || seg.length !== 1 || norm(last.text) !== norm(text)) return text;
  const parts = [text];
  // the row's first column (its No.): text there at a lower line is the next table row
  const rowStart = Math.min(...ir.segments.filter((x) => x.page === last.page && x.y === last.y).map((x) => x.x));
  let at = last;
  for (;;) {
    const next = ir.segments.find((x) => x.page === at.page && Math.abs(x.x - at.x) <= 2 && x.y > at.y && x.y - at.y <= 20);
    if (!next || CODE_STOP_RE.test(next.text.trim()) || !CODE_PART_RE.test(next.text.trim())) break;
    if (rowStart < next.x && ir.segments.some((x) => x.page === next.page && x.y === next.y && Math.abs(x.x - rowStart) <= 2)) break;
    parts.push(next.text.trim());
    at = next;
  }
  return parts.join(' / ');
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

// The school line of a label — where ③ starts (schoolLineTabs below): SK …, SJK(C) …, SMK …,
// SEKOLAH KEBANGSAAN … ("SEKOLAH KLUSTER KECEMERLANGAN" is not one).
const SCHOOL_LINE_RE = /^(SK|SJK\s*\(?\s*[CT]\s*\)?|SJKC|SJKT|SMK|SMJK|SMKA|SRA|SRAI|SABK|SEKOLAH\s+(KEBANGSAAN|JENIS|MENENGAH|RENDAH|AGAMA))\b/i;

// Labels whose lines include a school line, as ORDER LAIN-LAIN tabs (Sean, 2026-10-21) — the
// same layout whatever batches the AI made:
//   ① the award (the lines that differ from label to label), MERAH
//   ② the lines between the award and the school line, together (HARI KECEMERLANGAN … ⏎ PROGRAM …)
//   ③ the school line          ④ the lines after it (2026)
// Labels sharing ②–④ are one tab, a row per award, named after the first award. With a single
// label, ① is its first line and ② the rest up to the school (TAHNIAH & SYABAS / MAJLIS GRADUASI ⏎
// PROGRAM … / SK BUKIT RIMAU 2026). The TAJUK BESAR lines the AI gave go on top of the label.
// Name lists (name first) are left to the old grouping. Returns { categorized, count, notes, taken }.
function schoolLineTabs(items) {
  const clean = (list) => list.map((t) => String(t ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const parsed = items.map(({ row, heading }) => {
    if (row.nameFirst) return null;
    const head = clean(String(heading || '').split('\n'));
    const own = clean(row.lines);
    const at = own.findIndex((t, i) => (head.length || i > 0) && SCHOOL_LINE_RE.test(t));
    return at >= 0 && head.length + at > 0 ? { row, head, pre: own.slice(0, at), school: own[at], after: own.slice(at + 1).join('\n') } : null;
  }).filter(Boolean);
  const groups = new Map();
  parsed.forEach((p) => {
    const k = `${p.school}\u0000${p.after}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });
  // Several labels: ① is what differs from label to label; ② the TAJUK BESAR lines and the lines
  // every label shares above the school line. One label: ① its first line, ② the rest.
  const tabs = new Map();
  groups.forEach((list) => {
    let shared = list.length > 1 ? list[0].pre.slice(1) : [];
    list.slice(1).forEach((p) => {
      while (shared.length && (shared.length >= p.pre.length || shared.some((t, i) => p.pre[p.pre.length - shared.length + i] !== t))) shared = shared.slice(1);
    });
    list.forEach((p) => {
      let award;
      let middle;
      if (list.length > 1) {
        award = p.pre.slice(0, p.pre.length - shared.length).join(' ');
        middle = [...p.head, ...shared];
      } else {
        const all = [...p.head, ...p.pre];
        award = all[0] || '';
        middle = all.slice(1);
      }
      const k = `${middle.join('\n')}\u0000${p.school}\u0000${p.after}`;
      if (!tabs.has(k)) tabs.set(k, { slots: ['', middle.join('\n'), p.school, p.after], rows: [] });
      tabs.get(k).rows.push({ award, qty: p.row.qty, kod: p.row.kod || '', row: p.row });
    });
  });
  const categorized = {};
  const notes = [];
  let count = 0;
  tabs.forEach(({ slots, rows }) => {
    const contoh = rows[0].award;
    const lines = { umumRed: '0' };
    [contoh, ...slots.slice(1)].forEach((t, i) => { if (t) lines[`${i}`] = t; });
    const umumRows = [];
    rows.forEach((r) => {
      const l0 = r.award === contoh ? '' : r.award;
      const same = umumRows.find((u) => u.l0 === l0 && u.jenisPlak === r.kod);
      if (same) { same.qty += r.qty; return; }
      umumRows.push({ no: String(umumRows.length + 1), l0, l1: '', l2: '', l3: '', qty: r.qty, jenisPlak: r.kod, harga: '' });
    });
    let label = contoh.slice(0, 80) || 'ORDER LAIN-LAIN';
    for (let n = 2; categorized[makeDynamicCategoryKey('UMUM', label)]; n++) label = `${contoh.slice(0, 80)} (${n})`;
    const key = makeDynamicCategoryKey('UMUM', label);
    categorized[key] = [{ lines, umumRows, isUmumList: true, skipLineDerivation: true, classes: [], sourceSheet: label, dynamicCategoryKey: key }];
    count += umumRows.length;
    const uncoded = rows.filter((r) => !r.kod).reduce((a, r) => a + r.qty, 0);
    if (uncoded) notes.push(`"${label}": ${uncoded} plaque(s) have no plaque code (KOD) — please pick the Jenis Plak by hand.`);
  });
  return { categorized, count, notes, taken: new Set(parsed.map((p) => p.row)) };
}

// A batch listing this many different awards becomes one tab (see runs below).
const MIN_AWARDS_FOR_ONE_TAB = 3;

export function applyPdfReading(ir, reading) {
  const notes = [];
  const { read, segs } = makeSegmentReader(ir);
  const usedIds = new Set();
  const lists = [];
  const runs = [];
  let bad = 0;
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

    // This batch's own text says "Tempat Pertama" (a sample label the AI
    // quoted only "PERTAMA" of): its bare PERTAMA lines get TEMPAT too. Text
    // elsewhere in the file, like a price list, doesn't count (Sean, 2026-10-20).
    const refs = [...(g.tajuk || []), g.code?.ref, g.total?.ref, g.each?.ref,
      ...(g.labels || []).flat(2).filter((o) => o !== '&').flatMap((o) => String(o).split('|').filter((_, i) => i === 0 || i === 3))];
    const tempat = fileSaysTempat(refs.map((r) => read(baseRef(r)) || '').join(' '));

    let kod = '';
    if (g.code) {
      const seg = read(g.code.ref);
      if (seg != null && norm(seg).includes(norm(g.code.text))) kod = cleanDocxPlakCode(codeLinesBelow(ir, segs(g.code.ref), g.code.text));
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
        const withTahun = text.map(tahunDigits);
        const engraved = tempat ? withTahun.map(withTempat) : withTahun;
        if (engraved.some((l, i) => l !== withTahun[i])) tempatAdded += qty;
        rows.push({ lines: engraved, qty, kod, nameFirst });
        if (!varies) fixedLines.push(engraved);
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
    else runs.push({ heading, rows, name: String(g.name || '').trim() });
  });

  if (tempatAdded) notes.push(`The order's own wording says "Tempat Pertama", so TEMPAT was added before PERTAMA / KEDUA … on ${tempatAdded} plaque(s) — please check.`);
  (reading?.groups || []).flatMap((g) => [...(g.tajuk || []), g.code?.ref, g.total?.ref, g.each?.ref]).forEach(markUsed);
  const skipped = skippedListItems(ir, lists, usedIds);
  if (skipped.length) {
    notes.push(`The AI may have skipped ${skipped.length} item(s) in the PDF's lists: ${skipped.slice(0, 8).map((t) => `"${t}"`).join(', ')}${skipped.length > 8 ? ', …' : ''} — please check and add them by hand if they are needed.`);
  }

  const categorized = {};
  let count = 0;
  // Labels with a school line: ORDER LAIN-LAIN tabs by their shared sample, over the whole file
  // (schoolLineTabs). The rest are grouped as before, run by run.
  const school = schoolLineTabs(runs.flatMap(({ rows, heading }) => rows.map((row) => ({ row, heading }))));
  Object.entries(school.categorized).forEach(([key, sections]) => { categorized[key] = sections; });
  count += school.count;
  notes.push(...school.notes);
  runs.forEach(({ rows: all, heading, name }) => {
    const rows = all.filter((r) => !school.taken.has(r));
    if (!rows.length) return;
    // A list of awards that share everything below the award (a Word table:
    // CEMERLANG BAHASA MELAYU / TAHAP 1, CEMERLANG MATEMATIK / TAHAP 1 … each
    // over the same HARI KECEMERLANGAN … lines): one ORDER LAIN-LAIN-style tab,
    // a row per award, instead of a tab per award (Sean, 2026-10-21) — like
    // the Excel AI reader (aiMapping.js). Fewer awards keep their own tabs.
    const umum = new Set(rows.map((r) => r.lines[0])).size >= MIN_AWARDS_FOR_ONE_TAB && wordingRowsToUmum(rows, heading);
    if (umum) {
      const base = name || 'ORDER LAIN-LAIN';
      let label = base;
      for (let n = 2; categorized[makeDynamicCategoryKey('UMUM', label)]; n++) label = `${base} (${n})`;
      const key = makeDynamicCategoryKey('UMUM', label);
      categorized[key] = [{ ...umum.section, sourceSheet: label, dynamicCategoryKey: key }];
      count += umum.section.umumRows.length;
      notes.push(...umum.notes.map((n) => `"${label}": ${n}`));
      return;
    }
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
