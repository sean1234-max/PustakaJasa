const STORAGE_KEY = 'schoolportal.orderDraft.v1';

// Only the in-progress "New Order" fields are autosaved — submitted orders
// aren't (they'll live server-side once the backend lands), and login
// fields never should be.
const DRAFT_FIELDS = [
  'sekolah', 'sales', 'picName', 'phone', 'remark', 'dueSelected', 'funcSelected',
  'logoDataUrl', 'logoFileName',
  'category', 'pbdVariant', 'lineValues', 'matrixValues', 'rowsByBlock', 'plakRows', 'namaKelasRows',
  'nextRowId', 'nextPlakRowId', 'nextNamaKelasRowId',
  'cart',
];

// A draft is only worth restoring (and worth telling the user about) once
// they've actually typed or added something — an empty draft is just the
// blank form.
export function draftHasContent(draft) {
  if (!draft) return false;
  return Boolean(
    draft.sekolah || draft.picName || draft.phone || draft.remark
    || (draft.cart && draft.cart.length > 0)
    || Object.values(draft.lineValues || {}).some(Boolean)
    || Object.values(draft.matrixValues || {}).some(Boolean),
  );
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.dueSelected) parsed.dueSelected = new Date(parsed.dueSelected);
    if (parsed.funcSelected) parsed.funcSelected = new Date(parsed.funcSelected);
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(state) {
  const snapshot = {};
  DRAFT_FIELDS.forEach((key) => { snapshot[key] = state[key]; });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort — a full/unavailable localStorage shouldn't break the app.
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
