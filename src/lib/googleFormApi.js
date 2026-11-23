import { supabase } from './supabaseClient';

// The salesmen's Google Form (supabase/functions/fill-google-form, Sean 2026-11-10): filled for an order a
// salesman submits on the website, as the Telegram bot already does for its own. Never throws — the order is in
// whatever happens to the form. Resolves to { status, values?, formUrl? }.
// `note`: the salesman's words after the school, "SK HULU KELANG (W) - <note>" (Sean, 2026-11-10)
// `force`: fill it although a look-alike row is already there — his "YES, FILL AGAIN" (Sean, 2026-11-16)
export async function fillGoogleForm(orderId, note = '', force = false) {
  try {
    const { data, error } = await supabase.functions.invoke('fill-google-form', { body: { orderId, note, force } });
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
  if (res.status === 'duplicate') {
    const where = res.duplicate ? ` (row ${res.duplicate.row}: ${res.duplicate.school}, QTY ${res.duplicate.qty})` : '';
    return `📝 Already in the Google Form${where} — not filled again.`;
  }
  if (res.status === 'no_sale') return '📝 Your name is not a SALE option in the Google Form — please fill it by hand.';
  // 'failed' is tried again every 10 minutes for about 2 hours (fill-google-form retryAll, 2026-11-23)
  if (res.status === 'failed') return '⚠️ Google is not answering — the website will fill the Google Form by itself in the next minutes.';
  if (res.status === 'timeout') return '⚠️ Google Form did not answer — check the MASTER LIST; fill it by hand if your order is not there.';
  if (res.status === 'error') return '⚠️ Google Form not filled — please fill it by hand.';
  return '';
}

// Production's Done Typing (Sean, 2026-11-16): the order's MASTER LIST row (same school, this invoice's QTY,
// column I still empty) gets "<NAME> (<MON>)" in column I — fill-google-form's 'typed' action. Never throws.
// Resolves to { status: 'marked' | 'not_found' | 'failed' | 'error', row?, school?, text? }.
export async function markMasterListTyped(orderId, qty) {
  try {
    const { data, error } = await supabase.functions.invoke('fill-google-form', { body: { action: 'typed', orderId, qty } });
    if (error || !data) return { status: 'error' };
    return data;
  } catch {
    return { status: 'error' };
  }
}

export function masterListTypedNote(res) {
  if (res?.status === 'marked') return `📝 MASTER LIST row ${res.row} (${res.school}): ${res.text}`;
  if (res?.status === 'not_found') return `⚠️ MASTER LIST: no untyped row for ${res.school}, QTY ${res.qty} — write column I by hand.`;
  // kept and tried again every 10 minutes for about 2 hours (fill-google-form retryAll, 2026-11-23)
  return '⚠️ Google is not answering — the website will write MASTER LIST column I by itself in the next minutes; write it by hand if it is still empty later.';
}
