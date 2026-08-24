import { supabase } from './supabaseClient';

// School logos (NewOrderStep1.jsx) used to be stored as base64 data URLs
// directly in orders.logo_data_url — counting against the project's whole
// database quota (500 MB on Free) instead of Storage's own, much larger
// quota (1 GB Free / 100 GB Pro) meant for exactly this. This uploads to
// the "logos" bucket (see supabase/migrations/0034_add_logo_storage_bucket.sql)
// and returns the bucket's public URL, which works as an <img src> exactly
// like the old data: URI did — every existing reader of logoDataUrl needs
// no changes.
//
// Takes the data URL ImageDrop.jsx already hands back (rather than
// changing that shared component, also used by Production/Admin's
// reference-image uploaders) and converts it back to a Blob for the
// actual upload — a small round trip, but it means this is the only file
// that needs to know Storage exists at all.
export async function uploadLogo(dataUrl, fileName) {
  const blob = await (await fetch(dataUrl)).blob();
  const ext = (fileName || '').includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  const path = `${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage.from('logos').upload(path, blob, {
    contentType: blob.type || 'image/png',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('logos').getPublicUrl(path);
  return data.publicUrl;
}
