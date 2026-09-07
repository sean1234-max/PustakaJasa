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
// Stashes the teacher's raw FORM ANUGERAH upload in the private
// `order-imports` bucket (0046) so Production can pull it back as a backup
// (see 0055). Best-effort — a failure here just means the order has no
// backup file, the import itself already succeeded. Returns { path, name }
// or null.
export async function uploadOrderImportFile(file) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const ext = /\.docx$/i.test(file.name || '') ? '.docx' : '.xlsx';
    const path = `${user.id}/${crypto.randomUUID()}${ext}`;
    const { error } = await supabase.storage.from('order-imports').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) { console.error('order import upload failed:', error); return null; }
    return { path, name: String(file.name || 'order.xlsx').slice(0, 200) };
  } catch (err) {
    console.error('order import upload failed:', err);
    return null;
  }
}

// Best-effort delete of a previous import file — called when a teacher
// re-imports (the new upload replaces it). Ignored on failure.
export async function removeOrderImportFile(path) {
  if (!path) return;
  try {
    await supabase.storage.from('order-imports').remove([path]);
  } catch { /* orphan blob — the retention sweep will get it */ }
}

// A short-lived signed download URL for a stored import file (private
// bucket). `download: true` sets Content-Disposition so the browser saves
// it rather than trying to open it. Returns null on any failure.
export async function getOrderImportUrl(path) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('order-imports').createSignedUrl(path, 300, { download: true });
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function uploadLogo(dataUrl, fileName) {
  // Under the uploader's own uid folder — the "logos" bucket's INSERT
  // policy scopes writes that way (0054), same shape as order-imports, so
  // one account can't scribble into the bucket at large.
  const { data: { user } } = await supabase.auth.getUser();
  const blob = await (await fetch(dataUrl)).blob();
  const ext = (fileName || '').includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  const path = `${user?.id || 'shared'}/${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage.from('logos').upload(path, blob, {
    contentType: blob.type || 'image/png',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('logos').getPublicUrl(path);
  return data.publicUrl;
}
