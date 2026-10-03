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
// The function reads at most 40 lines / 8000 characters per call (see
// check-engraving-text's MAX_LINES / MAX_TOTAL_CHARS), and a big order —
// every UMUM row's own lines included — can be more, so the lines go out in
// batches, all at once.
const BATCH_LINES = 40;
const BATCH_CHARS = 7000;

function toBatches(lines) {
  const batches = [];
  let cur = [];
  let chars = 0;
  lines.forEach((l) => {
    if (cur.length && (cur.length >= BATCH_LINES || chars + l.text.length > BATCH_CHARS)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(l);
    chars += l.text.length;
  });
  if (cur.length) batches.push(cur);
  return batches;
}

async function checkBatch(batch) {
  try {
    const { data, error } = await supabase.functions.invoke('check-engraving-text', { body: { lines: batch } });
    if (error || !data || !Array.isArray(data.issues)) return { issues: [], checked: false };
    return { issues: data.issues, checked: !!data.checked };
  } catch {
    return { issues: [], checked: false };
  }
}

export async function checkEngravingText(lines) {
  const clean = (lines || [])
    .filter((l) => l && l.id && String(l.text || '').trim())
    .map((l) => ({ id: String(l.id), label: String(l.label || '').slice(0, 80), text: String(l.text).trim() }));
  if (clean.length === 0) return { issues: [], checked: false };

  // The real lineValues key of a renamed sheet embeds that sheet's URL-encoded
  // name ("dyn::LONJAKAN::MURID%20TERBIKANG%20KOKURIKULUM::0::2"), and the
  // model treats what it sees as text to proofread — it once "corrected" a
  // right word to match a typo in the tab name. So it only ever sees neutral
  // ids (L1, L2, ...), mapped back to the real keys below. The same text
  // (UMUM rows repeat a lot) is sent once; its issues apply to every line
  // that has it.
  const idsByText = new Map();
  const unique = [];
  clean.forEach((l) => {
    if (!idsByText.has(l.text)) {
      idsByText.set(l.text, []);
      unique.push({ ...l, id: `L${unique.length + 1}` });
    }
    idsByText.get(l.text).push(l.id);
  });
  const realIdsByAlias = new Map(unique.map((l) => [l.id, idsByText.get(l.text)]));

  const results = await Promise.all(toBatches(unique).map(checkBatch));
  // Trust only well-shaped issues (the function already validated, this is
  // belt-and-suspenders before they reach the UI).
  const issues = results.flatMap((r) => r.issues)
    .filter((it) => (
      it && typeof it.lineId === 'string' && realIdsByAlias.has(it.lineId) && typeof it.original === 'string'
      && typeof it.suggestion === 'string' && it.original && it.suggestion
    ))
    .flatMap((it) => realIdsByAlias.get(it.lineId).map((lineId) => ({ ...it, lineId })));
  return { issues, checked: results.some((r) => r.checked) };
}
