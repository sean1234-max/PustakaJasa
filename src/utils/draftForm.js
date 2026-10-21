import { ACTIVE_CATEGORIES, flattenPlakCatalog, isDynamicCategoryKey, priceInFlatCatalog, resolveCategory, resolveSelempangWarna } from '../data/catalog';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { buildCsvRows } from './exportCsv';
import { UMUM_SLOTS } from './umumLines';

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
// can put it on that sheet; `tab`: a tab of its own's name, the sheet the
// form writes it on (in that kind's format). `selempang`: the Selempang tab's rows; `front`:
// the Function Details the FRONT PG shows (Sean, 2026-10-17).
// `priceOf(code)`: the website's own price for a plaque code (the Jenis
// Plak catalog Add to Cart charges), for the form's SENARAI PLAK (Sean,
// 2026-10-17); null when the catalog doesn't know it.
// `only`: just these tabs (a Word / PDF file's own, see formRoundTrip.js).
const codeKey = (code) => String(code || '').toUpperCase().replace(/\s+/g, '');
function catalogPrices(catalog) {
  const flat = flattenPlakCatalog(catalog);
  const byKey = new Map(flat.map((p) => [codeKey(p.code), p.price]));
  return (code) => {
    const price = priceInFlatCatalog(flat, code) ?? byKey.get(codeKey(code)) ?? null;
    return Number(price) > 0 ? Number(price) : null;
  };
}

const kindOf = (catKey) => (isDynamicCategoryKey(catKey) ? catKey.split('::')[1] : catKey);

export function draftPlaques(draft, { only = null } = {}) {
  const dynamic = Object.keys(draft.visibleBlocksByCategory || {}).filter(isDynamicCategoryKey);
  const keys = [...ACTIVE_CATEGORIES.map((c) => c.key), ...dynamic].filter((k) => !only || only.includes(k));
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
    // A tab of its own (IKON PENGAWAS …) gets its own sheet in the form.
    const tab = isDynamicCategoryKey(catKey) ? label : '';
    // ORDER LAIN-LAIN: its ①–④ as on the page (`slots`, `red` = its MERAH line), so the form gets
    // the same lines in the same boxes (Sean, 2026-10-21) — not rebuilt from the engraved fields.
    if (resolveCategory(catKey)?.umumRows) {
      res.items.forEach((it) => {
        const lines = it.detail?.lines || {};
        const pre = `${it.categoryKey}::${it.blockIdx ?? 0}::`;
        (it.detail?.rows || []).forEach((r) => {
          const qty = Number(r.qty) || 0;
          if (qty <= 0) return;
          const slots = UMUM_SLOTS.map((sl) => {
            const own = String(r[`l${sl}`] ?? '').trim();
            return own === '-' ? '' : (own || String(lines[pre + sl] ?? '').trim());
          });
          const contoh = UMUM_SLOTS.map((sl) => String(lines[pre + sl] ?? '').trim());
          const p = { kind: kindOf(catKey), tab, slots, contoh, red: String(lines[`${pre}umumRed`] ?? ''), code: r.jenisPlak || it.jenisPlak || '', heading: '', award: slots[0], line: '', eline2: '' };
          const key = JSON.stringify(p);
          const have = byWording.get(key);
          if (have) have.qty += qty;
          else byWording.set(key, { ...p, qty });
        });
      });
      return;
    }
    const { rows } = buildCsvRows({ schoolLanguage: draft.schoolLanguage, items: res.items }, catKey, res.items);
    rows.forEach(([heading, , award, line, eline2, code]) => {
      const p = { kind: kindOf(catKey), tab, heading: heading || '', award: award || '', line: line || '', eline2: eline2 || '', code: code || '' };
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
  return { plaques: [...byWording.values()], selempang, front, priceOf: catalogPrices(draft.plakCatalog), skipped, unready };
}
