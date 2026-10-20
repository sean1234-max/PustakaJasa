// UMUM (ORDER LAIN-LAIN) sheet — which plaque field each CONTOH line ①–④ (Reference
// Sample slots '0'–'3') is engraved on. Shared by computeBlocks.js (which
// line shows red on screen), exportCsv.js (CSV columns + line_order).
//
// Sean's rules (2026-10-02):
//   - A line marked MERAH is the position; a MAJLIS / school / bare-year line
//     (keywords below) is the TAJUK BESAR wherever it sits, else ① is; the
//     rest, top to bottom, are event_line_1 / event_line_2. The plaque is
//     still stacked in the CONTOH's own order (CSV line_order).
//   - Nothing marked MERAH: classify by keywords — school / MAJLIS / year
//     → TAJUK BESAR, ANUGERAH / TOKOH / JOHAN … → position (a line with
//     both counts as TAJUK BESAR); touching lines of the same kind join
//     into one two-line field. No title keyword anywhere: ① is the TAJUK
//     BESAR anyway (unless ① itself is a position line).
//   - Whatever is left, top to bottom: the first is event_line_1, the last
//     event_line_2 (any in between join line 1). Every AI template has a
//     position, so with none found the first leftover line becomes it; with
//     no keyword at all it's simply ① ② ③ ④.
//   - Red (Sean, 2026-10-02): only the MERAH line, or — nothing ticked yet —
//     a line found by a position keyword (its MERAH box shows ticked). A
//     guessed position, or one the teacher unticked (UMUM_NO_RED), still
//     sits in the position spot but prints black (CSV position_black).
//   - Nothing marked MERAH (Sean, 2026-10-20): a place line below ①
//     (PERTAMA, TEMPAT KEDUA …) is the red position, as if ticked. With none,
//     a line with ANUGERAH (not a MAJLIS / HARI ANUGERAH title) is, even
//     when another keyword line comes first.

import { ANUGERAH_RE, PLACE_LINE_RE } from './positionWords';

export const UMUM_SLOTS = ['0', '1', '2', '3'];
// Stored in the umumRed line when the teacher unticks the red line.
export const UMUM_NO_RED = 'none';

const HEADER_RE = /\b(MAJLIS|HARI|SEKOLAH|SK|SJK|SJKC|SJKT|SMK|SMJK|SMKA|KOLEJ)\b|学校|典礼|颁奖|华小/i;
// A year joins the TAJUK BESAR only on a line of its own ("2026"); "TAHUN
// 2026" is a line of its own (Sean, 2026-10-12 — ORDER LAIN-LAIN only).
const YEAR_ONLY_RE = /^\s*(19|20)\d{2}\s*$/;
// Nor is a line with a year ("TAHUN 2026") ever the guessed position — the
// next line is taken instead (only when nothing is marked MERAH).
const HAS_YEAR_RE = /\b(19|20)\d{2}\b/;
const POSITION_RE = /\b(ANUGERAH|TOKOH|JOHAN|NAIB|TEMPAT|PERTAMA|KEDUA|KETIGA|JUARA|TERBAIK)\b|冠军|亚军|季军|第.{1,3}名|奖/i;

function kindOf(text) {
  if (HEADER_RE.test(text) || YEAR_ONLY_RE.test(text)) return 'header';
  if (POSITION_RE.test(text)) return 'position';
  return '';
}

// The run of consecutive slots of `kind` starting at its first occurrence.
function firstRun(slots, kinds, kind, taken) {
  const start = slots.findIndex((s) => kinds[s] === kind && !taken.has(s));
  if (start === -1) return [];
  const run = [];
  for (let i = start; i < slots.length && kinds[slots[i]] === kind && !taken.has(slots[i]); i++) run.push(slots[i]);
  return run;
}

// The CONTOH line red by default, below ①: a place line (PERTAMA, TEMPAT
// KEDUA …), else the first with ANUGERAH that isn't a title line, else ''
// (① with ANUGERAH is the ceremony's name).
export function umumDefaultRedSlot(contoh) {
  const below = UMUM_SLOTS.slice(1);
  return below.find((s) => PLACE_LINE_RE.test(String(contoh[s] || '').trim()))
    || below.find((s) => ANUGERAH_RE.test(String(contoh[s] || '')) && kindOf(String(contoh[s])) === 'position') || '';
}

