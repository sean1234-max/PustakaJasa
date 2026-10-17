import { ACTIVE_CATEGORIES, isDynamicCategoryKey, resolveCategory } from '../data/catalog';
import { computeBlocks, noopUpdaters } from './computeBlocks';

// "Ask Claude" on New Order step 2 (Sean, 2026-10-17): the teacher or
// salesman tells Claude what to change in the order on the page, and
// Claude does it (read-order-file, kind "chat"). This file builds what
// Claude is shown — every tab with its Reference Sample rows as on screen —
// and checks Claude's answer before anything in the order changes. Claude
// can only:
//   - put text on a Reference Sample row: words the user typed, or a row's
//     text already in the order (to move or copy it), or "" to clear it;
//   - reorder a tab's rows (refOrder: the order SEAN.jsx stacks the
//     artwork lines), on the tabs that can be dragged;
//   - add a note to the Remark for Production.
// Names, classes, quantities and Jenis Plak are never touched. Every change
// can be undone from the chat.

const MAX_TABS = 60;
const TITLE_SLOT = '0';

const stripQuotes = (s) => String(s || '').replace(/[‘’“”"']/g, '');
const norm = (s) => stripQuotes(s).replace(/\s+/g, ' ').trim().toUpperCase();
// One engraved line, or (TAJUK BESAR) several, as the user typed them.
const cleanText = (text, slot) => {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return slot === TITLE_SLOT ? lines.join('\n') : lines.join(' ');
};

// Every category that can hold something: the standing tabs plus the ones
// an import made (renamed sheets, AI-read award tabs).
function categoryKeys(draft) {
  const dynamic = Object.keys(draft.visibleBlocksByCategory || {}).filter(isDynamicCategoryKey);
  return [...ACTIVE_CATEGORIES.map((c) => c.key), ...dynamic];
}

// The order as Claude sees it: one tab per section that has anything in it.
export function buildChatTabs(draft) {
  const lineValues = draft.lineValues || {};
  const tabs = [];
  categoryKeys(draft).forEach((catKey) => {
    const cat = resolveCategory(catKey);
    if (!cat || cat.selempang) return;
    const { blocks } = computeBlocks(
      catKey, lineValues, draft.matrixValues || {}, draft.rowsByBlock || {}, draft.plakRows || {},
      draft.columnsByBlock || {}, noopUpdaters, draft.plakCatalog, draft.schoolLanguage,
    );
    const count = Math.max(1, Number(draft.visibleBlocksByCategory?.[catKey]) || 1);
    blocks.slice(0, count).forEach((blk, b) => {
      const rows = (blk.lines || []).filter((ln) => ln.slotId).map((ln) => ({
        slot: ln.slotId, num: String(ln.num ?? ''), label: String(ln.placeholder || ''), text: String(ln.value || ''),
      }));
      const plaques = Number(blk.blockTotalQty) || 0;
      if (!rows.some((r) => r.text.trim()) && plaques === 0) return;
      const sheet = lineValues[`${catKey}::${b}::sourceSheet`];
      tabs.push({
        id: `${catKey}::${b}`,
        catKey,
        label: count > 1 ? `${sheet || cat.label} (section ${b + 1})` : (sheet || cat.label),
        plaques,
        draggable: !!cat.draggableReferenceSample,
        rows,
      });
    });
  });
  return tabs.slice(0, MAX_TABS);
}

// What is sent: the conversation (text only), the files, the Remark and the tabs.
export function buildChatRequest(draft, messages) {
  return {
    messages: messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, text: String(m.text || '') })),
    files: (draft.step2UploadedFiles || []).map((f) => f.name),
    remark: String(draft.remark || ''),
    tabs: buildChatTabs(draft).map((t) => ({ id: t.id, label: t.label, plaques: t.plaques, draggable: t.draggable, rows: t.rows })),
  };
}

