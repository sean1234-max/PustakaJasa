import { supabase } from './supabaseClient';

// Calls the sync-urgent-order-sheet Edge Function — writes (or refreshes)
// an urgent order's row in the external Google Sheet: first when Store
// Admin saves its Invoice Number, again whenever its total changes (see
// attemptUrgentSheetSync / resyncUrgentSheet in src/state/AppState.jsx). Same error-surfacing convention as
// invokeAdminUserOps (src/lib/adminApi.js): supabase-js hands back a
// generic FunctionsHttpError on any non-2xx response, with the function's
// actual { error: "..." } body reachable via error.context.json().
export async function syncUrgentOrderToSheet(payload) {
  const { data, error } = await supabase.functions.invoke('sync-urgent-order-sheet', { body: payload });
  if (error) {
    let message = 'Could not sync this order to the tracking sheet.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // fall back to the generic message above
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  highlightUrgentKitDoc();
  return data;
}

// Store Admin's KIT DOC sheet: a row turns red when its invoice is an urgent
// order's and its DW PRODUCTION box is ticked (highlight-urgent-kitdoc, Sean
// 2026-10-20). The function reads the whole urgent list itself, so it's
// re-run after every change to that list. Fire-and-forget: a failure only
// leaves the red marks one change behind, never blocks the order.
export function highlightUrgentKitDoc() {
  supabase.functions.invoke('highlight-urgent-kitdoc', { body: {} })
    .then(({ data, error }) => {
      if (error || data?.error) console.error('KIT DOC highlight failed:', error || data.error);
      else if (data?.duplicates?.length) console.warn('KIT DOC: invoice on more than one row, not highlighted:', data.duplicates);
    })
    .catch((err) => console.error('KIT DOC highlight failed:', err));
}