// `contoh` = { '0': text, ... } (the CONTOH lines), `redSetting` = the slot
// marked MERAH ('' / undefined = none: an ANUGERAH line counts as marked). Returns { slot: field } for every
// filled slot.
export function umumSlotFields(contoh, redSetting) {
  const slots = UMUM_SLOTS.filter((s) => String(contoh[s] || '').trim());
  const out = {};
  const taken = new Set();
  const assign = (list, field) => list.forEach((s) => { out[s] = field; taken.add(s); });

  const kinds = Object.fromEntries(slots.map((s) => [s, kindOf(contoh[s])]));
  // A place line counts as ticked; an ANUGERAH line too when the keywords
  // would pick another.
  const auto = redSetting ? '' : umumDefaultRedSlot(contoh);
  const ticked = auto && (PLACE_LINE_RE.test(String(contoh[auto]).trim()) || !firstRun(slots, kinds, 'position', taken).includes(auto));
  const redSlot = redSetting || (ticked ? auto : '');
  if (redSlot && slots.includes(redSlot)) {
    assign([redSlot], 'position');
    // A MAJLIS / school / year line is the TAJUK BESAR wherever it sits
    // (Sean, 2026-10-07); with none, ① is (unless ① is the red line).
    const headerRun = firstRun(slots, kinds, 'header', taken);
    if (headerRun.length) assign(headerRun, 'event_header');
    else if (redSlot !== slots[0]) assign([slots[0]], 'event_header');
  } else {
    if (!slots.some((s) => kinds[s] || HAS_YEAR_RE.test(contoh[s]))) {
      slots.forEach((s, i) => { out[s] = ['event_header', 'position', 'event_line_1', 'event_line_2'][i]; });
      return out;
    }
    // Every line looks like a title (MAJLIS / SK / 2026 …) and none is marked
    // MERAH: ① is the TAJUK BESAR and the rest are line 1 / line 2 — no
    // position (Sean, 2026-10-12; SEAN.jsx makes its T_H_L1_L2 template).
    if (slots.length > 1 && slots.every((s) => kinds[s] === 'header')) {
      assign([slots[0]], 'event_header');
    } else {
      assign(firstRun(slots, kinds, 'header', taken), 'event_header');
      if (!taken.size && !kinds[slots[0]]) assign([slots[0]], 'event_header');
      assign(firstRun(slots, kinds, 'position', taken), 'position');
      if (!Object.values(out).includes('position')) {
        const left = slots.filter((s) => !taken.has(s));
        const first = left.find((s) => !HAS_YEAR_RE.test(contoh[s])) || left[0];
        if (first) assign([first], 'position');
      }
    }
  }
  const rest = slots.filter((s) => !taken.has(s));
  rest.forEach((s, i) => { out[s] = i === rest.length - 1 && i > 0 ? 'event_line_2' : 'event_line_1'; });
  return out;
}

// The slot(s) printed red — see the header note. `redSetting` is the stored
// umumRed value: a slot, UMUM_NO_RED, or '' (not touched: keywords decide).
export function umumRedSlots(contoh, redSetting) {
  if (redSetting === UMUM_NO_RED) return [];
  const fields = umumSlotFields(contoh, redSetting);
  if (redSetting && fields[redSetting] === 'position') return [redSetting];
  const auto = redSetting ? '' : umumDefaultRedSlot(contoh);
  if (auto && PLACE_LINE_RE.test(String(contoh[auto]).trim())) return [auto];
  return UMUM_SLOTS.filter((s) => fields[s] === 'position' && kindOf(String(contoh[s] || '')) === 'position');
}

// The text each slot is classified by: the CONTOH line, or — when the
// CONTOH leaves that line blank but a plak row fills it — the first row's
// own text, so a line only some rows have still lands somewhere.
export function umumClassifyText(contoh, rows) {
  return Object.fromEntries(UMUM_SLOTS.map((s) => {
    const own = (rows || []).map((r) => String(r[`l${s}`] || '').trim()).find((v) => v && v !== '-');
    return [s, String(contoh[s] || '').trim() || own || ''];
  }));
}
