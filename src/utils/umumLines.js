// UMUM (万能) sheet — which plaque field each CONTOH line ①–④ (Reference
// Sample slots '0'–'3') is engraved on. Shared by computeBlocks.js (which
// line shows red on screen), exportCsv.js (CSV columns + line_order).
//
// Sean's rules (2026-10-02):
//   - A line marked MERAH is the position; ① is the TAJUK BESAR; the rest,
//     top to bottom, are event_line_1 / event_line_2.
//   - Nothing marked MERAH: classify by keywords — school / MAJLIS / year
//     → TAJUK BESAR, ANUGERAH / TOKOH / JOHAN … → position (a line with
//     both counts as TAJUK BESAR); touching lines of the same kind join
//     into one two-line field. No title keyword anywhere: ① is the TAJUK
//     BESAR anyway (unless ① itself is a position line).
//   - Whatever is left, top to bottom: the first is event_line_1, the last
//     event_line_2 (any in between join line 1). Every AI template has a
//     position, so with none found the first leftover line becomes it; with
//     no keyword at all it's simply ① ② ③ ④.

export const UMUM_SLOTS = ['0', '1', '2', '3'];

const HEADER_RE = /\b(MAJLIS|HARI|SEKOLAH|SK|SJK|SJKC|SJKT|SMK|SMJK|SMKA|KOLEJ|(19|20)\d{2})\b|学校|典礼|颁奖|华小/i;
const POSITION_RE = /\b(ANUGERAH|TOKOH|JOHAN|NAIB|TEMPAT|PERTAMA|KEDUA|KETIGA|JUARA|TERBAIK)\b|冠军|亚军|季军|第.{1,3}名|奖/i;

function kindOf(text) {
  if (HEADER_RE.test(text)) return 'header';
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

// `contoh` = { '0': text, ... } (the CONTOH lines), `redSlot` = the slot
// marked MERAH ('' / undefined = none). Returns { slot: field } for every
// filled slot.
export function umumSlotFields(contoh, redSlot) {
  const slots = UMUM_SLOTS.filter((s) => String(contoh[s] || '').trim());
  const out = {};
  const taken = new Set();
  const assign = (list, field) => list.forEach((s) => { out[s] = field; taken.add(s); });

  if (redSlot && slots.includes(redSlot)) {
    assign([redSlot], 'position');
    if (redSlot !== slots[0]) assign([slots[0]], 'event_header');
  } else {
    const kinds = Object.fromEntries(slots.map((s) => [s, kindOf(contoh[s])]));
    if (!slots.some((s) => kinds[s])) {
      slots.forEach((s, i) => { out[s] = ['event_header', 'position', 'event_line_1', 'event_line_2'][i]; });
      return out;
    }
    assign(firstRun(slots, kinds, 'header', taken), 'event_header');
    if (!taken.size && !kinds[slots[0]]) assign([slots[0]], 'event_header');
    assign(firstRun(slots, kinds, 'position', taken), 'position');
    if (!Object.values(out).includes('position')) {
      const first = slots.find((s) => !taken.has(s));
      if (first) assign([first], 'position');
    }
  }
  const rest = slots.filter((s) => !taken.has(s));
  rest.forEach((s, i) => { out[s] = i === rest.length - 1 && i > 0 ? 'event_line_2' : 'event_line_1'; });
  return out;
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
