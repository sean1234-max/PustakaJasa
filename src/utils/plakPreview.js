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
// the trophy code a Jenis Plak starts with, without its colour ("SR-116 A / BLUE" → "SR116A"; the colour
// is the trophy's, not the .ai's — Sean, 2026-11-02), the longest one ("W038 A" before "W038"); null if none
function trofiBase(code) {
  const k = trofiKey(code);
  if (!k) return null;
  return TROFI_CODES.map(trofiKey)
    .filter((t) => k === t || (k.startsWith(t) && !/[0-9]/.test(k.charAt(t.length))))
    .sort((a, b) => b.length - a.length)[0] || null;
}
function eCutForBase(code) {
  const c = String(code || '').toUpperCase();
  if (/\bBASE\s*WITH(OUT)?\s*COVER\b/.test(c)) return '11';
  const m = /\bBASE\s*([ABC])\b/.exec(c);
  return m ? { A: '8', B: '9', C: '10' }[m[1]] : null;
}

// A colour is the plaque's / trophy's own, never part of which .ai it uses (Sean, 2026-11-02): the code
// without its colour parts, everything else kept — "MP 399 / GOLD / BASE WITHOUT COVER" → "MP 399 / BASE
// WITHOUT COVER", "SR-116 A / BLUE" → "SR-116 A". Each step tries the code as written first.
const COLOURS = ['GOLD', 'SILVER', 'BRONZE', 'RED', 'BLUE'];
export const withoutColour = (code) => String(code || '').split('/').map((p) => p.trim())
  .filter((p) => p && !COLOURS.includes(p.toUpperCase())).join(' / ');

export function fileForCode(code, manifest) {
  const files = (manifest?.files || []).map((f) => f.file);
  const codes = [...new Set([code, withoutColour(code)])];
  const base = eCutForBase(code);
  const byBase = base !== null && files.find((f) => eCutNumber(f) === base);
  if (byBase) return byBase;
  const mapping = manifest?.mapping || [];
  const mapped = codes.map((c) => mapping.find(([m]) => squash(m) === squash(c))?.[1]).find((f) => f && files.includes(f));
  if (mapped) return mapped;
  const trofi = trofiBase(withoutColour(code));
  if (trofi) return files.find((f) => /TROFI/i.test(f) && trofiKey(f).includes(trofi)) || null;
  const n = eCutNumber(code);
  const byNumber = n !== null && files.find((f) => eCutNumber(f) === n);
  if (byNumber) return byNumber;
  return codes.map((c) => squash(c)).filter(Boolean).map((key) => files.find((f) => squash(f).includes(key))).find(Boolean) || null;
}

// ------------------------------------------------------------------ which layout group
const hasCjk = (s) => /[㐀-鿿豈-﫿]/.test(String(s || ''));
const TOKENS = [['H', 'event_header'], ['Y', 'year'], ['PC', 'position'], ['L1', 'event_line_1'], ['L2', 'event_line_2']];

export function templateNameFor(row) {
  const cjk = TOKENS.some(([, f]) => hasCjk(row[f]));
  return TOKENS.reduce((n, [tok, f]) => (String(row[f] || '') !== '' ? `${n}_${tok}` : n), cjk ? 'TC' : 'T');
}

