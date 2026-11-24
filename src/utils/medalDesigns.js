// Medal designs (Sean, 2026-11-24): every "DESIGN <n>" group in E CUT 0 is one medal design. The MEDAL DESIGNS
// page reads them through the AI File helper (v8) and keeps one medal_designs row each (migration 0129).
// These are the page's pure rules; the Supabase calls are in lib/medalDesignsApi.js.

const designNumber = (name) => Number(/^DESIGN (\d+)$/.exec(String(name || ''))?.[1] ?? Infinity);
export const byDesignNumber = (a, b) => designNumber(a.name ?? a.design) - designNumber(b.name ?? b.design);

/** the order salesmen see them in: sort_order, then DESIGN number */
export const sortDesigns = (rows) => [...rows].sort((a, b) => (a.sort_order - b.sort_order) || byDesignNumber(a, b));

/** what a salesman may pick: published and still in E CUT 0 */
export const isPickable = (row) => !row.hidden && row.in_file;

/** the name salesmen see */
export const designLabel = (row) => String(row.label || '').trim() || row.name;

const MEDAL_FIELDS = ['event_header', 'year', 'position', 'event_line_1', 'event_line_2'];
/** the medal lines a design has a place for, in any of its layout groups (a RANK_ colour frame is the position) */
export const designLines = (templates) => new Set(Object.values(templates || {})
  .flatMap((t) => Object.keys(t.fields || {}).map((f) => (f.startsWith('RANK_') ? 'position' : f))));

/** a CSV row (object) without the lines the design has no place for — they aren't printed (SEAN.jsx does the same) */
export function rowForDesign(row, templates) {
  const has = designLines(templates);
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, MEDAL_FIELDS.includes(k) && !has.has(k) ? '' : v]));
}

/**
 * One exported design with its picture names swapped for their stored names ({ "DESIGN-1-thumb.png": "<sha1>.png" }).
 * @returns {{ main: string, thumb: string, picture: object|null, templates: object }}
 */
export function storedPreview(design, storedName) {
  const rename = (png) => storedName[png] || png;
  const templates = Object.fromEntries(Object.entries(design.templates || {}).map(([k, t]) => [
    k, t.art ? { ...t, art: { ...t.art, png: rename(t.art.png) } } : t,
  ]));
  return {
    main: design.main,
    thumb: rename(design.thumb),
    picture: design.picture ? { ...design.picture, png: rename(design.picture.png) } : null,
    templates,
  };
}

/**
 * The rows to save after reading E CUT 0: a design already known keeps its label / hidden / order and gets the
 * new preview; a new one comes in hidden after the others; a known one no longer in the file is kept, in_file false.
 * @param {Array<{name: string, label: string, hidden: boolean, sort_order: number, in_file: boolean}>} existing
 * @param {Array<{design: string}>} exported  the helper's designs, pictures already renamed by storedPreview
 * @param {(design: object) => object} previewOf
 * @returns {{ rows: object[], added: string[], gone: string[] }}
 */
export function mergeDesignRows(existing, exported, previewOf) {
  const known = new Map(existing.map((r) => [r.name, r]));
  const inFile = new Set(exported.map((d) => d.design));
  let next = existing.reduce((m, r) => Math.max(m, r.sort_order), 0);
  const added = [];
  const fromFile = [...exported].sort(byDesignNumber).map((d) => {
    const old = known.get(d.design);
    if (!old) added.push(d.design);
    return old
      ? { name: d.design, label: old.label, hidden: old.hidden, sort_order: old.sort_order, in_file: true, preview: previewOf(d) }
      : { name: d.design, label: '', hidden: true, sort_order: (next += 1), in_file: true, preview: previewOf(d) };
  });
  const gone = existing.filter((r) => !inFile.has(r.name) && r.in_file).map((r) => r.name);
  const goneRows = existing.filter((r) => gone.includes(r.name)).map(({ name, label, hidden, sort_order, preview }) => (
    { name, label, hidden, sort_order, in_file: false, preview }
  ));
  return { rows: [...fromFile, ...goneRows], added, gone };
}

/**
 * Moving a design one place left (-1) or right (+1) among `rows` (in shown order) → the rows whose sort_order
 * changes, numbered 1… in the new order.
 */
export function moveDesign(rows, name, step) {
  const order = sortDesigns(rows).map((r) => r.name);
  const from = order.indexOf(name);
  const to = from + step;
  if (from === -1 || to < 0 || to >= order.length) return [];
  const moved = [...order];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  const byName = new Map(rows.map((r) => [r.name, r]));
  return moved.map((n, i) => ({ name: n, sort_order: i + 1 })).filter((r) => byName.get(r.name).sort_order !== r.sort_order);
}
