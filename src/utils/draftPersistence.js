import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';

// The New Order draft kept on this browser (Sean, 2026-11-14): a refresh, a closed tab or a crash
// mid-order brings back Function Details, Order Details and the cart. One draft per account — the
// old shared one (removed in 0ceb3af) showed the last account's order to the next. Uploaded files
// are already in Storage ({ path, name }), so only those references are kept.
const keyFor = (userId) => `pj.newOrderDraft.v2:${userId}`;
const LEGACY_KEY = 'schoolportal.orderDraft.v1';

export const DRAFT_FIELDS = [
  // Function Details
  'sekolah', 'schoolLanguage', 'actingSchoolId', 'sales', 'selectedSalesmanId', 'picName', 'phone',
  'ketuaPanitia', 'terms', 'remark', 'shipmentDateSelected', 'funcSelected',
  'logoDataUrl', 'logoFileName', 'logoRemark', 'schoolType',
  // Order Details
  'category', 'lineValues', 'matrixValues', 'rowsByBlock', 'columnsByBlock', 'plakRows',
  'nextRowId', 'nextPlakRowId', 'nextColumnId', 'visibleBlocksByCategory',
  'importFilePath', 'importFileName', 'importFiles', 'kertasKerjaFiles',
  'step2ImportStatus', 'step2ChoiceAnswers', 'step2UploadedFiles',
  'cart',
];
const DATE_FIELDS = ['shipmentDateSelected', 'funcSelected'];

const filled = (v) => {
  if (v instanceof Date) return true;
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.values(v).some(filled);
  return String(v ?? '').trim() !== '';
};
const changed = (value, blank) => value !== undefined && JSON.stringify(value) !== JSON.stringify(blank);

// Worth keeping (and bringing back) only once something was typed, picked or uploaded — the school
// a teacher's account comes with, or a default Terms, is not an order.
export function draftHasContent(st) {
  if (!st) return false;
  const typed = ['picName', 'phone', 'ketuaPanitia', 'remark', 'funcSelected', 'shipmentDateSelected', 'actingSchoolId',
    'logoFileName', 'cart', 'importFiles', 'kertasKerjaFiles', 'step2UploadedFiles', 'lineValues', 'matrixValues'];
  return typed.some((k) => filled(st[k]))
    || changed(st.rowsByBlock, buildInitialRowsByBlock(st.schoolLanguage || 'SK'))
    || changed(st.columnsByBlock, buildInitialColumnsByBlock())
    || changed(st.plakRows, buildInitialPlakRows());
}

/** @returns {object|null} the account's saved draft (only DRAFT_FIELDS, dates as Date) */
export function loadDraft(userId) {
  if (!userId) return null;
  try {
    localStorage.removeItem(LEGACY_KEY);
    const parsed = JSON.parse(localStorage.getItem(keyFor(userId)) || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const draft = Object.fromEntries(DRAFT_FIELDS.filter((k) => k in parsed).map((k) => [k, parsed[k]]));
    DATE_FIELDS.forEach((k) => {
      const d = draft[k] ? new Date(draft[k]) : null;
      draft[k] = d && !Number.isNaN(d.getTime()) ? d : null;
    });
    if (draft.cart !== undefined && !Array.isArray(draft.cart)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(userId, state) {
  if (!userId) return;
  const snapshot = Object.fromEntries(DRAFT_FIELDS.map((k) => [k, state[k]]));
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(snapshot));
  } catch {
    // Storage full: a logo still being uploaded is a big data: URL — keep the rest without it.
    if (!String(snapshot.logoDataUrl || '').startsWith('data:')) return;
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify({ ...snapshot, logoDataUrl: null, logoFileName: '' }));
    } catch { /* still full / blocked: the draft is only in memory */ }
  }
}

export function clearDraft(userId) {
  if (!userId) return;
  try { localStorage.removeItem(keyFor(userId)); } catch { /* storage blocked: nothing kept */ }
}
