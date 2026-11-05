// The assistant changes an order for Sean (2026-11-05) — Shipment Date, Function Date, Remark only,
// and only after he confirms: prepare → he says yes in a LATER message → apply. The request waits in
// bot_requests (pending, so the order page shows it with Apply / Dismiss too). Written the way the order
// page's Apply does (AppState updateShipmentAndUrgency / updateOrderDetails): days as Malaysia midnight,
// Urgent left as it is. An urgent order's Shipment Date is left to the order page — only the website
// (a signed-in user) can update the urgent Google Sheet.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { proposeChanges, type Change, type Order } from './order.ts';

export type EditAsk = {
  order_id: string;
  shipment_date: string | null;
  function_date: string | null;
  remark_mode: 'replace' | 'append' | null;
  remark_text: string | null;
};

const ORDER_FIELDS = 'id, sekolah, status, shipment_date, function_date, remark, urgent, cancelled_at';
const COLUMN: Record<Change['field'], string> = { shipmentDate: 'shipment_date', functionDate: 'function_date', remark: 'remark' };
const stored = (field: Change['field'], to: string) => (field === 'remark' ? to : `${to}T00:00:00+08:00`);

// The change as it would be, saved as pending — or why it can't be
export async function prepareEdit(db: SupabaseClient, ask: EditAsk, who: string) {
  const id = String(ask.order_id || '').trim().toUpperCase();
  const { data: order, error } = await db.from('orders').select(ORDER_FIELDS).eq('id', id).maybeSingle();
  if (error) return { error: error.message };
  if (!order) return { error: `no order ${id}` };
  if (order.cancelled_at) return { error: `${id} is cancelled — it can't be changed` };
  const { changes, refused } = proposeChanges(order as Order, {
    shipmentDate: ask.shipment_date, functionDate: ask.function_date,
    remarkAdd: ask.remark_mode === 'append' ? ask.remark_text : null,
  });
  if (ask.remark_mode === 'replace' && !['Cancelled', 'Completed'].includes(order.status)) {
    const to = String(ask.remark_text ?? '').trim();
    if (to !== String(order.remark || '')) changes.push({ field: 'remark', from: String(order.remark || ''), to });
  }
  if (!changes.length) return { error: refused.join(' ') || 'nothing to change — the order already says that' };
  const { data: req, error: insertError } = await db.from('bot_requests')
    .insert({ kind: 'change', order_id: id, requested_by: `${who} (assistant)`, source_text: JSON.stringify(ask).slice(0, 4000), changes })
    .select('id').single();
  if (insertError) return { error: insertError.message };
  return { request_id: req.id, order: id, school: order.sekolah, changes, refused, urgentShipmentLeftToWebsite: !!order.urgent && changes.some((c) => c.field === 'shipmentDate') };
}

// Sean said yes: write it. `askedBefore` — the request must come from an earlier message than his yes.
export async function applyEdit(db: SupabaseClient, requestId: string, askedBefore: Date, who: string) {
  const { data: req, error } = await db.from('bot_requests').select('id, order_id, changes, status, created_at').eq('id', requestId).maybeSingle();
  if (error) return { error: error.message };
  if (!req || req.status !== 'pending') return { error: 'no such change waiting (already applied or dismissed?)' };
  if (new Date(req.created_at) >= askedBefore) return { error: 'Sean has not confirmed this change yet — show it to him and wait for his yes' };
  const { data: order } = await db.from('orders').select(ORDER_FIELDS).eq('id', req.order_id).maybeSingle();
  if (!order) return { error: `no order ${req.order_id}` };
  if (order.cancelled_at || ['Cancelled', 'Completed'].includes(order.status)) return { error: `${order.id} is ${order.cancelled_at ? 'cancelled' : order.status} — it can't be changed` };

  const changes = (req.changes as Change[]) || [];
  const leftToWebsite = changes.filter((c) => c.field === 'shipmentDate' && order.urgent);
  const writing = changes.filter((c) => !leftToWebsite.includes(c));
  // the order may have moved on since the preview
  const recheck = proposeChanges(order as Order, {
    shipmentDate: writing.find((c) => c.field === 'shipmentDate')?.to ?? null,
    functionDate: writing.find((c) => c.field === 'functionDate')?.to ?? null,
  });
  if (recheck.refused.length) return { error: recheck.refused.join(' ') };
  if (writing.length) {
    const fields = Object.fromEntries(writing.map((c) => [COLUMN[c.field], stored(c.field, c.to)]));
    const { error: updateError } = await db.from('orders').update(fields).eq('id', order.id);
    if (updateError) return { error: updateError.message };
  }
  if (!leftToWebsite.length) {
    await db.from('bot_requests').update({ status: 'applied', handled_at: new Date().toISOString(), handled_by_name: `${who} (assistant)` }).eq('id', req.id);
  } else {
    await db.from('bot_requests').update({ changes: leftToWebsite }).eq('id', req.id);
  }
  return {
    applied: writing,
    ...(leftToWebsite.length ? { leftToWebsite: 'urgent order: open the order page and press Apply for the Shipment Date (it updates the urgent Google Sheet)' } : {}),
  };
}
