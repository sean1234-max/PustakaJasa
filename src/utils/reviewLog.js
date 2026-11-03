import { buildCsvRows, CSV_COLUMNS } from './exportCsv';
import { resolveCategory } from '../data/catalog';

// Review Log (supabase/migrations/0105_review_log.sql): what Production changed between the order as
// submitted and the order at Done Review, against what AI Review flagged — the shadow-period check
// of docs/ai-review-rules.md (what the AI missed, what it flagged for nothing).

const ENGRAVED = ['event_header', 'position', 'event_line_1', 'event_line_2'].map((c) => CSV_COLUMNS.indexOf(c));
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toUpperCase();
const plaqueText = (row) => ENGRAVED.map((i) => norm(row[i])).filter(Boolean).join(' / ');

// sheet → Map(plaque words → how many plaques)
function plaquesBySheet(items) {
  const sheets = new Map();
  (items || []).forEach((item) => {
    const sheet = item.categoryLabel || resolveCategory(item.categoryKey)?.label || item.categoryKey;
    const counts = sheets.get(sheet) || new Map();
    buildCsvRows({ items: [item] }, null, [item]).rows.forEach((r) => {
      const text = plaqueText(r);
      if (text) counts.set(text, (counts.get(text) || 0) + 1);
    });
    sheets.set(sheet, counts);
  });
  return sheets;
}

// Per sheet, the plaques that went away and the ones that came in: [{ sheet, removed, added }],
// each a list of { text, count }. Sheets with no change are left out.
export function reviewChanges(originalItems, doneItems) {
  const before = plaquesBySheet(originalItems);
  const after = plaquesBySheet(doneItems);
  const diff = (a, b) => [...a].filter(([text, n]) => n > (b.get(text) || 0)).map(([text, n]) => ({ text, count: n - (b.get(text) || 0) }));
  return [...new Set([...before.keys(), ...after.keys()])].map((sheet) => {
    const b = before.get(sheet) || new Map();
    const a = after.get(sheet) || new Map();
    return { sheet, removed: diff(b, a), added: diff(a, b) };
  }).filter((s) => s.removed.length || s.added.length);
}

// Each AI Review flag at Done Review: 'changed' when the words it pointed at are no longer on any
// plaque (Production acted on it), else 'kept' (flagged, nothing changed — maybe a false alarm).
// A flag with no words to look for (FRONT PG totals …) is 'unknown'.
export function aiOutcomes(aiIssues, doneItems) {
  const all = [...plaquesBySheet(doneItems).values()].flatMap((m) => [...m.keys()]).join('\n');
  return (aiIssues || []).map((i) => ({
    ...i,
    outcome: !i.find ? 'unknown' : all.includes(norm(i.find)) ? 'kept' : 'changed',
  }));
}
