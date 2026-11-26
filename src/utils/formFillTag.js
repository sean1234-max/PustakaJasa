import * as XLSX from 'xlsx';

// The id the form bot writes into a FORM ANUGERAH it filled (supabase/functions/telegram-bot/formFill.ts):
// a custom document property naming its form_fills row — the bot's reading of the teacher's kertas kerja
// and the kertas kerja itself (migration 0132). Null for any other Excel.
export const FORM_FILL_PROP = 'PJSB_FORM_FILL';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formFillIdOf(buffer) {
  try {
    const id = String(XLSX.read(buffer, { type: 'array', bookProps: true }).Custprops?.[FORM_FILL_PROP] || '').trim();
    return UUID_RE.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}
