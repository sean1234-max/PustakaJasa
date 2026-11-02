// The plak preview (Sean, 2026-11-02): one plaque of each Jenis Plak in an order drawn the way SEAN.jsx
// lays it out in Illustrator, close enough to check the words, their order and the line breaks before
// submitting. The templates come from public/plak-preview/templates.json (scripts/plak-preview: each
// .ai's layout groups — text frame boxes in pt around the ANCHOR_CIRCLE centre, y up — and its picture).
// The rules below mirror SEAN.jsx: which .ai (findMatchingAiFile), which layout group (getTemplateName /
// chooseTemplateSource), the house text style, the line order, the gaps, and the stack centred on the anchor.
// ponytail: SAMPLE tweaks (UPDATE FROM SAMPLE: moved gaps, sizes) and Illustrator's own text wrapping are
// not copied — the AI file stays the final word.

// ------------------------------------------------------------------ which .ai (SEAN.jsx findMatchingAiFile)
const squash = (s) => String(s || '').replace(/[\s !-/:-@[-`{-~]+/g, '').toUpperCase();
const eCutNumber = (s) => /E\s*CUT\s*(\d+)/i.exec(String(s || ''))?.[1] ?? null;
const TROFI_CODES = ['13228 (B)', 'H25-1', 'JZ19821', 'YK-628', 'YK-1370', 'W038 A', 'W038 B', 'W038 C', 'W038',
  'SR-116A', 'SL245#3', 'SL243#3', 'TSL232#3', '4942', '4943', '19540B'];
const trofiKey = (code) => String(code || '').toUpperCase().replace(/[\s\-()/]+/g, '');
function isTrofiCode(code) {
  const k = trofiKey(code);
  return !!k && TROFI_CODES.map(trofiKey).some((t) => k === t || (k.startsWith(t) && !/[0-9]/.test(k.charAt(t.length))));
}
function eCutForBase(code) {
  const c = String(code || '').toUpperCase();
  if (/\bBASE\s*WITH(OUT)?\s*COVER\b/.test(c)) return '11';
  const m = /\bBASE\s*([ABC])\b/.exec(c);
  return m ? { A: '8', B: '9', C: '10' }[m[1]] : null;
}

export function fileForCode(code, manifest) {
  const files = (manifest?.files || []).map((f) => f.file);
  const base = eCutForBase(code);
  const byBase = base !== null && files.find((f) => eCutNumber(f) === base);
  if (byBase) return byBase;
  const mapped = (manifest?.mapping || []).find(([c]) => squash(c) === squash(code))?.[1];
  if (mapped && files.includes(mapped)) return mapped;
  if (isTrofiCode(code)) return files.find((f) => /TROFI/i.test(f) && trofiKey(f).includes(trofiKey(code))) || null;
  const n = eCutNumber(code);
  const byNumber = n !== null && files.find((f) => eCutNumber(f) === n);
  if (byNumber) return byNumber;
  const key = squash(code);
  return (key && files.find((f) => squash(f).includes(key))) || null;
}

// ------------------------------------------------------------------ which layout group
const hasCjk = (s) => /[㐀-鿿豈-﫿]/.test(String(s || ''));
const TOKENS = [['H', 'event_header'], ['Y', 'year'], ['PC', 'position'], ['L1', 'event_line_1'], ['L2', 'event_line_2']];

export function templateNameFor(row) {
  const cjk = TOKENS.some(([, f]) => hasCjk(row[f]));
  return TOKENS.reduce((n, [tok, f]) => (String(row[f] || '') !== '' ? `${n}_${tok}` : n), cjk ? 'TC' : 'T');
}

// SEAN.jsx chooseTemplateSource: the exact group, else the same language's group with every line it
// needs and the fewest extra (an extra L line costs 10, any other 11)
export function pickTemplate(templates, name) {
  if (templates?.[name]) return name;
  const want = name.split('_');
  let best = null;
  Object.keys(templates || {}).forEach((have) => {
    const parts = have.split('_');
    if (parts[0] !== want[0] || !want.slice(1).every((p) => parts.includes(p))) return;
    const score = parts.slice(1).filter((p) => !want.includes(p)).reduce((s, p) => s + (/^L\d$/.test(p) ? 10 : 11), 0);
    if (!best || score < best.score) best = { name: have, score };
  });
  return best?.name || null;
}

// ------------------------------------------------------------------ position colour (SEAN.jsx getRankColor)
const YELLOW = ['JOHAN', 'CHAMPION', '1ST PLACE', 'FIRST PLACE', 'PERTAMA', 'TEMPAT PERTAMA', 'JUARA 1', 'JUARA PERTAMA',
  'GOLD', '1ST', 'THE CHAMPION', 'EMAS', 'ANUGERAH EMAS', '冠军', '第一名', '一等奖', '金奖'];
const GREY = ['NAIB JOHAN', '1ST RUNNER-UP', '1ST RUNNER UP', 'KEDUA', 'TEMPAT KEDUA', 'JUARA 2', 'JUARA KEDUA',
  'SILVER', '2ND PLACE', 'SECOND PLACE', '2ND', 'PERAK', 'ANUGERAH PERAK', '亚军', '第二名', '二等奖', '银奖'];
const BROWN = ['KETIGA', 'TEMPAT KETIGA', '2ND RUNNER-UP', '2ND RUNNER UP', 'JUARA 3', 'JUARA KETIGA', 'KE-3', 'KE 3',
  'GANGSA', 'ANUGERAH GANGSA', 'BRONZE', '3RD PLACE', 'THIRD PLACE', '3RD', '季军', '第三名', '三等奖', '铜奖', '殿军',
  '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名', '优秀奖', '优胜奖', 'KEEMPAT', 'KELIMA', 'KEENAM',
  'KETUJUH', 'KELAPAN', 'KESEMBILAN', 'KESEPULUH', 'SAGU HATI', 'SAGUHATI', 'CONSOLATION PRIZE', '4TH', '5TH', '6TH',
  '7TH', '8TH', '9TH', '10TH', ...Array.from({ length: 27 }, (_, i) => `KE-${i + 4}`)];
const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

// a keyword that is a whole line of the position, the longest one wins
export function rankColor(position) {
  const lines = String(position || '').split(/\r?\n/).map(normText);
  let best = null;
  [['grey', GREY], ['brown', BROWN], ['yellow', YELLOW]].forEach(([color, list]) => list.forEach((kw) => {
    const k = normText(kw);
    if (lines.includes(k) && (!best || k.length > best.k.length)) best = { k, color };
  }));
  return best?.color || null;
}

// ------------------------------------------------------------------ text style (SEAN.jsx house style)
// The fonts as web fonts every computer has: Myriad Pro Bold Condensed → Barlow Condensed SemiBold,
// Helvetica Bold → Helvetica / Arial Bold, KaiTi → KaiTi or Noto Serif SC.
export const FONTS = {
  header: { family: '"Barlow Condensed", "Arial Narrow", sans-serif', weight: 600 },
  position: { family: '"Alfa Slab One", Georgia, serif', weight: 400 },
  line: { family: 'Helvetica, Arial, sans-serif', weight: 700 },
  cjk: { family: 'KaiTi, STKaiti, "Noto Serif SC", serif', weight: 400 },
};
const MIN_SIZE = 5;
const STEP = 0.5;
const POSITION_ONE_LINE = 11;
const POSITION_TWO_LINES = 9;
const TROFI = { header: 12, line: 12, position: 16, position2: 14 };
const HEADER_WORD_LIMIT = 5;
const LINE_GAP = 2; // POSITION_LINE_GAP
const POSITION_SPACE = 3; // POSITION_SPACE_PT
const CAP_HEIGHT = 0.72; // the ink of a capital line, as a share of the font size
const DEFAULT_ORDER = ['event_header', 'position', 'event_line_1', 'event_line_2'];
const STACK = ['event_header', 'year', 'position', 'event_line_1', 'event_line_2'];

// SEAN.jsx lineOrderFor: the row's line_order, then the missing default ones, year under the title
export function lineOrderFor(row) {
  const order = [...new Set(String(row.line_order || '').split('|').filter((f) => STACK.includes(f)))];
  DEFAULT_ORDER.forEach((f) => { if (!order.includes(f)) order.push(f); });
  if (!order.includes('year')) order.splice(order.indexOf('event_header') + 1, 0, 'year');
  return order;
}

const clean = (s) => String(s || '').replace(/\r\n?/g, '\n').trim();
const words = (s) => s.split(/[ \t]+/).filter(Boolean);

// the k-line split of `text` whose longest line is shortest (SEAN.jsx balancedLines)
function balanced(text, k, width) {
  const w = words(text);
  if (w.length < k) return null;
  let best = null;
  const go = (start, left, acc) => {
    if (left === 1) {
      const lines = [...acc, w.slice(start).join(' ')];
      const longest = Math.max(...lines.map(width));
      if (!best || longest < best.longest) best = { lines, longest };
      return;
    }
    for (let end = start + 1; end <= w.length - left + 1; end++) go(end, left - 1, [...acc, w.slice(start, end).join(' ')]);
  };
  go(0, k, []);
  return best.lines;
}

// largest size (from `size` down by 0.5 to `min`) at which every line fits `maxW`
function fit(lines, size, maxW, measure, min = MIN_SIZE) {
  let s = size;
  while (s > min && Math.max(...lines.map((l) => measure(l, s))) > maxW + 0.5) s = Math.round((s - STEP) * 100) / 100;
  return s;
}

function positionLines(text, maxW, measureAt, trofi) {
  const one = trofi ? TROFI.position : POSITION_ONE_LINE;
  const two = trofi ? TROFI.position2 : POSITION_TWO_LINES;
  let lines = text.includes('\n') ? text.split('\n') : null;
  const anugerah = /^(ANUGERAH)(?![\s ]+KHAS\b)[\s ]+(\S+\s+\S[\s\S]*)$/i.exec(text);
  if (!lines && anugerah) lines = [anugerah[1], anugerah[2]];
  if (!lines && measureAt(text, one) <= maxW) lines = [text];
  if (!lines) {
    const pengawas = /^PENGAWAS\s+(\S[\s\S]*)$/i.exec(text);
    lines = pengawas ? ['PENGAWAS', pengawas[1]] : balanced(text, 2, (l) => measureAt(l, two)) || [text];
  }
  const size = fit(lines, lines.length === 1 ? one : two, maxW, measureAt, 4);
  return { lines, size, leading: 12 * size / POSITION_ONE_LINE };
}

// one field's lines, font and size; null when the template has no frame for it
function fieldLayout(field, value, tpl, opts) {
  const { trofi, cjk, measure } = opts;
  const posFrame = () => {
    const c = rankColor(value);
    const rank = c && tpl.fields[`RANK_${c.toUpperCase()}`];
    return rank ? `RANK_${c.toUpperCase()}` : tpl.fields.position ? 'position' : null;
  };
  const frameName = field === 'position' ? posFrame() : tpl.fields[field] ? field : null;
  if (!frameName) return null;
  const frame = tpl.fields[frameName];
  const maxW = frame.box[2] - frame.box[0];
  const base = { field, frame, color: frame.color || '#000000', align: frame.justify || 'center' };
  if (cjk) {
    const font = FONTS.cjk;
    const lines = value.split('\n');
    const size = fit(lines, frame.size || 10, maxW, (l, s) => measure(l, s, font));
    return { ...base, lines, size, leading: size * 1.2, font };
  }
  if (field === 'position') {
    const font = FONTS.position;
    const measureAt = (l, s) => measure(l, s, font, 50);
    return { ...base, ...positionLines(value, maxW, measureAt, trofi), font, tracking: 50, stroke: 0.1 };
  }
  const isHeader = field === 'event_header' || field === 'year';
  const font = isHeader ? FONTS.header : FONTS.line;
  const start = trofi ? (isHeader ? TROFI.header : TROFI.line) : isHeader ? 9.5 : 9;
  let lines = value.split('\n');
  if (field === 'event_header' && lines.length === 1 && words(value).length > HEADER_WORD_LIMIT) {
    lines = [words(value).slice(0, HEADER_WORD_LIMIT).join(' '), words(value).slice(HEADER_WORD_LIMIT).join(' ')];
  }
  const bin = /^(.*?\S)\s+((?:BIN|BINTI)\s+\S[\s\S]*)$/i.exec(value);
  if (!isHeader && lines.length === 1 && bin && measure(value, start, font) > maxW) lines = [bin[1], bin[2]];
  const size = fit(lines, start, maxW, (l, s) => measure(l, s, font));
  const leading = isHeader ? (trofi ? 9 * start / 9.5 : 9) : lines.length > 1 ? size + 1 : (trofi ? 16 : 12);
  return { ...base, lines, size, leading, font };
}

// -> { fields: [{ field, lines, size, leading, font, color, align, x, baselines: [y…] }] } in pt around
// the anchor centre, y DOWN (ready for SVG). `measure(text, size, font, tracking)` = width in pt.
export function layoutPlaque(row, tpl, { trofi = false, measure }) {
  const cjk = templateNameFor(row).startsWith('TC');
  const laid = lineOrderFor(row)
    .map((f) => [f, clean(row[f])])
    .filter(([, v]) => v)
    .map(([f, v]) => fieldLayout(f, v, tpl, { trofi, cjk, measure }))
    .filter(Boolean);
  // stacked top to bottom with SEAN.jsx's gaps, each field a box of one leading per line with its capitals
  // in the middle of each, then the ink of the whole stack centred on the anchor
  let y = 0;
  const placed = laid.map((it, i) => {
    if (i > 0) {
      const up = laid[i - 1].field;
      let gap = up === 'event_line_1' && it.field === 'event_line_2' ? 0 : LINE_GAP;
      if (up === 'position' || it.field === 'position') gap += POSITION_SPACE;
      y += gap;
    }
    const baselines = it.lines.map((_, k) => y + k * it.leading + (it.leading + it.size * CAP_HEIGHT) / 2);
    y += it.lines.length * it.leading;
    const [l, , r] = it.frame.box;
    const x = it.align === 'left' ? l : it.align === 'right' ? r : (l + r) / 2;
    return { ...it, x, baselines };
  });
  if (!placed.length) return { fields: [] };
  const inkTop = placed[0].baselines[0] - placed[0].size * CAP_HEIGHT;
  const last = placed[placed.length - 1];
  const shift = -(inkTop + last.baselines[last.baselines.length - 1]) / 2;
  return { fields: placed.map(({ frame: _frame, ...it }) => ({ ...it, baselines: it.baselines.map((b) => b + shift) })) };
}
