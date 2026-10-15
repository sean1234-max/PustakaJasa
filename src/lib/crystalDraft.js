// A teacher's crystal changes made before the order was submitted (Cart → "No, Edit Crystal" →
// Crystal Studio, Sean 2026-10-15) — kept in this browser under the key Crystal Studio uses
// (public/crystal/js/draft.js) and saved on the order once it's in, the same record Crystal
// Studio's "Save for this order only" writes (crystal_designs "order-<order>").
import { supabase } from './supabaseClient';

const DRAFT_KEY = 'crystal-draft-custom';

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch { return {}; }
}

export function clearCrystalDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked: nothing kept */ }
}

// public/crystal/js/jenis.js orderDesignId: "ORD-0030" -> "order-ord-0030"
const orderDesignId = (order) => (`order-${String(order || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`).slice(0, 40);

// Saves the draft's changes on the new order, then forgets them. Nothing kept = nothing to do.
export async function saveCrystalDraft(orderId) {
  const custom = readDraft();
  if (Object.keys(custom).length === 0) return;
  const id = orderDesignId(orderId);
  const now = Date.now();
  const name = `Order ${orderId} — its own crystals`;
  const data = { order: orderId, custom };
  const { error } = await supabase.from('crystal_designs').upsert({
    id,
    design: { id, name, created: now, updated: now, data },
    meta: { id, name, created: now, updated: now, rows: 0, thumb: '', source: '', changed: 0 },
    updated_at: new Date(now).toISOString(),
  });
  if (error) throw error;
  clearCrystalDraft();
}
