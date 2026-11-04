import { supabase } from './supabaseClient';

// bot_requests (supabase/migrations/0107_bot_requests.sql): the Telegram bot's change requests
// waiting on an order, and marking one applied / dismissed.

export async function fetchPendingChanges(orderId) {
  const { data, error } = await supabase.from('bot_requests').select('*')
    .eq('order_id', orderId).eq('kind', 'change').eq('status', 'pending').order('created_at');
  if (error) throw error;
  return data || [];
}

export async function markBotRequest(id, status, handledByName) {
  const { error } = await supabase.from('bot_requests')
    .update({ status, handled_at: new Date().toISOString(), handled_by_name: handledByName || null }).eq('id', id);
  if (error) throw error;
}
