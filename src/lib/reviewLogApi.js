import { supabase } from './supabaseClient';

// review_log (supabase/migrations/0105_review_log.sql). The snapshots are written by the database;
// the browser adds what AI Review flagged and Sean's reason. Never throws: a failed write only
// logs, it must not get in the way of reviewing.

// What AI Review showed, kept small: enough to tell later whether Production acted on it
export async function saveAiFlags(orderId, issues) {
  const flags = (issues || []).map((i) => ({ rule: i.rule, level: i.level, ai: !!i.ai, text: i.text, find: i.find || '', sheet: i.sheet || '' }));
  const { error } = await supabase.from('review_log')
    .upsert({ order_id: orderId, ai_issues: flags, ai_at: new Date().toISOString() }, { onConflict: 'order_id' });
  if (error) console.error('Could not save the AI Review flags:', error);
}

export async function fetchReviewLog(limit = 50) {
  const { data, error } = await supabase.from('review_log').select('*')
    .not('done_at', 'is', null).order('done_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function saveReviewNote(orderId, note) {
  const { error } = await supabase.from('review_log')
    .update({ note, note_at: new Date().toISOString() }).eq('order_id', orderId);
  if (error) throw error;
}
