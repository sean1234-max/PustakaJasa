// medal_designs rows + their pictures in the "medal-designs" bucket (migration 0129). Rules: utils/medalDesigns.js.
import { supabase } from './supabaseClient';
import { mergeDesignRows, storedPreview } from '../utils/medalDesigns';

const BUCKET = 'medal-designs';

export async function fetchMedalDesigns() {
  const { data, error } = await supabase.from('medal_designs').select('*');
  if (error) throw error;
  return data || [];
}

export const medalPictureUrl = (name) => supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl;

const base64Bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
async function sha1Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// each picture stored once under its SHA-1 ("<sha1>.png"), so a name never changes what it shows
async function storePictures(pictures) {
  const stored = {};
  for (const [name, b64] of Object.entries(pictures)) {
    const bytes = base64Bytes(b64);
    const key = `${await sha1Hex(bytes)}.png`;
    const { error } = await supabase.storage.from(BUCKET).upload(key, new Blob([bytes], { type: 'image/png' }), {
      contentType: 'image/png', upsert: false, cacheControl: '31536000',
    });
    if (error && !/exists|duplicate/i.test(error.message || '') && String(error.statusCode) !== '409') {
      throw new Error(`Could not save the picture ${name}: ${error.message}`);
    }
    stored[name] = key;
  }
  return stored;
}

/**
 * The AI File helper's export ({ designs, pictures }) saved: pictures to the bucket, one row per design.
 * @returns {Promise<{ added: string[], gone: string[], count: number }>}
 */
export async function saveDesignExport({ designs, pictures }, existing) {
  const stored = await storePictures(pictures || {});
  const { rows, added, gone } = mergeDesignRows(existing, designs, (d) => storedPreview(d, stored));
  const now = new Date().toISOString();
  const { error } = await supabase.from('medal_designs').upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: 'name' });
  if (error) throw error;
  return { added, gone, count: designs.length };
}

/** label / hidden / sort_order of some designs */
export async function updateMedalDesigns(changes) {
  const now = new Date().toISOString();
  for (const { name, ...patch } of changes) {
    const { error } = await supabase.from('medal_designs').update({ ...patch, updated_at: now }).eq('name', name);
    if (error) throw error;
  }
}
