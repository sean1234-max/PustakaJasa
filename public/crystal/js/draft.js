// A teacher's crystal changes for an order not submitted yet (Sean, 2026-10-15: the Cart's
// "No, Edit Crystal"). There's no order to save them on, so they're kept in this browser —
// the website shares it (same site) — and the website saves them on the order once it's in
// (src/lib/crystalDraft.js reads the same key). Kept by what each crystal says (contentKey).
export const DRAFT_KEY = "crystal-draft-custom";

export function draftCustom() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") || {}; } catch (e) { return {}; }
}

// throws when the browser can't keep it (full, or storage blocked)
export function saveDraftCustom(custom) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(custom));
}
