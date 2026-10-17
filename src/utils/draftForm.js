import { ACTIVE_CATEGORIES, isDynamicCategoryKey, resolveCategory } from '../data/catalog';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { buildCsvRows } from './exportCsv';

// The order on the page (New Order step 2) as plaques for the FORM ANUGERAH
// download (templateExport.js), Sean 2026-10-17: whatever is in the tabs now
// — read from a file, typed, or changed by "Ask Claude". Each plaque is the
// wording the production file would engrave (exportCsv.js buildCsvRows: the
// same rows Add to Cart sends on), so the form shows what will be made.
// A tab that can't be added to cart yet is left out, and named in `skipped`.
export function draftPlaques(draft) {
  const dynamic = Object.keys(draft.visibleBlocksByCategory || {}).filter(isDynamicCategoryKey);
  const keys = [...ACTIVE_CATEGORIES.map((c) => c.key), ...dynamic];
  const byWording = new Map();
  const skipped = [];
  keys.forEach((catKey) => {
    const res = buildCategoryCartItems(draft, catKey);
    if (!res.engaged) return;
    const label = resolveCategory(catKey)?.label || catKey;
    if (res.error || !res.items?.length) { skipped.push(`${label}: ${res.error || 'nothing to add'}`); return; }
    const { rows } = buildCsvRows({ schoolLanguage: draft.schoolLanguage, items: res.items }, catKey, res.items);
    rows.forEach(([heading, , award, line, eline2, code]) => {
      const p = { heading: heading || '', award: award || '', line: line || '', eline2: eline2 || '', code: code || '' };
      const key = JSON.stringify(p);
      const have = byWording.get(key);
      if (have) have.qty += 1;
      else byWording.set(key, { ...p, qty: 1 });
    });
  });
  return { plaques: [...byWording.values()], skipped };
}