// Claude's answer -> a patch for the draft, what was done (for the chat),
// what was refused and why, and how to undo it. Pure. `userText` is every
// message the user sent in this chat: a row's new text must be in it word
// for word, or already be on a row of the order.
export function applyChatActions(draft, actions, { tabs, userText }) {
  const lineValues = { ...(draft.lineValues || {}) };
  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const said = norm(userText);
  const inOrder = new Set(tabs.flatMap((t) => t.rows.map((r) => norm(r.text)).filter(Boolean)));
  const done = [];
  const refused = [];
  const before = {};
  const remember = (key) => { if (!(key in before)) before[key] = draft.lineValues?.[key]; };
  const notes = [];

  (actions || []).forEach((a) => {
    if (a?.type === 'note') {
      const text = String(a.text || '').replace(/\s+/g, ' ').trim();
      if (text) notes.push(text);
      return;
    }
    const tab = tabById.get(a?.tab);
    if (!tab) { refused.push('A change was for a tab that is not in this order, so it was not made.'); return; }
    if (a.type === 'set-line') {
      const row = tab.rows.find((r) => r.slot === a.slot);
      if (!row) { refused.push(`A change was for a row that ${tab.label} does not have, so it was not made.`); return; }
      const text = cleanText(a.text, a.slot);
      if (text && !said.includes(norm(text)) && !inOrder.has(norm(text))) {
        refused.push(`"${text.replace(/\n/g, ' / ')}" for ${tab.label} row ${row.num} is not in your messages word for word, so it was not put in. Please type the exact words.`);
        return;
      }
      const key = `${tab.id}::${a.slot}`;
      if ((lineValues[key] || '') === text) return;
      remember(key);
      lineValues[key] = text;
      done.push(text
        ? `${tab.label}, row ${row.num} (${row.label || 'row'}): "${text.replace(/\n/g, ' / ')}"`
        : `${tab.label}, row ${row.num} (${row.label || 'row'}): cleared`);
      return;
    }
    if (a.type === 'line-order') {
      const slots = tab.rows.map((r) => r.slot);
      const order = (a.order || []).map(String);
      if (!tab.draggable) { refused.push(`The rows of ${tab.label} cannot be reordered — please tell Production in Remark.`); return; }
      if (order.length !== slots.length || new Set(order).size !== order.length || order.some((s) => !slots.includes(s))) {
        refused.push(`The new row order for ${tab.label} did not list every row once, so it was not changed.`);
        return;
      }
      const key = `${tab.id}::refOrder`;
      if (order.join(',') === slots.join(',')) return;
      remember(key);
      lineValues[key] = order.join(',');
      const byslot = new Map(tab.rows.map((r) => [r.slot, r]));
      done.push(`${tab.label}, row order top to bottom: ${order.map((s) => byslot.get(s)?.num || s).join(', ')}`);
    }
  });

  const patch = {};
  if (Object.keys(before).length) patch.lineValues = lineValues;
  const remark = String(draft.remark || '');
  const have = new Set(remark.split('\n').map((l) => l.trim()));
  const add = [...new Set(notes)].map((n) => `Arahan khas: ${n}`).filter((l) => !have.has(l));
  if (add.length) {
    patch.remark = remark ? `${remark}\n${add.join('\n')}` : add.join('\n');
    add.forEach((l) => done.push(`Remark: "${l}"`));
  }
  // What each changed row was before, and what this reply wrote there.
  const after = Object.fromEntries(Object.keys(before).map((k) => [k, lineValues[k]]));
  const undo = (patch.lineValues || add.length) ? { lineValues: before, written: after, remarkLines: add } : null;
  return { patch, done, refused: [...new Set(refused)], undo };
}

// Undo one reply's changes, keeping everything else the user changed since:
// a row changed again after this reply (by hand, or by a later reply) keeps
// its newer text.
export function undoChatChanges(draft, undo) {
  if (!undo) return {};
  const lineValues = { ...(draft.lineValues || {}) };
  Object.entries(undo.lineValues || {}).forEach(([k, v]) => {
    if (undo.written && (lineValues[k] ?? '') !== (undo.written[k] ?? '')) return;
    if (v === undefined) delete lineValues[k];
    else lineValues[k] = v;
  });
  const patch = { lineValues };
  if (undo.remarkLines?.length) {
    const drop = new Set(undo.remarkLines);
    patch.remark = String(draft.remark || '').split('\n').filter((l) => !drop.has(l.trim())).join('\n');
  }
  return patch;
}
