import { ACTIVE_CATEGORIES, isDynamicCategoryKey, resolveCategory, resolveSelempangWarna } from '../data/catalog';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { buildCsvRows } from './exportCsv';

// The order on the page (New Order step 2) as plaques for the FORM ANUGERAH
// download (templateExport.js), Sean 2026-10-17: whatever is in the tabs now
// — read from a file, typed, or changed by "Ask Claude". Each plaque is the
// wording the production file would engrave (exportCsv.js buildCsvRows: the
// same rows Add to Cart sends on), so the form shows what will be made.
// A tab that can't be added to cart yet (no Jenis Plak, a blank line…) is
// still written in, with a blank KOD where its Jenis Plak is missing, so the
// form can be finished in Excel and uploaded again (Sean, 2026-10-17); its
// problem is named in `unready`. `skipped`: tabs with no plaque at all yet.
// Each plaque carries `kind`, its tab's own sheet kind (LONJAKAN, TOKOH_SHEET,
// MP2 …; a tab read from a renamed sheet keeps its base kind), so the form
// can put it on that sheet. `selempang`: the Selempang tab's rows; `front`:
// the Function Details the FRONT PG shows (Sean, 2026-10-17).
const kindOf = (catKey) => (isDynamicCategoryKey(catKey) ? catKey.split('::')[1] : catKey);

export function draftPlaques(draft) {
  const dynamic = Object.keys(draft.visibleBlocksByCategory || {}).filter(isDynamicCategoryKey);
  const keys = [...ACTIVE_CATEGORIES.map((c) => c.key), ...dynamic];
  const byWording = new Map();
  const skipped = [];
  const unready = [];
  const selempang = [];
  keys.forEach((catKey) => {
    if (resolveCategory(catKey)?.selempang) {
      (draft.rowsByBlock?.[`${catKey}::0`] || []).forEach((r) => {
        const acara = String(r.acara || '').trim();
        const qty = Number(r.qty) || 0;
        if (!acara && !qty) return;
        selempang.push({ acara, warna: resolveSelempangWarna(r.warna)?.warna || String(r.warna || '').trim(), qty });
      });
      return;
    }
    const strict = buildCategoryCartItems(draft, catKey);
    if (!strict.engaged) return;
    const label = resolveCategory(catKey)?.label || catKey;
    const res = strict.error ? buildCategoryCartItems(draft, catKey, { lenient: true }) : strict;
    if (!res.items?.length) { skipped.push(`${label}: ${strict.error || 'nothing to add'}`); return; }
    if (strict.error) unready.push(`${label}: ${strict.error}`);
    const { rows } = buildCsvRows({ schoolLanguage: draft.schoolLanguage, items: res.items }, catKey, res.items);
    rows.forEach(([heading, , award, line, eline2, code]) => {
      const p = { kind: kindOf(catKey), heading: heading || '', award: award || '', line: line || '', eline2: eline2 || '', code: code || '' };
      const key = JSON.stringify(p);
      const have = byWording.get(key);
      if (have) have.qty += 1;
      else byWording.set(key, { ...p, qty: 1 });
    });
  });
  const front = {
    sales: draft.sales || '', sekolah: draft.sekolah || '',
    cikgu: [draft.picName, draft.phone].map((x) => String(x || '').trim()).filter(Boolean).join(' / '),
    remark: draft.remark || '',
  };
  return { plaques: [...byWording.values()], selempang, front, skipped, unready };
}
