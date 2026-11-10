import { supabase } from './supabaseClient';

// The salesmen's Google Form (supabase/functions/fill-google-form, Sean 2026-11-10): filled for an order a
// salesman submits on the website, as the Telegram bot already does for its own. Never throws — the order is in
// whatever happens to the form. Resolves to { status, values?, formUrl? }.
// `note`: the salesman's words after the school, "SK HULU KELANG (W) - <note>" (Sean, 2026-11-10)
export async function fillGoogleForm(orderId, note = '') {
  try {
    const { data, error } = await supabase.functions.invoke('fill-google-form', { body: { orderId, note } });
    if (error || !data) return { status: 'error' };
    return data;
  } catch {
    return { status: 'error' };
  }
}

// One line for the salesman about it, or '' when there's nothing to say
export function googleFormNote(res) {
  if (!res) return '';
  if (res.status === 'filled') return '📝 Google Form filled too.';
  if (res.status === 'no_due_date') return '📝 Google Form waits for the Shipment Date — it is filled when you approve the order.';
  if (res.status === 'duplicate') return `📝 Already in the Google Form (row ${res.duplicate?.row}: ${res.duplicate?.school}, QTY ${res.duplicate?.qty}) — not filled again.`;
  if (res.status === 'no_sale') return '📝 Your name is not a SALE option in the Google Form — please fill it by hand.';
  if (res.status === 'failed' || res.status === 'error') return '⚠️ Google Form not filled — please fill it by hand.';
  return '';
}
