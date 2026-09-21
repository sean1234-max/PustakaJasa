import { supabase } from './supabaseClient';

// AI proofreading of the engraving (Reference Sample) lines, run when the
// teacher clicks Add to Cart. See supabase/functions/check-engraving-text.
//
// This is ADVISORY. It must never break the order flow: this wrapper never
// throws and never rejects — every failure path (function down, timeout,
// not logged in, rate limited, malformed reply) resolves to
// `{ issues: [], checked: false }`, and the caller then just adds to cart
// as if the check hadn't happened.
//
// `lines` is [{ id, label, text }] where `id` is the lineValues key the
// browser uses, so an accepted fix is a plain substring replace on that
// one line.
export async function checkEngravingText(lines) {
  const clean = (lines || [])
    .filter((l) => l && l.id && String(l.text || '').trim())
    .map((l) => ({ id: String(l.id), label: String(l.label || '').slice(0, 80), text: String(l.text).trim() }));
  if (clean.length === 0) return { issues: [], checked: false };

  // The real lineValues key of a renamed sheet embeds that sheet's URL-encoded
  // name ("dyn::LONJAKAN::MURID%20TERBIKANG%20KOKURIKULUM::0::2"), and the
  // model treats what it sees as text to proofread — it once "corrected" a
  // right word to match a typo in the tab name. So it only ever sees neutral
  // ids (L1, L2, ...), mapped back to the real keys below.
  const realIdByAlias = new Map(clean.map((l, i) => [`L${i + 1}`, l.id]));
  const aliased = clean.map((l, i) => ({ ...l, id: `L${i + 1}` }));

  try {
    const { data, error } = await supabase.functions.invoke('check-engraving-text', { body: { lines: aliased } });
    if (error || !data || !Array.isArray(data.issues)) return { issues: [], checked: false };
    // Trust only well-shaped issues (the function already validated, this is
    // belt-and-suspenders before they reach the UI).
    const issues = data.issues
      .filter((it) => (
        it && typeof it.lineId === 'string' && realIdByAlias.has(it.lineId) && typeof it.original === 'string'
        && typeof it.suggestion === 'string' && it.original && it.suggestion
      ))
      .map((it) => ({ ...it, lineId: realIdByAlias.get(it.lineId) }));
    return { issues, checked: !!data.checked };
  } catch {
    return { issues: [], checked: false };
  }
}