// SEAN.jsx chooseTemplateSource: the exact group, else the same language's group with every line it
// needs and the fewest extra (an extra L line costs 10, any other 11); a Chinese (TC_) one with no TC_
// group to make it from is made from its T_ twin (SEAN.jsx makeMissingTemplate, 2026-11-17)
export function pickTemplate(templates, name) {
  if (templates?.[name]) return name;
  const same = pickSameLanguage(templates, name);
  return same || (name.startsWith('TC_') ? pickTemplate(templates, `T${name.slice(2)}`) : null);
}
function pickSameLanguage(templates, name) {
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

// SEAN.jsx moveLoneLine2ToLine1: a row whose only wording is event_line_2 is laid out as event_line_1
const ALL_LINES = ['event_header', 'year', 'position', 'event_line_1', 'event_line_2', 'event_line_3'];
export function moveLoneLine2ToLine1(row) {
  const lone = String(row.event_line_2 || '') !== '' && ALL_LINES.every((f) => f === 'event_line_2' || String(row[f] || '') === '');
  return lone ? { ...row, event_line_1: row.event_line_2, event_line_2: '' } : row;
}

// the row (lone line 2 moved up) and its layout group in a templates.json entry; null when none fits.
// chineseFromT: a Chinese row on a T_ group (KaiTi, line 2 / 3 sized like line 1)
export function templateFor(entry, rawRow) {
  const row = moveLoneLine2ToLine1(rawRow);
  const wanted = templateNameFor(row);
  const name = entry && pickTemplate(entry.templates, wanted);
  if (!name) return null;
  return { row, name, template: entry.templates[name], chineseFromT: wanted.startsWith('TC') && name.startsWith('T_') };
}

// ------------------------------------------------------------------ position colour (SEAN.jsx getRankColor)
const YELLOW = ['JOHAN', 'CHAMPION', '1ST PLACE', 'FIRST PLACE', 'PERTAMA', 'TEMPAT PERTAMA', 'JUARA 1', 'JUARA PERTAMA',
  'GOLD', '1ST', 'THE CHAMPION', 'EMAS', 'ANUGERAH EMAS', 'PLATINUM', 'ANUGERAH PLATINUM', '冠军', '第一名', '一等奖', '金奖'];
const GREY = ['NAIB JOHAN', '1ST RUNNER-UP', '1ST RUNNER UP', 'KEDUA', 'TEMPAT KEDUA', 'JUARA 2', 'JUARA KEDUA',
  'SILVER', '2ND PLACE', 'SECOND PLACE', '2ND', 'PERAK', 'ANUGERAH PERAK', '亚军', '第二名', '二等奖', '银奖'];
const BROWN = ['KETIGA', 'TEMPAT KETIGA', '2ND RUNNER-UP', '2ND RUNNER UP', 'JUARA 3', 'JUARA KETIGA', 'KE-3', 'KE 3',
  'GANGSA', 'ANUGERAH GANGSA', 'BRONZE', '3RD PLACE', 'THIRD PLACE', '3RD', '季军', '第三名', '三等奖', '铜奖', '殿军',
  '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名', '优秀奖', '优胜奖', 'KEEMPAT', 'KELIMA', 'KEENAM',
  'KETUJUH', 'KELAPAN', 'KESEMBILAN', 'KESEPULUH', 'SAGU HATI', 'SAGUHATI', 'CONSOLATION PRIZE', 'CONSOLATION', '4TH', '5TH', '6TH',
  '7TH', '8TH', '9TH', '10TH', ...Array.from({ length: 27 }, (_, i) => `KE-${i + 4}`),
  // 3RD … 9TH RUNNER UP (with or without "-"), as in SEAN.jsx (Sean, 2026-11-18)
  ...['3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH'].flatMap((n) => [`${n} RUNNER UP`, `${n} RUNNER-UP`])];
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
  // a one-line plaque: Times New Roman Bold (Tinos = the same widths, for computers without it)
  single: { family: '"Times New Roman", Tinos, Times, serif', weight: 700 },
};
const MIN_SIZE = 5;
const STEP = 0.5;
const POSITION_ONE_LINE = 11;
const POSITION_TWO_LINES = 9;
const TROFI = { header: 12, line: 12, position: 16, position2: 14 };
// SEAN.jsx HOUSE_TEXT_STYLE.position: tracking 75, black stroke 0.2pt (Sean, 2026-11-16) — change both
const POSITION_TRACKING = 75;
const POSITION_STROKE = 0.2;
const HEADER_WORD_LIMIT = 5;
// SEAN.jsx: every box its letters + 4pt above and below, boxes edge to edge — 8pt ink to ink (Sean 2026-11-16/18);
// event_line_1 and event_line_2 closer, 4pt (EVENT_LINE_INK_GAP_PT, Sean 2026-11-19)
const LINE_INK_GAP_PT = 8;
const EVENT_LINE_INK_GAP_PT = 4;
const gapBetween = (up, down) => ([up.field, down.field].sort().join() === 'event_line_1,event_line_2' ? EVENT_LINE_INK_GAP_PT : LINE_INK_GAP_PT);
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

