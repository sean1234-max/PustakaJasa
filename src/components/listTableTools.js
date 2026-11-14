import { useState, useEffect } from 'react';
import { isCustomPlakCode } from '../data/catalog';

// Excel-like tools for OrderCategoryBlock's list table (ORDER LAIN-LAIN, TOKOH, …) — Sean, 2026-11-14:
// drag a column header's edge to widen it (double-click: fit its longest text), and drag a cell's
// corner handle down to copy it to the rows below (double-click: to the last row).

const MIN_COL = 48;
const MAX_COL = 700;
const clampWidth = (w) => Math.round(Math.min(MAX_COL, Math.max(MIN_COL, w)));

// Widths live on this browser (per table layout), like a remembered tab — nothing the order needs.
function readWidths(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}
function writeWidths(key, widths) {
  try { localStorage.setItem(key, JSON.stringify(widths)); } catch { /* storage blocked: just not kept */ }
}

// every header cell's width now, so a fixed layout keeps the columns nobody dragged as they were
const headerWidths = (th) => Object.fromEntries([...th.parentElement.children]
  .filter((c) => c.dataset.col)
  .map((c) => [c.dataset.col, Math.round(c.getBoundingClientRect().width)]));

/**
 * @param {string[]} colKeys the table's columns, left to right (each <th> carries data-col={key})
 */
export function useColumnWidths(colKeys) {
  const storageKey = `pj.colWidths:${colKeys.join('|')}`;
  const [widths, setWidths] = useState(() => readWidths(storageKey));
  useEffect(() => { setWidths(readWidths(storageKey)); }, [storageKey]);
  const save = (next) => { setWidths(next); writeWidths(storageKey, next); };

  const startResize = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest('th');
    const base = headerWidths(th);
    const startX = e.clientX;
    let next = base;
    const move = (ev) => {
      next = { ...base, [key]: clampWidth(base[key] + ev.clientX - startX) };
      setWidths(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      writeWidths(storageKey, next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Double-click: as wide as the column's longest text (each line of a multi-line cell).
  const autoFit = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest('th');
    const ctx = document.createElement('canvas').getContext('2d');
    const textWidth = (el, text) => {
      ctx.font = getComputedStyle(el).font;
      return Math.max(0, ...String(text).split('\n').map((line) => ctx.measureText(line).width));
    };
    let w = th.scrollWidth;
    for (const tr of th.closest('table').tBodies[0]?.rows || []) {
      const td = tr.cells[th.cellIndex];
      if (!td) continue;
      const field = td.querySelector('input, textarea, select');
      w = Math.max(w, field ? textWidth(field, field.value || field.placeholder || '') + 34 : td.scrollWidth);
    }
    save({ ...headerWidths(th), [key]: clampWidth(w) });
  };

  const fixed = colKeys.every((k) => widths[k] > 0);
  return {
    widthOf: (key) => (fixed ? widths[key] : undefined),
    tableStyle: fixed ? { tableLayout: 'fixed', width: colKeys.reduce((s, k) => s + widths[k], 0) } : undefined,
    resized: fixed,
    reset: () => save({}),
    startResize,
    autoFit,
  };
}

// One list-table cell: its value, and how to copy another row's value into it.
export function listCell(row, key) {
  if (!row) return null;
  if (key === 'qty') return { value: row.qty, copy: (src) => row.setQty(src.qty) };
  if (key === 'desc') return { value: row.desc, copy: (src) => row.setDesc(src.desc) };
  if (key === 'jenisPlak') {
    if (!row.setJenisPlak) return null;
    // an "OTHER - …" code carries its own price; a catalog code is priced by the website
    return { value: row.jenisPlak, copy: (src) => row.setJenisPlak(src.jenisPlak, isCustomPlakCode(src.jenisPlak) ? src.unitPrice : undefined) };
  }
  const fieldOf = (r) => [...(r.extraRefValues || []), ...(r.tokohFields || [])].find((f) => f.key === key && !f.readOnly);
  const f = fieldOf(row);
  return f ? { value: f.value, copy: (src) => f.onChange(fieldOf(src)?.value ?? '') } : null;
}

const isBlank = (v) => String(v ?? '').trim() === '';

/**
 * Excel's fill handle over `rows` (the table's rows as shown, each <tr> carrying data-row-idx).
 */
export function useFillHandle(rows) {
  const [active, setActive] = useState(null); // { id, key } — the cell showing the handle
  const [drag, setDrag] = useState(null); // { key, from, to } — row indexes while dragging

  const fillRange = (key, from, to) => {
    const src = rows[from];
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      if (i !== from) listCell(rows[i], key)?.copy(src);
    }
  };

  const startDrag = (e, key, from) => {
    e.preventDefault();
    e.stopPropagation();
    const tbody = e.currentTarget.closest('tbody');
    let to = from;
    setDrag({ key, from, to });
    const move = (ev) => {
      if (ev.clientY > window.innerHeight - 40) window.scrollBy(0, 24);
      else if (ev.clientY < 40) window.scrollBy(0, -24);
      const tr = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('tr[data-row-idx]');
      if (!tr || tr.parentElement !== tbody) return;
      to = Number(tr.dataset.rowIdx);
      setDrag({ key, from, to });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (to !== from) fillRange(key, from, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return {
    isActive: (id, key) => active?.id === id && active.key === key,
    focus: (id, key) => setActive({ id, key }),
    inDrag: (key, idx) => !!drag && drag.key === key && idx >= Math.min(drag.from, drag.to) && idx <= Math.max(drag.from, drag.to),
    startDrag,
    fillToEnd: (key, from) => fillRange(key, from, rows.length - 1),
    // the first filled row's value into every blank row (the phone-friendly button)
    fillBlanks: (key) => {
      const from = rows.findIndex((r) => !isBlank(listCell(r, key)?.value));
      if (from < 0) return;
      rows.forEach((r, i) => { if (i !== from && isBlank(listCell(r, key)?.value)) listCell(r, key)?.copy(rows[from]); });
    },
  };
}
