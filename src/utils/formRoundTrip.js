import { draftPlaques } from './draftForm';
import { parseFormAnugerahExcel } from './excelImport';

// The blank FORM ANUGERAH the order is written into (templateExport.js).
export const FORM_TEMPLATE_URL = '/templates/FORM-ANUGERAH.xlsx';

// A Word / PDF order shown in the FORM ANUGERAH layout straight away (Sean,
// 2026-10-19): the tabs read from the file are written into the form the way
// the download does, and the form is read back the way an uploaded one is —
// the download-and-upload-again staff used to do by hand. `keys`: the file's
// own tabs. Returns { parsed } or { error } (the tabs then stay as read):
// a tab with no quantity yet, or a plaque the form has no place for, would
// otherwise be lost.
export async function draftToFormParsed(draft, keys, templateBuffer, opts) {
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