// SEAN.jsx applyShortPosLine1Only (Sean 2026-11-19): a position of ≤ 3 words with other lines — 14pt, leading 15,
// on 1 or 2 lines, smaller only when it doesn't fit
const SHORT_POS_SIZE = 14;
const SHORT_POS_LEADING = 15;
function positionLines(text, maxW, measureAt, trofi, shortPos) {
  const one = shortPos ? SHORT_POS_SIZE : trofi ? TROFI.position : POSITION_ONE_LINE;
  const two = shortPos ? SHORT_POS_SIZE : trofi ? TROFI.position2 : POSITION_TWO_LINES;
  let lines = text.includes('\n') ? text.split('\n') : null;
  const anugerah = /^(ANUGERAH)(?![\s ]+KHAS\b)[\s ]+(\S+\s+\S[\s\S]*)$/i.exec(text);
  if (!lines && anugerah) lines = [anugerah[1], anugerah[2]];
  if (!lines && measureAt(text, one) <= maxW) lines = [text];
  if (!lines) {
    const pengawas = /^PENGAWAS\s+(\S[\s\S]*)$/i.exec(text);
    lines = pengawas ? ['PENGAWAS', pengawas[1]] : balanced(text, 2, (l) => measureAt(l, two)) || [text];
  }
  const size = fit(lines, lines.length === 1 ? one : two, maxW, measureAt, 4);
  return { lines, size, leading: shortPos ? size + SHORT_POS_LEADING - SHORT_POS_SIZE : 12 * size / POSITION_ONE_LINE };
}

