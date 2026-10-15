// Which Reference Sample rows engrave red (Sean, 2026-10-15): Production ticks
// MERAH beside each row while reviewing an order. Ticked rows make up the red
// position line (two ticked rows: the first, Alt+Enter, the second); the rows
// left unticked print black, as line 1 / line 2 — at most two of them (the
// title row is always black and doesn't count). Nothing ticked: the first row
// prints in the position frame, black (position_black, like UMUM).
// Stored per block as lines[`<cat>::<block>::redLines`]: "3", "2,3" or "none";
// absent = the sheet's own layout, untouched.
import { DEFAULT_REF_ORDER } from '../data/catalog';

export const RED_LINES_SUFFIX = 'redLines';
const NO_RED = 'none';
const HEADER_SLOTS = new Set(['0', '0b']);
const MAX_BLACK = 2;

// Which engraved field(s) each Reference Sample row (slotId) ends up on —
// mirrors exportCsv.js's build*Rows mapping. null = no draggable sample.
export function slotFieldsFor(cat) {
  const header = { 0: ['event_header'], '0b': ['event_header'] };
  // ALIRAN: ordinal (slot 3) -> position, ACARA -> line 1, TAHUN -> line 2.
  if (cat?.aliranKedudukan) return { ...header, 3: ['position'], 2: ['event_line_1'], '2b': ['event_line_2'] };
  // PBD: ACARA (+ its second box) -> position, "TAHUN 1 <kelas>" -> line 1.
  if (cat?.mode === 'matrix' && cat.levelBreakdownAxis === 'subject') return { ...header, 2: ['position'], '2b': ['position'], 3: ['event_line_1'] };
  // PPKI / MP THP: line 3's CONTOH lays out the subject + Tahun lines
  // together (buildMatrixRows), so they move as one block.
  if (cat?.mode === 'matrix') return { ...header, 2: ['position'], 3: ['event_line_1', 'event_line_2'] };
  // LONJAKAN / KEHADIRAN (TAHUN) and TOKOH (NAMA MURID) -> line 1.
  if (cat?.positionFromRows) return { ...header, 2: ['position'], '2b': ['position'], 3: ['event_line_1'] };
  return null;
}

// The block's visible Reference Sample rows, top to bottom (refOrder, then the
// category's default order), hidden ones left out.
export function visibleRefSlots(lines, prefix, cat) {
  const hidden = new Set((lines[`${prefix}hiddenLines`] || '').split(',').filter(Boolean));
  const stored = (lines[`${prefix}refOrder`] || '').split(',').filter(Boolean);
  return [...new Set([...stored, ...(cat?.defaultRefOrder || DEFAULT_REF_ORDER)])].filter((s) => !hidden.has(s));
}

// The body rows (not the title) as engraved units: rows feeding the same
// field(s) (PBD's ACARA + its second box) move together.
function bodyUnits(lines, prefix, cat) {
  const slotFields = slotFieldsFor(cat);
  if (!slotFields) return [];
  return visibleRefSlots(lines, prefix, cat).reduce((units, slot) => {
    const fields = slotFields[slot];
    if (!fields || HEADER_SLOTS.has(slot)) return units;
    const same = units.find((u) => u.fields.join() === fields.join());
    return same
      ? units.map((u) => (u === same ? { ...u, slots: [...u.slots, slot] } : u))
      : [...units, { slots: [slot], fields }];
  }, []);
}

// The ticked rows: Production's own, or null when untouched (the sheet's layout).
export function storedRedSlots(lines, prefix) {
  const raw = lines[`${prefix}${RED_LINES_SUFFIX}`];
  if (raw === undefined || raw === null || raw === '') return null;
  return raw === NO_RED ? [] : String(raw).split(',').filter(Boolean);
}

// The rows that print red now: Production's ticks, else the rows on the position line.
export function redSlotsOf(lines, prefix, cat) {
  return storedRedSlots(lines, prefix)
    ?? bodyUnits(lines, prefix, cat).filter((u) => u.fields.includes('position')).flatMap((u) => u.slots);
}

// Too many black rows for the plaque's two black lines — the message, or ''.
export function redLinesProblem(lines, prefix, cat) {
  if (!storedRedSlots(lines, prefix)) return '';
  const red = new Set(redSlotsOf(lines, prefix, cat));
  const units = bodyUnits(lines, prefix, cat);
  const black = units.filter((u) => !u.slots.some((s) => red.has(s))).length;
  const allowed = units.length > black ? MAX_BLACK : MAX_BLACK + 1; // nothing red: one prints in the position frame
  return black > allowed ? `Too many black rows (${black}) — a plaque has room for ${allowed}. Tick MERAH on another row.` : '';
}

// MERAH beside a body row: { checked, value } — `value` is what ticking /
// unticking stores (the whole new list), null for a row with no checkbox.
export function redPickFor(lines, prefix, cat, slotId) {
  if (HEADER_SLOTS.has(slotId)) return null;
  const units = bodyUnits(lines, prefix, cat);
  const unit = units.find((u) => u.slots.includes(slotId));
  if (!unit) return null;
  const red = redSlotsOf(lines, prefix, cat);
  const checked = unit.slots.some((s) => red.includes(s));
  const next = checked ? red.filter((s) => !unit.slots.includes(s)) : [...red, ...unit.slots];
  const ordered = visibleRefSlots(lines, prefix, cat).filter((s) => next.includes(s));
  return { checked, value: ordered.length ? ordered.join(',') : NO_RED };
}

// One CSV row ([header, year, position, line 1, line 2]) rearranged by the
// ticks, plus the line order and position_black for it. null when untouched.
export function applyRedLines(row, lines, prefix, cat) {
  const red = storedRedSlots(lines, prefix);
  if (!red) return null;
  const units = bodyUnits(lines, prefix, cat);
  if (!units.length) return null;
  const value = { position: row[2], event_line_1: row[3], event_line_2: row[4] };
  const textOf = (u) => u.fields.map((f) => value[f]).filter(Boolean).join('\n');
  const redUnits = units.filter((u) => u.slots.some((s) => red.includes(s)));
  const blackUnits = units.filter((u) => !redUnits.includes(u));
  const posUnits = redUnits.length ? redUnits : blackUnits.slice(0, 1);
  const lineUnits = redUnits.length ? blackUnits : blackUnits.slice(1);
  const fieldOf = new Map([
    ...posUnits.map((u) => [u, 'position']),
    ...lineUnits.map((u, i) => [u, i === 0 ? 'event_line_1' : 'event_line_2']),
  ]);
  const order = [];
  visibleRefSlots(lines, prefix, cat).forEach((slot) => {
    const field = HEADER_SLOTS.has(slot) ? 'event_header' : fieldOf.get(units.find((u) => u.slots.includes(slot)));
    if (field && !order.includes(field)) order.push(field);
  });
  ['event_header', 'position', 'event_line_1', 'event_line_2'].forEach((f) => { if (!order.includes(f)) order.push(f); });
  return {
    row: [row[0], row[1],
      posUnits.map(textOf).filter(Boolean).join('\n'),
      lineUnits.slice(0, 1).map(textOf).join(''),
      lineUnits.slice(1).map(textOf).filter(Boolean).join('\n')],
    lineOrder: order.join('|'),
    positionBlack: redUnits.length ? '' : '1',
  };
}
