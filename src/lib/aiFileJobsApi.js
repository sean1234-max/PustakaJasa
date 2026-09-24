import { supabase } from './supabaseClient';

// Queues a "Generate AI File" job (0071) for a local watcher script on the
// Illustrator machine to pick up — the CSV content itself rides along on
// the row (small text, no need for a Storage round trip). Returns the new
// job's id, or throws.
export async function createAiFileJob(orderId, filename, csvContent) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('ai_file_jobs')
    .insert({ order_id: orderId, filename, csv_content: csvContent, requested_by: user?.id || null })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function getAiFileJob(jobId) {
  const { data, error } = await supabase
    .from('ai_file_jobs')
    .select('id, status, result_message, output_paths, created_at, updated_at')
    .eq('id', jobId)
    .single();
  if (error) return null;
  return data;
}

// Most recent job for this order, so the page can show "already
// generating" / the last result without the caller having to track the id
// itself (e.g. after a page refresh).
export async function getLatestAiFileJobForOrder(orderId) {
  const { data, error } = await supabase
    .from('ai_file_jobs')
    .select('id, status, result_message, output_paths, created_at, updated_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

// Signed download URL for one generated .ai file (private bucket, written
// by the watcher's service-role key — see 0071).
export async function getAiFileOutputUrl(path) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('ai-file-outputs').createSignedUrl(path, 300, { download: true });
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
