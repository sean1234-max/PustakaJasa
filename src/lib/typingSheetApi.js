import { supabase } from './supabaseClient';

// Done Typing → the Form_Responses Google Sheet (mark-typing-sheet Edge Function, Sean 2026-11-06):
// the order's row (school + trophy/plak QTY, selempang left out) gets "SEAN (NOV)" in column I.
// Never blocks the order: returns a message for Production when the row needs a person, or null.
export async function markTypingSheet(orderId) {
  try {
    const { data, error } = await supabase.functions.invoke('mark-typing-sheet', { body: { orderId } });
    if (error || data?.error) {
      let message = data?.error;
      try { message = message || (await error?.context?.json?.())?.error; } catch { /* generic below */ }
      return `Google Sheet not updated: ${message || 'could not reach the sheet.'} Please fill column I by hand.`;
    }
    const where = `${data.school} / QTY ${data.qty}`;
    if (data.result === 'not_found') return `Google Sheet: no row found for ${where}. Please check with the salesman and fill column I by hand.`;
    if (data.result === 'ambiguous') return `Google Sheet: ${data.rows.length} rows match ${where} (rows ${data.rows.join(', ')}) — not filled. Please ask the salesman (double key-in or tambahan?) and fill by hand.`;
    return null;
  } catch (err) {
    console.error('Typing sheet mark failed:', err);
    return 'Google Sheet not updated — please fill column I by hand.';
  }
}

// A cancelled order's mark comes off the sheet again. Fire-and-forget.
export function clearTypingSheet(orderId) {
  supabase.functions.invoke('mark-typing-sheet', { body: { orderId, action: 'clear' } })
    .then(({ data, error }) => {
      if (error || data?.error) console.error('Typing sheet clear failed:', error || data.error);
      else if (data?.result === 'not_found') console.warn('Typing sheet: the cancelled order\'s mark was not found on the sheet', data);
    })
    .catch((err) => console.error('Typing sheet clear failed:', err));
}
