import { DEFAULT_REF_ORDER } from '../data/catalog';
import { draftPlaques } from './draftForm';
import { parseFormAnugerahExcel } from './excelImport';

// The blank FORM ANUGERAH the order is written into (templateExport.js).
export const FORM_TEMPLATE_URL = '/templates/FORM-ANUGERAH.xlsx';

// A Word / PDF order shown in the FORM ANUGERAH layout straight away (Sean,
// 2026-10-19): the tabs read from the file are written into the form the way
// the download does, and the form is read back the way an uploaded one is —
// the download-and-upload-again staff used to do by hand. `keys`: the file's
// own tabs. Returns { parsed } or { error } (the tabs then stay as read):
// a tab with no quantity yet, a plaque the form has no place for, or lines
// in another order (a name list engraved name first) would otherwise be lost
// — the form has a fixed place for each line.
const customOrder = (refOrder) => {
  const at = String(refOrder || '').split(',').map((id) => DEFAULT_REF_ORDER.indexOf(id)).filter((i) => i >= 0);
  return at.some((i, n) => n > 0 && i < at[n - 1]);
};

export async function draftToFormParsed(draft, keys, templateBuffer, opts) {
  const reordered = Object.entries(draft.lineValues || {})
    .some(([k, v]) => k.endsWith('::refOrder') && keys.some((c) => k.startsWith(`${c}::`)) && customOrder(v));
  if (reordered) return { error: 'its plaque lines are in a different order (e.g. the name above the award), which the form cannot keep' };
  const { plaques, selempang, front, priceOf, skipped } = draftPlaques(draft, { only: keys });
  if (skipped.length) return { error: `some tabs have no quantity yet (${skipped.join('; ')})` };
  if (!plaques.length && !selempang.length) return { error: 'there is nothing to put in the form' };
  const { fillOrderTemplate } = await import('./templateExport');
  const out = await fillOrderTemplate(templateBuffer, { plaques, selempang, front, priceOf }, opts);
  const placed = Object.values(out.placed).reduce((a, n) => a + n, 0);
  if (placed < out.plaqueCount) return { error: `only ${placed} of ${out.plaqueCount} plaques fit the form` };
  const parsed = parseFormAnugerahExcel(out.buffer);
  return parsed.error ? { error: parsed.error } : { parsed };
}
