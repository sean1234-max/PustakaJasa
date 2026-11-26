import { supabase } from './supabaseClient';
import { formFillIdOf } from '../utils/formFillTag';

// The form bot's reading of a teacher's kertas kerja and the kertas kerja itself, behind a FORM ANUGERAH the
// bot filled (migration 0132, form_fill). Each id is fetched once per page load.
// -> { id, reading, kkPath, kkName } or null (not found, offline — the order goes on without the check).
const cache = new Map();
const LOOKUP_TIMEOUT_MS = 8000; // a stalled network must not hold Add to Cart: no answer = no check
const timeout = (ms) => new Promise((_, reject) => { setTimeout(() => reject(new Error('form_fill timed out')), ms); });

export function loadFormFill(id) {
  if (!id) return Promise.resolve(null);
  if (!cache.has(id)) {
    const fetched = Promise.race([supabase.rpc('form_fill', { p_id: id }), timeout(LOOKUP_TIMEOUT_MS)])
      .then(({ data, error }) => {
        if (error) throw error;
        const row = data?.[0];
        return row ? { id, reading: row.reading, kkPath: row.kk_path, kkName: row.kk_name } : null;
      })
      .catch((err) => {
        console.error('form_fill failed:', err);
        cache.delete(id);
        return null;
      });
    cache.set(id, fetched);
  }
  return cache.get(id);
}

// An uploaded file's form fill, when it is a FORM ANUGERAH the bot filled
export async function formFillOfFile(file) {
  if (!/\.xlsx$/i.test(file?.name || '')) return null;
  const id = formFillIdOf(await file.arrayBuffer());
  return id ? loadFormFill(id) : null;
}

// The readings behind the draft's bot-filled files (state.formFillIds)
export async function readingsOf(ids) {
  const fills = await Promise.all((ids || []).map(loadFormFill));
  return fills.filter((f) => f?.reading).map((f) => f.reading);
}
