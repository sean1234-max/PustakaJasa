import { getCategoryLinePlaceholders, resolveCategory } from '../data/catalog';
import { visibleRefSlots } from './redLines';

// Custom Instructions for AI (New Order step 2, Sean 2026-10-17). The
// teacher or salesman types instructions once ("For file ABC, add the
// header 'Majlis Anugerah Kecemerlangan 2026' at the bottom"); after each
// upload the AI (read-order-file, kind "instructions") says which of them
// are for that file and what each asks. This file checks that answer and
// applies it to the draft. Only two things are ever changed, both on the
// Reference Sample of the tabs the file filled:
//   - TAJUK BESAR (slot 0), to text the user typed word for word;
//   - where TAJUK BESAR sits in the Reference Sample's line order
//     (refOrder: the order SEAN.jsx stacks the lines on the artwork).
// Anything else (font, size, colour, other lines) goes into the order's
// Remark for Production, word for word. Names, classes and quantities are
// never touched. Anything unclear, conflicting or about a file that wasn't
// uploaded becomes a question the user must answer before Add to Cart.

const HEADER_SLOTS = ['0', '0b'];

const stripQuotes = (s) => String(s || '').replace(/[‘’“”"']/g, '');
const norm = (s) => stripQuotes(s).replace(/\s+/g, ' ').trim().toUpperCase();
// "ABC.xlsx", "abc", "ABC (1).XLSX" -> "ABC"; "Order_ABC-2026.pdf" -> "ORDER ABC 2026".
export const fileStem = (name) => String(name || '').trim()
  .replace(/\.(xlsx|xls|docx|doc|pdf)$/i, '').replace(/\s*\(\d+\)$/, '')
  .replace(/[^A-Za-z0-9À-￿]+/g, ' ').trim().toUpperCase();

// Which uploaded file a name the user wrote means: the one with the same
// name (extension and capitals aside), else the only one whose name holds
// it as whole words. { match } | { ambiguous: [names] } | { none: true }.
export function resolveFileMention(mentioned, uploaded) {
  const want = fileStem(mentioned);
  if (!want) return { none: true };
  const exact = uploaded.filter((n) => fileStem(n) === want);
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };
  const re = new RegExp(`(^| )${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  const partial = uploaded.filter((n) => re.test(fileStem(n)));
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return { none: true };
}

const hasHeadingSlot = (cat) => !!cat && !cat.umumRows
  && /^TAJUK BESAR$/i.test(String((getCategoryLinePlaceholders(cat, 'SK') || [])[0] || '').trim());

// The tabs a file filled, as the AI sees them: one per block, with its
// Reference Sample lines as they are in the draft now. `heading` is null
// for a tab with no TAJUK BESAR line (ORDER LAIN-LAIN, Selempang).
export function buildInstructionTabs(draft, catKeys) {
  const lineValues = draft.lineValues || {};
  const tabs = [];
  (catKeys || []).forEach((catKey) => {
    const cat = resolveCategory(catKey);
    if (!cat) return;
    const count = Math.max(1, Number(draft.visibleBlocksByCategory?.[catKey]) || 1);
    for (let b = 0; b < count; b++) {
      const prefix = `${catKey}::${b}::`;
      const withHeading = hasHeadingSlot(cat);
      const heading = withHeading ? [lineValues[`${prefix}0`], lineValues[`${prefix}0b`]].filter(Boolean).join('\n') : null;
      const lines = ['1', '2', '2b', '3'].map((s) => lineValues[`${prefix}${s}`]).filter(Boolean);
      if (!withHeading && !lines.length && !lineValues[`${prefix}0`]) continue;
      const sheet = lineValues[`${prefix}sourceSheet`];
      tabs.push({
        id: `${catKey}::${b}`,
        catKey,
        blockIdx: b,
        label: count > 1 ? `${sheet || cat.label} (section ${b + 1})` : (sheet || cat.label),
        heading,
        lines: withHeading ? lines : ['0', ...['1', '2', '3']].map((s) => lineValues[`${prefix}${s}`]).filter(Boolean),
        draggable: !!cat.draggableReferenceSample,
      });
    }
  });
  return tabs;
}

// Before asking the AI: when every instruction names a file and none of
// them can be about `fileName` (its name appears nowhere in the text),
// there is nothing for the AI to do for this file — no call, no cost. Names
// that match no uploaded file are still asked about. Returns a plan, or
// null when the AI is needed.
const FILE_MENTION_RE = /(?:\bfile|\bfail|文件|档案)\s*[:"'\u2018\u201C]?\s*([^\s,;:.'"\u2019\u201D]+(?:\.(?:xlsx|xls|docx|doc|pdf))?)/gi;
export function precheckInstructions(instructions, { fileName, uploaded }) {
  const sentences = String(instructions || '').split(/(?<=[.!?。])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  if (!sentences.length) return null;
  const mentions = sentences.map((x) => [...x.matchAll(FILE_MENTION_RE)].map((m) => m[1]));
  if (mentions.some((m) => m.length === 0)) return null;
  const stem = fileStem(fileName);
  if (!stem || new RegExp(`(^| )${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(fileStem(instructions))) return null;
  const files = uploaded.includes(fileName) ? uploaded : [...uploaded, fileName];
  const plan = { headings: [], positions: [], notes: [], questions: [], otherFiles: 0 };
  sentences.forEach((quote, i) => {
    mentions[i].forEach((name) => {
      const f = resolveFileMention(name, files);
      if (f.match === fileName) return; // can't happen (checked above), kept for safety
      if (f.match) { plan.otherFiles += 1; return; }
      const text = f.ambiguous
        ? `"${name}" could mean ${f.ambiguous.map((n) => `"${n}"`).join(' or ')} — please write the full file name.`
        : `No uploaded file is called "${name}". Upload it, or check the file name in your instructions.`;
      plan.questions.push({ id: hashId(`${fileName}|${quote}|${text}`), quote, text });
    });
  });
  return plan;
}

// Short stable id for a question, so its answer survives a re-render.
function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `instr-${(h >>> 0).toString(36)}`;
}

// The AI's reading -> what to do for THIS file. Every item is re-checked:
// the file it names (by name, not the AI's word), the header being the
// user's own words, the tabs being this file's, and two items that ask
// for different things on the same tab. Returns
//   { headings: [{ tabIds, text, quote }], positions: [{ tabIds, position, quote }],
//     notes: [quote], questions: [{ id, quote, text }], otherFiles: n }
export function planInstructions(reading, { fileName, uploaded, instructions, tabs }) {
  const plan = { headings: [], positions: [], notes: [], questions: [], otherFiles: 0 };
  const said = norm(instructions);
  const files = uploaded.includes(fileName) ? uploaded : [...uploaded, fileName];
  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const ask = (quote, text) => plan.questions.push({ id: hashId(`${fileName}|${quote}|${text}`), quote, text });

  (reading?.items || []).forEach((it) => {
    const quote = String(it?.quote || '').trim();
    if (!quote || it.action === 'none') return;
    // Which file — decided here from the name the user wrote.
    if (it.file) {
      const f = resolveFileMention(it.file, files);
      if (f.none) { ask(quote, `No uploaded file is called "${it.file}". Upload it, or check the file name in your instructions.`); return; }
      if (f.ambiguous) { ask(quote, `"${it.file}" could mean ${f.ambiguous.map((n) => `"${n}"`).join(' or ')} — please write the full file name.`); return; }
      if (f.match !== fileName) { plan.otherFiles += 1; return; }
    } else if (it.scope === 'unknown-file' || it.scope === 'other-file') {
      ask(quote, it.reason || 'It is not clear which file this instruction is for — please name the file.');
      return;
    }
    if (it.status !== 'apply') {
      const fallback = it.status === 'conflict' ? 'This disagrees with another of your instructions — please keep only one.'
        : it.status === 'unsupported' ? 'The order cannot do this automatically — please arrange it with your salesman or in Remark.'
          : 'This instruction is not clear — please write it more exactly.';
      ask(quote, it.reason || fallback);
      return;
    }
    if (it.action === 'note') { plan.notes.push(quote); return; }

    const named = (it.tabs || []).filter((id) => tabById.has(id));
    const targets = (named.length ? named : tabs.map((t) => t.id)).filter((id) => tabById.get(id).heading !== null);
    if (!targets.length) { ask(quote, 'None of the tabs this file filled has a TAJUK BESAR line, so the header cannot be applied.'); return; }

    if (it.action === 'set-heading') {
      const text = String(it.text || '').trim();
      if (!text || !said.includes(norm(text))) { ask(quote, 'The header text could not be found word for word in your instructions — please type it exactly.'); return; }
      plan.headings.push({ tabIds: targets, text: stripQuotes(text).replace(/\s+/g, ' ').trim(), quote });
    }
    if ((it.action === 'set-heading' || it.action === 'heading-position') && it.position) {
      const movable = targets.filter((id) => tabById.get(id).draggable);
      if (movable.length < targets.length) ask(quote, 'The header position cannot be changed on some of these tabs — please tell Production in Remark.');
      if (movable.length) plan.positions.push({ tabIds: movable, position: it.position, quote });
    } else if (it.action === 'heading-position') {
      ask(quote, 'Please say whether the header goes at the top or the bottom.');
    }
  });

  // Two instructions for the same tab that disagree: neither is applied.
  const dropConflicts = (list, valueOf, what) => {
    const byTab = new Map();
    list.forEach((a) => a.tabIds.forEach((id) => byTab.set(id, [...(byTab.get(id) || []), a])));
    const bad = new Set();
    byTab.forEach((acts) => {
      if (new Set(acts.map(valueOf)).size > 1) acts.forEach((a) => bad.add(a));
    });
    bad.forEach((a) => ask(a.quote, `This asks for a different ${what} than another of your instructions for the same tab — please keep only one.`));
    return list.filter((a) => !bad.has(a));
  };
  plan.headings = dropConflicts(plan.headings, (a) => norm(a.text), 'header');
  plan.positions = dropConflicts(plan.positions, (a) => a.position, 'header position');
  // Same question twice (two checks on one item) is asked once.
  plan.questions = plan.questions.filter((q, i, all) => all.findIndex((x) => x.id === q.id) === i);
  return plan;
}

// The plan -> a patch for the draft ({ lineValues, remark }) and the lines
// telling the user what was done. Pure, and the same plan applied twice
// gives the same draft (an "Apply again" changes nothing new).
export function applyInstructionPlan(draft, plan, { fileName, tabs }) {
  const lineValues = { ...(draft.lineValues || {}) };
  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const done = [];
  const remarkLines = [];
  const label = (ids) => ids.map((id) => tabById.get(id)?.label).filter(Boolean).join(', ');

  plan.headings.forEach((a) => {
    a.tabIds.forEach((id) => { lineValues[`${id}::0`] = a.text; });
    done.push(`TAJUK BESAR set to "${a.text}" on ${label(a.tabIds)}.`);
    remarkLines.push(a.quote);
  });
  plan.positions.forEach((a) => {
    a.tabIds.forEach((id) => {
      const tab = tabById.get(id);
      const prefix = `${id}::`;
      const slots = visibleRefSlots(lineValues, prefix, resolveCategory(tab.catKey));
      const head = slots.filter((s) => HEADER_SLOTS.includes(s));
      const rest = slots.filter((s) => !HEADER_SLOTS.includes(s));
      lineValues[`${prefix}refOrder`] = (a.position === 'bottom' ? [...rest, ...head] : [...head, ...rest]).join(',');
    });
    done.push(`TAJUK BESAR moved to the ${a.position} of the Reference Sample on ${label(a.tabIds)} — the artwork file uses this line order.`);
    remarkLines.push(a.quote);
  });
  plan.notes.forEach((q) => {
    done.push(`Noted for Production in Remark (not applied automatically): "${q}"`);
    remarkLines.push(q);
  });

  const remark = String(draft.remark || '');
  const have = new Set(remark.split('\n').map((l) => l.trim()));
  const add = [...new Set(remarkLines)].map((q) => `Arahan khas (${fileName}): ${q}`).filter((l) => !have.has(l));
  const patch = { lineValues };
  if (add.length) patch.remark = remark ? `${remark}\n${add.join('\n')}` : add.join('\n');
  return { patch, done };
}

// Questions -> the page's "Confirm before continuing" entries: each must be
// answered before Add to Cart, and answering changes nothing in the order.
export function instructionQuestionsToWarnings(questions) {
  return questions.map((q) => ({
    type: 'choice',
    id: q.id,
    blockIdx: 0,
    instruction: true,
    text: `Custom instruction "${q.quote}": ${q.text}`,
    options: [{ key: 'ack', label: 'OK — I will check this myself' }],
    addPatches: [],
  }));
}