// one field's lines, font and size; null when the template has no frame for it
function fieldLayout(field, value, tpl, opts) {
  const { trofi, cjk, measure, rankColors, chineseFromT, lone, shortPos } = opts;
  const posFrame = () => {
    const c = rankColors && field !== lone && rankColor(value);
    const rank = c && tpl.fields[`RANK_${c.toUpperCase()}`];
    return rank ? `RANK_${c.toUpperCase()}` : tpl.fields.position ? 'position' : null;
  };
  const frameName = field === 'position' ? posFrame() : tpl.fields[field] ? field : null;
  if (!frameName) return null;
  const frame = tpl.fields[frameName];
  const maxW = frame.box[2] - frame.box[0];
  // a one-line plaque's line is black (SEAN.jsx, Sean 2026-11-18)
  const base = { field, frame, color: field === lone ? '#000000' : frame.color || '#000000', align: frame.justify || 'center' };
  if (cjk) {
    const font = FONTS.cjk;
    const lines = value.split('\n');
    const own = chineseFromT && /^event_line_[23]$/.test(field) ? tpl.fields.event_line_1 || frame : frame;
    const size = fit(lines, own.size || 10, maxW, (l, s) => measure(l, s, font));
    return { ...base, lines, size, leading: size * 1.2, font };
  }
  if (field === 'position') {
    const font = field === lone ? FONTS.single : FONTS.position;
    const measureAt = (l, s) => measure(l, s, font, POSITION_TRACKING);
    return { ...base, ...positionLines(value, maxW, measureAt, trofi, shortPos), font, tracking: POSITION_TRACKING, stroke: POSITION_STROKE };
  }
  const isHeader = field === 'event_header' || field === 'year';
  const font = field === lone ? FONTS.single : isHeader ? FONTS.header : FONTS.line;
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
// rankColors: false on a plaque with a background — JOHAN stays red there (SEAN.jsx, Sean 2026-11-02)
export function layoutPlaque(row, tpl, { trofi = false, measure, rankColors = true, chineseFromT = false }) {
  const cjk = templateNameFor(row).startsWith('TC');
  const roundMedal = !!(tpl.fields.event_header?.path || tpl.fields.year?.path);
  const lone = roundMedal ? null : loneLineField(row);
  const laid = lineOrderFor(row)
    .map((f) => [f, clean(row[f])])
    .filter(([, v]) => v)
    .map(([f, v]) => fieldLayout(f, v, tpl, { trofi, cjk, measure, rankColors, chineseFromT, lone, shortPos: !trofi && !roundMedal && isShortPos(row) }))
    .filter(Boolean);
  if (tpl.textArea && laid.length) return { fields: layoutInTextArea(laid, tpl.textArea, row, { measure, lone }) };
  if (!laid.length) return { fields: [] };
  // stacked ink to ink with SEAN.jsx's gaps, the whole stack centred on the anchor
  const { placed, height } = stackInk(laid.map((it) => ({ ...it, x: xOf(it) })));
  return { fields: placed.map(({ frame: _frame, ...it }) => ({ ...it, baselines: it.baselines.map((b) => b - height / 2) })) };
}

const xOf = (it) => {
  const [l, , r] = it.frame.box;
  return it.align === 'left' ? l : it.align === 'right' ? r : (l + r) / 2;
};
// the lines top to bottom, gapBetween each two (ink to ink), y down from the stack's top -> { placed, height }
function stackInk(items) {
  let top = 0;
  const placed = items.map((it, i) => {
    if (i > 0) top += gapBetween(items[i - 1], it);
    const first = top + it.size * CAP_HEIGHT;
    top += inkHeight(it);
    return { ...it, baselines: it.lines.map((_, k) => first + k * it.leading) };
  });
  return { placed, height: top };
}

// ------------------------------------------------------------------ TEXT_AREA (SEAN.jsx fitStackInTextArea)
// One-line plaque (SEAN.jsx loneLineField / SINGLE_LINE_*, Sean 2026-11-17/18): the only wording is the TAJUK,
// the position, line 1 or line 2, not Chinese — Times New Roman Bold, black (a position without its rank colour),
// its box as wide as TEXT_AREA, leading size + 1, grown 0.5pt at a time up to 24pt; one full line is also tried as
// two even lines, kept when ≥ 2pt bigger.
const SINGLE_LINE_FIELDS = ['event_header', 'position', 'event_line_1', 'event_line_2'];
const SINGLE_LINE_MAX_PT = 24;
const SINGLE_LINE_TWO_GAIN_PT = 2;
const SINGLE_LINE_INSET = 0.02;
const TEXT_AREA_FIT_TRIES = 4;
const POSITION_GROW_MAX_PT = 6;
const HEADER_POS_ONLY_MAX_PT = 15;
const SHORT_POS_MAX_WORDS = 3;
const filled = (row, f) => String(row[f] || '') !== '';

function loneLineField(row) {
  const used = ALL_LINES.filter((f) => filled(row, f));
  return used.length === 1 && SINGLE_LINE_FIELDS.includes(used[0]) && !hasCjk(row[used[0]]) ? used[0] : null;
}
const onlyThese = (row, fields) => ALL_LINES.every((f) => fields.includes(f) || !filled(row, f));
// SEAN.jsx isShortPosLine1Only (Sean 2026-11-19): a position of ≤ 3 words with other lines — 14pt, never grown
const isShortPos = (row) => filled(row, 'position') && !onlyThese(row, ['position'])
  && clean(row.position).split(/[\s ]+/).length <= SHORT_POS_MAX_WORDS;
// SEAN.jsx headerPosOnlyCap: TAJUK + position only — the position at most 15pt
const headerPosOnly = (row) => filled(row, 'position') && filled(row, 'event_header') && onlyThese(row, ['position', 'event_header']);

const step = (s, d) => Math.round((s + d) * 100) / 100;
const inkHeight = (it) => (it.lines.length - 1) * it.leading + it.size * CAP_HEIGHT;
const inkWidth = (it, measure) => Math.max(...it.lines.map((l) => measure(l, it.size, it.font, it.tracking || 0)));
const scaled = (it, k) => ({ ...it, size: it.size * k, leading: it.leading * k });

// greedy word wrap of each paragraph at `width` (Illustrator's area type)
function wrap(paras, size, width, measureAt) {
  return paras.flatMap((p) => words(p).reduce((lines, w) => {
    const last = lines[lines.length - 1];
    if (last !== undefined && measureAt(`${last} ${w}`, size) <= width) return [...lines.slice(0, -1), `${last} ${w}`];
    return [...lines, w];
  }, []));
}

// the lone line in a box `width` wide: shrunk until every word shows, then grown while it keeps ≤ `cap` lines
// and fits `height` -> { lines, size }
function growLone(paras, size, width, height, measureAt, cap) {
  const ok = (s) => {
    const lines = wrap(paras, s, width, measureAt);
    return lines.length <= cap && lines.every((l) => measureAt(l, s) <= width) && (lines.length - 1) * (s + 1) + s * CAP_HEIGHT <= height;
  };
  let s = size;
  while (s - STEP >= 4 && wrap(paras, s, width, measureAt).some((l) => measureAt(l, s) > width)) s = step(s, -STEP);
  while (s + STEP <= SINGLE_LINE_MAX_PT + 0.001 && ok(step(s, STEP))) s = step(s, STEP);
  return { lines: wrap(paras, s, width, measureAt), size: s };
}

function loneInTextArea(it, area, measure) {
  const width = (area[2] - area[0]) * (1 - 2 * SINGLE_LINE_INSET);
  const height = area[1] - area[3];
  const measureAt = (l, s) => measure(l, s, it.font, it.tracking || 0);
  const paras = it.lines;
  const start = wrap(paras, it.size, width, measureAt).length;
  let best = growLone(paras, it.size, width, height, measureAt, start < 3 ? start : Infinity);
  const two = best.lines.length === 1 && balanced(best.lines[0], 2, (l) => measureAt(l, best.size));
  if (two) {
    const twoBest = growLone(two, best.size, width, height, measureAt, 2);
    if (twoBest.lines.length === 2 && twoBest.size >= best.size + SINGLE_LINE_TWO_GAIN_PT) best = twoBest;
  }
  return { ...it, lines: best.lines, size: best.size, leading: best.size + 1, x: (area[0] + area[2]) / 2, align: 'center' };
}

// the lines top to bottom, gapBetween each two (ink to ink), shrunk together to fit TEXT_AREA
// (again, as the gaps don't shrink), a one-line position grown into the room left, the stack centred on the anchor
function layoutInTextArea(laid, area, row, { measure, lone }) {
  const areaW = area[2] - area[0];
  const areaH = area[1] - area[3];
  let items = laid.map((it) => ({ ...it, x: xOf(it) }));
  if (lone && items.length === 1) items = [loneInTextArea(items[0], area, measure)];
  const heightOf = (list) => stackInk(list).height;
  const widthOf = (list) => Math.max(...list.map((it) => inkWidth(it, measure)));
  for (let t = 0; t < TEXT_AREA_FIT_TRIES; t++) {
    const factor = Math.min(areaH / heightOf(items), areaW / widthOf(items));
    if (factor >= 1) break;
    items = items.map((it) => scaled(it, factor * 0.98));
  }
  const pos = items.findIndex((it) => it.field === 'position');
  // (a lone position has already grown, up to SINGLE_LINE_MAX_PT)
  if (pos !== -1 && lone !== 'position' && items[pos].lines.length === 1 && !isShortPos(row)) {
    const cap = headerPosOnly(row) ? HEADER_POS_ONLY_MAX_PT : Infinity;
    const frameW = items[pos].frame.box[2] - items[pos].frame.box[0];
    const start = items[pos].size;
    for (let s = step(start, STEP); s <= Math.min(start + POSITION_GROW_MAX_PT, cap) + 0.001; s = step(s, STEP)) {
      const next = items.map((it, i) => (i === pos ? scaled(it, s / it.size) : it));
      if (inkWidth(next[pos], measure) > frameW || heightOf(next) > areaH || widthOf(next) > areaW) break;
      items = next;
    }
  }
  // y down from the stack's top, then the ink centred on the anchor (and across it)
  const { placed, height } = stackInk(items);
  const dy = -height / 2;
  const spans = placed.map((it) => {
    const w = inkWidth(it, measure);
    return it.align === 'left' ? [it.x, it.x + w] : it.align === 'right' ? [it.x - w, it.x] : [it.x - w / 2, it.x + w / 2];
  });
  const dx = -(Math.min(...spans.map((s) => s[0])) + Math.max(...spans.map((s) => s[1]))) / 2;
  return placed.map(({ frame: _frame, ...it }) => ({ ...it, x: it.x + dx, baselines: it.baselines.map((b) => b + dy) }));
}
