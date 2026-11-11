import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CATEGORIES, ACTIVE_CATEGORIES, formatDate, standardUnitPrice, getCategorySubjects, isReviewed, isAddonInFlight, canProductionEdit, toMalaysiaDay,
  resolveCategory, categoriesUsedByItems, isDynamicCategoryKey, malaysiaToday, malaysiaDayIso,
} from '../data/catalog';
import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';
import { addonPrefill, diffAddonItems } from '../utils/addonDiff';
import {
  computeBlocks, buildDraftFromOrder,
} from '../utils/computeBlocks';
import {
  parseFormAnugerahExcel, } from '../utils/excelImport';
import { parseWordingDocx } from '../utils/docxImport';
import * as XLSX from 'xlsx';
import { buildWorkbookIr, renderIrText } from '../utils/fileIr';
import { applyAiMapping } from '../utils/aiMapping';
import { readSheetsWithAi, canUseAiReader } from '../lib/fileReadApi';
import { parseDocxOrderWithAi, parsePdfOrder } from '../utils/pdfImport';
import { FORM_TEMPLATE_URL, draftToFormParsed } from '../utils/formRoundTrip';
import { draftPlaques } from '../utils/draftForm';
import { buildCategoryCartItems } from './categoryCartItems';
import { applyParsedImport, NEW_ORDER_IMPORT_FIELDS } from './applyParsedImport';
import { AppStateContext } from './AppStateContext';
import { saveCrystalDraft, clearCrystalDraft } from '../lib/crystalDraft';
import {
  fetchOrders, fetchOrderById, markArtworkManual, saveProductionNote, saveSalesmanPrinted, insertOrder, updateOrder, approveAddonAsOrder, nextOrderSeq, fetchAllSalesmen, reassignOrderSalesman,
  findPossibleDuplicates,
} from '../lib/ordersApi';
import {
  fetchPlakCatalog, addPlakNode, removePlakNode, updatePlakNode, updatePlakNodeOrder, updatePlakNodeStock,
  linkPlakNodeToStockGroup, unlinkPlakNodeFromStockGroup, updateStockGroupStock,
  deductPlakStock, restorePlakStock,
} from '../lib/catalogAdminApi';
import { supabase } from '../lib/supabaseClient';
import { uploadOrderImportFile, getOrderImportUrl } from '../lib/storageApi';
import { withImportFile, tagImportFiles, orderImportFields, editedOrderFiles } from '../utils/importFiles';
import { syncUrgentOrderToSheet, highlightUrgentKitDoc } from '../lib/urgentSheetApi';
import { isUrgentShipment, urgentSheetAction, SHIPMENT_EDITABLE_STATUSES } from '../utils/urgentOrder';
import { fetchCustomTypoWords } from '../lib/typoWordsApi';
import { setCustomTypoWords } from '../utils/typoCheck';
import { normalizeSplitQty, stockDiff, keepPrices, applyPriceDrafts, withOrderOwnSettings, invoiceGroupStatus } from '../utils/orderBatches';
import { needsKiv, kivParts, hasPlakPart, kivInProduction, crystalWithPlak, isCrystalCode } from '../utils/exportCsv';
import { kivOnlyGroupsDone } from '../utils/productionCards';

// Malaysia's "today" (catalog.js's malaysiaToday — the project always runs
// on Malaysian dates), normalized to midnight so it compares cleanly against
// the midnight-constructed dates the calendar cells and date-math use. This
// one is for the calendars; anything that's stamped or decided at the moment
// of an action calls malaysiaToday() then, so a page left open past midnight
// doesn't keep yesterday's date.
const TODAY = malaysiaToday();

// Days picked on a date picker (Date objects) → their stored form, each
// day's Malaysian midnight (catalog.js's malaysiaDayIso) — the same value
// ordersApi saves, so local state and Supabase never disagree on the day.
const storedDays = (fields) => Object.fromEntries(
  Object.entries(fields).map(([k, v]) => [k, v instanceof Date ? malaysiaDayIso(v) : v]),
);

// plak_stock_deduct (supabase/migrations/0032_add_plak_stock.sql) raises a
// plain-text exception shaped 'INSUFFICIENT_STOCK:<full path>:<max
// orderable>' when a line would breach the reserve floor — turns that into
// the "contact your salesman" message the teacher actually needs, falling
// back to the raw error for anything else (unknown code, connection issue).
// `patch` given: a stock refusal reloads the Jenis Plak catalog — a tab open for days still had a code that
// has since been hidden (Sean, 2026-11-11: PK 261 / A), so the picker and Cart catch up right away.
function describeStockError(err, patch) {
  const m = /^INSUFFICIENT_STOCK:(.*):(\d+)$/.exec(err?.message || '');
  if (m && patch) {
    fetchPlakCatalog()
      .then((plakCatalog) => patch({ plakCatalog }))
      .catch((e) => console.error('Failed to reload the catalog after a stock refusal:', e));
  }
  if (m) return `Not enough stock for "${m[1]}" — only ${m[2]} left available to order. Please lower the quantity or contact your salesman.`;
  return `Could not check stock: ${err?.message || 'unknown error'}. Please try again.`;
}

// Internal testing account — its orders live in their own ORD-9001+ number
// range (a separate order_number_counters row, seeded at 9001 via
// nextOrderSeq — see migration 0009 and submitOrder below) so they never
// collide with or shift real schools' ORD-0001+ sequence, and never touch
// real stock (skipped at every deduct/restore call site below). The whole
// point: this account's orders can be deleted after testing with zero
// effect on anything else — no counter to "give back", no stock to
// reconcile.
// ponytail: one hardcoded email, not a role/flag column — simplest thing
// that works for a single known test account; promote to a real
// `profiles.is_test_account` column if more than one is ever needed.
// The salesman seanng@pjsb.com is a test account too (Sean, 2026-10-17): its New Orders
// also go to ORD-90xx and never touch stock.
const TEST_ACCOUNT_EMAILS = new Set(['sktest@pjsb.com', 'seanng@pjsb.com']);
async function isTestAccountUser() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return TEST_ACCOUNT_EMAILS.has((user?.email || '').toLowerCase());
  } catch {
    return false;
  }
}
// Any order whose number landed in the 9000+ range only ever came from the
// test account above (real orders start at 1 and share one counter that
// never jumps there) — cheap enough to check from the id alone, no need to
// also stamp/read a per-order flag at every stock call site.
function isTestOrderId(id) {
  const n = parseInt(String(id || '').replace(/^ORD-/, ''), 10);
  return Number.isFinite(n) && n >= 9000;
}

// Turns a raw Supabase/Postgres error from an order write into something a
// non-technical user can act on. Covers the three server-side guards this
// app now relies on (RLS row ownership, orders_write_guard's status/column
// rules, orders_amount_guard's items<->total arithmetic check — see
// supabase/migrations/0041 & 0042) plus a generic fallback.
function describeOrderWriteError(err, verb = 'save') {
  const m = err?.message || '';
  if (/does not match the sum of its items|check_violation|order total \(/i.test(m)) {
    return "The order total didn't add up on the server and the change was rejected. Please refresh the page and re-check the prices before trying again.";
  }
  if (/already in production|submit an Add-On|can no longer be edited|awaiting approval|only move an order|has been cancelled|already reviewed|already approved|after Production has reviewed|Only Production can/i.test(m)) {
    return `This order can't be changed that way anymore: ${m}`;
  }
  if (/row-level security|not authorized|account is not active/i.test(m)) {
    return `You're not allowed to ${verb} this order right now — it may have moved to a later stage, or your session changed. Please refresh and try again.`;
  }
  return `Could not ${verb} this order: ${m || 'unknown error'}. Please try again.`;
}

// One invoice "slice" of an order (orderBatches.js's getOrderInvoiceSlices):
// its own invoice when `sliceInvoiceId` is the order's invoiceId, else that
// invoice_groups entry — with the slice's status and Done Typing time.
// null when the order or the group doesn't exist.
function findInvoiceSlice(order, sliceInvoiceId) {
  if (!order) return null;
  const groups = order.invoiceGroups || [];
  if (sliceInvoiceId === (order.invoiceId || null)) {
    return { isDefault: true, groups, group: null, status: order.status, typedAt: order.typedAt };
  }
  const group = groups.find((g) => g.invoiceId === sliceInvoiceId);
  return group ? { isDefault: false, groups, group, status: invoiceGroupStatus(order, group), typedAt: group.typedAt } : null;
}

// Invoice numbers are compared with every space stripped. Taken = already
// used by ANOTHER order, as its own invoice or one of its split invoices.
function invoiceNumberTaken(orders, orderId, normalized) {
  const strip = (v) => (v || '').replace(/\s+/g, '');
  return orders.some((o) => o.id !== orderId && (
    strip(o.invoiceId) === normalized || (o.invoiceGroups || []).some((g) => strip(g.invoiceId) === normalized)
  ));
}

// An invoice_groups entry with `keys` pulled out (both from jenisPlakList and
// any partial-split QTY for them).
function withoutJenisPlak(group, keys) {
  const { qtyByJenisPlak, ...rest } = group;
  const jenisPlakList = (group.jenisPlakList || []).filter((k) => !keys.includes(k));
  return withSplitQty({ ...rest, jenisPlakList }, Object.fromEntries(
    Object.entries(qtyByJenisPlak || {}).filter(([k]) => !keys.includes(k)),
  ));
}

// Adds partial-split QTYs to a group; only stores `qtyByJenisPlak` when
// there is at least one, so a whole-Jenis-Plak group looks exactly like
// one saved before partial splits existed.
function withSplitQty(group, qtyByJenisPlak) {
  const merged = { ...(group.qtyByJenisPlak || {}), ...qtyByJenisPlak };
  const { qtyByJenisPlak: _drop, ...rest } = group;
  return Object.keys(merged).length ? { ...rest, qtyByJenisPlak: merged } : rest;
}

// Finds a catalog node by id anywhere in the tree, along with the sibling
// array it lives in (its parent's `children`, or the root array for a
// top-level code) — used to reorder a node relative to its siblings.
function findNodeAndSiblings(nodes, id, siblings) {
  const parentSiblings = siblings || nodes;
  for (const node of nodes) {
    if (node.id === id) return { node, siblings: parentSiblings };
    if (node.children) {
      const found = findNodeAndSiblings(node.children, id, node.children);
      if (found) return found;
    }
  }
  return null;
}

// Clears one category's draft fields back to blank (used after "Add to Cart"
// and by the standalone reset action) — extracted so both call sites share
// the id-counter bookkeeping instead of drifting apart. `visibleField` is
// whichever state key tracks per-category visible-block counts
// (visibleBlocksByCategory for New Order, addOnVisibleBlocksByCategory for
// Add On) — passed in so this helper works for both draft namespaces.
// One cart category's items back into the New Order form (Edit / Back to Order).
function restoreCategoryDraft(st, categoryKey) {
  const itemsForCat = st.cart.filter((ci) => ci.categoryKey === categoryKey);
  if (itemsForCat.length === 0) return {};
  const restored = buildDraftFromOrder({ items: itemsForCat });
  const newLineValues = { ...st.lineValues };
  Object.keys(newLineValues).forEach((k) => { if (k.startsWith(`${categoryKey}::`)) delete newLineValues[k]; });
  Object.assign(newLineValues, restored.lineValues);
  const newMatrixValues = { ...st.matrixValues };
  Object.keys(newMatrixValues).forEach((k) => { if (k.startsWith(`${categoryKey}::`)) delete newMatrixValues[k]; });
  Object.assign(newMatrixValues, restored.matrixValues);
  // Drop this category's stale per-level Nama Kelas lists before merging
  // the restored ones back (same reason lineValues/matrixValues clear).
  const newRowsByBlock = { ...st.rowsByBlock };
  Object.keys(newRowsByBlock).forEach((k) => {
    if (k.startsWith(`${categoryKey}::`) && (k.endsWith('::main') || k.endsWith('::moral'))) delete newRowsByBlock[k];
  });
  Object.assign(newRowsByBlock, restored.rowsByBlock);
  return {
    category: categoryKey,
    lineValues: newLineValues,
    matrixValues: newMatrixValues,
    rowsByBlock: newRowsByBlock,
    columnsByBlock: { ...st.columnsByBlock, ...restored.columnsByBlock },
    plakRows: { ...st.plakRows, ...restored.plakRows },
    nextRowId: Math.max(st.nextRowId, restored.nextId),
    nextColumnId: Math.max(st.nextColumnId, restored.nextId),
    visibleBlocksByCategory: { ...st.visibleBlocksByCategory, [categoryKey]: restored.visibleBlocksByCategory[categoryKey] },
  };
}

// Takes tabs off the New Order draft: a fixed category back to its blank
// start, a tab of its own (dynamic key) off the page altogether.
function removeDraftTabs(st, keys) {
  let next = st;
  keys.forEach((catKey) => {
    next = { ...next, ...resetCategoryFields(catKey, next, 'visibleBlocksByCategory') };
    if (!isDynamicCategoryKey(catKey)) return;
    const drop = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !k.startsWith(`${catKey}::`)));
    const visible = { ...next.visibleBlocksByCategory };
    delete visible[catKey];
    next = {
      ...next, lineValues: drop(next.lineValues), matrixValues: drop(next.matrixValues), rowsByBlock: drop(next.rowsByBlock),
      columnsByBlock: drop(next.columnsByBlock), plakRows: drop(next.plakRows), visibleBlocksByCategory: visible,
    };
  });
  return next;
}

function resetCategoryFields(catKey, st, visibleField) {
  const cat = resolveCategory(catKey);
  const lineValues = { ...st.lineValues };
  Object.keys(lineValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete lineValues[k]; });
  const matrixValues = { ...st.matrixValues };
  Object.keys(matrixValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete matrixValues[k]; });
  const rowsByBlock = { ...st.rowsByBlock };
  // Per-level Nama Kelas lists (PPKI/PBD/ALIRAN_KELAS — `${catKey}::${b}::
  // ${level}::main`/`::moral`) aren't the plain `${catKey}::${b}` key the
  // per-mode reset below rewrites, so clear them here too — otherwise the
  // next round inherits the previous one's classes.
  Object.keys(rowsByBlock).forEach((k) => {
    if (k.startsWith(`${catKey}::`) && (k.endsWith('::main') || k.endsWith('::moral'))) delete rowsByBlock[k];
  });
  const columnsByBlock = { ...st.columnsByBlock };
  const plakRows = { ...st.plakRows };
  let nextColumnId = st.nextColumnId;
  for (let b = 0; b < (cat.blocksCount || 1); b++) {
    const key = `${catKey}::${b}`;
    if (cat.mode === 'list') {
      // LONJAKAN resets back to its fixed preset rows; TOKOH resets to one
      // blank teacher-typed row (no `rows` preset — see catalog.js); OTHERS'
      // own block 0 resets back to MP THP's subject list (seedRowsFromSubjects
      // — same head-start as formDefaults.js's initial seed, since a reset
      // here means the teacher just added one Tahun's items to cart and is
      // about to start the next).
      rowsByBlock[key] = cat.rows && cat.rows.length > 0
        ? cat.rows.map((label, i) => ({ id: st.nextRowId + i, desc: label, qty: '' }))
        : cat.seedRowsFromSubjects && b === 0
          ? getCategorySubjects(cat, st.schoolLanguage).map((subject, i) => ({ id: st.nextRowId + i, desc: subject, qty: '', custom: true }))
          : [{ id: st.nextRowId, desc: '', qty: '', custom: true }];
      if (cat.hasNamaKelasList) {
        columnsByBlock[key] = [{ id: nextColumnId, name: '' }];
        nextColumnId += 1;
      }
    }
    if (cat.mode === 'dynamicMatrix') {
      rowsByBlock[key] = getCategorySubjects(cat, st.schoolLanguage).map((subject, i) => ({ id: st.nextRowId + i, desc: subject, custom: !!cat.editableDefaultSubjects }));
      columnsByBlock[key] = [{ id: nextColumnId, tahunFrom: '', tahunTo: '', namaKelas: '' }];
      nextColumnId += 1;
    }
    plakRows[key] = [{ id: st.nextPlakRowId + b, jenisPlak: '' }];
  }
  return {
    lineValues, matrixValues, rowsByBlock, columnsByBlock, plakRows,
    nextRowId: st.nextRowId + 20, nextPlakRowId: st.nextPlakRowId + 10, nextColumnId,
    // Back to just block 0 visible for next round's "Duplicate" reveals —
    // no-op for every other category (they never touch visibleField).
    [visibleField]: { ...st[visibleField], [catKey]: 1 },
  };
}

// The Add On draft seen through New Order's field names, so
// buildCategoryCartItems / resetCategoryFields work on it unchanged.
const ADDON_DRAFT_FIELDS = {
  addOnLineValues: 'lineValues', addOnMatrixValues: 'matrixValues', addOnRowsByBlock: 'rowsByBlock',
  addOnPlakRows: 'plakRows', addOnColumnsByBlock: 'columnsByBlock',
  addOnNextRowId: 'nextRowId', addOnNextPlakRowId: 'nextPlakRowId', addOnNextColumnId: 'nextColumnId',
};
const addOnAsDraft = (st) => ({ ...st, ...Object.fromEntries(Object.entries(ADDON_DRAFT_FIELDS).map(([a, d]) => [d, st[a]])) });
const draftToAddOn = (view) => ({
  ...Object.fromEntries(Object.entries(ADDON_DRAFT_FIELDS).map(([a, d]) => [a, view[d]])),
  addOnVisibleBlocksByCategory: view.addOnVisibleBlocksByCategory,
});

function initialState() {
  return {
    userId: '',
    password: '',
    loginError: '',
    role: null,
    isSalesManager: false,
    isStoreAdminManager: false,
    isProductionManager: false,
    sessionChecked: false,

    sekolah: '',
    schoolLanguage: 'SK',
    // Salesman New Order: the school (teacher account id) picked on Step 1.
    actingSchoolId: null,
    sales: '',
    assignedSalesmen: [],
    assignedSalesmanLoaded: false,
    selectedSalesmanId: '',
    picName: '',
    phone: '',
    ketuaPanitia: '',
    terms: '',
    remark: '',
    shipmentDateSelected: null,
    funcSelected: null,
    logoDataUrl: null,
    logoFileName: '',
    logoRemark: '',
    schoolType: null,
    stepError: '',

    // The teacher's raw FORM ANUGERAH upload, kept as a backup on the order
    // for Production/Store Admin/Admin to cross-check (see storageApi's
    // uploadOrderImportFile, migration 0055). Set async after an import,
    // stamped onto the order at submit.
    importFilePath: null,
    importFileName: null,
    // Every file uploaded in this draft ({ path, name }) — a teacher can
    // import a second Excel before submitting, so each cart item remembers
    // its own file (`importFile`) and the order keeps all of them.
    importFiles: [],
    // The teacher's kertas kerja ({ path, name }) uploaded on Order Details (0110), for Production
    // to compare with the order; addOnKertasKerja is the Add On's.
    kertasKerjaFiles: [],
    addOnKertasKerja: [],
    // Salesman Edit Order (Sean, 2026-11-07): the New Order flow is open on this submitted order
    // (Step 1 → Step 2 → Cart's Save Changes saves over it) — null for a normal New Order.
    editOrderId: null,

    // No category open on entry to Order Details — the teacher either
    // uploads a FORM ANUGERAH file (which auto-selects whichever categories
    // it filled) or clicks a category tab to fill one in by hand. See
    // NewOrderStep2.jsx's "pick a category or upload" placeholder.
    category: null,
    lineValues: {},
    matrixValues: {},
    rowsByBlock: buildInitialRowsByBlock('SK'),
    columnsByBlock: buildInitialColumnsByBlock(),
    plakRows: buildInitialPlakRows(),
    nextRowId: 1000,
    nextPlakRowId: 1000,
    nextColumnId: 1000,
    // How many of a category's pre-allocated blocks (see catalog.js's
    // blocksCount — only OTHERS has more than 1) are currently revealed —
    // keyed by category so it generalizes if another category ever needs
    // more than one block too. Absent/undefined reads as 1 everywhere this
    // is consulted (computeBlocks itself doesn't need it — every block is
    // always computed; only NewOrderStep2/AddOn's rendering slices by it).
    visibleBlocksByCategory: {},

    cart: [],
    cartToast: '',

    orders: [],
    ordersLoaded: false,
    lastOrderId: '',
    updateToast: '',
    productionToast: '',
    // Google Sheets sync failure messages for urgent orders, keyed by order
    // id — persists (unlike the auto-clearing toasts above) until a retry
    // succeeds, so the retry affordance on StoreAdminOrderDetail.jsx has
    // something to show. See attemptUrgentSheetSync/retryUrgentSheetSync.
    sheetSyncErrors: {},

    plakCatalog: [],
    plakCatalogLoaded: false,

    draftRestoredToast: '',

    addOnOrderId: null,
    // the order so far (original + earlier Tambahan) the Add On page opened with; null = blank page (Excel upload)
    addOnBaseItems: null,
    addOnCart: [],
    addOnImportFilePath: null, addOnImportFileName: null,
    addOnCategory: null,
    addOnLineValues: {},
    addOnMatrixValues: {},
    addOnRowsByBlock: buildInitialRowsByBlock('SK'),
    addOnColumnsByBlock: buildInitialColumnsByBlock(),
    addOnPlakRows: buildInitialPlakRows(),
    addOnNextRowId: 1000,
    addOnNextPlakRowId: 1000,
    addOnNextColumnId: 1000,
    addOnVisibleBlocksByCategory: {},

    // Teacher editing under Reviewing Order (until Done Review) (see openAmend/updateAmend
    // below) — same draft-namespace-per-flow pattern as addOn* above.
    amendOrderId: null,
    amendCategory: '',
    amendLineValues: {},
    amendMatrixValues: {},
    amendRowsByBlock: buildInitialRowsByBlock('SK'),
    amendColumnsByBlock: buildInitialColumnsByBlock(),
    amendPlakRows: buildInitialPlakRows(),
    amendNextRowId: 1000,
    amendNextPlakRowId: 1000,
    amendNextColumnId: 1000,
    amendVisibleBlocksByCategory: {},

    // Production's own "corrected Excel" draft (see uploadCorrectedExcel /
    // loadCorrectedExcelPreview below) — a throwaway scratch parse, never
    // shown as an editable screen (unlike addOn*/amend* above). Reset before
    // every parse so prodExcelVisibleBlocksByCategory ends up holding
    // exactly the categories THIS file touched, nothing left over from a
    // previous order.
    prodExcelCategory: '',
    prodExcelLineValues: {},
    prodExcelMatrixValues: {},
    prodExcelRowsByBlock: buildInitialRowsByBlock('SK'),
    prodExcelColumnsByBlock: buildInitialColumnsByBlock(),
    prodExcelPlakRows: buildInitialPlakRows(),
    prodExcelNextRowId: 1000,
    prodExcelNextPlakRowId: 1000,
    prodExcelNextColumnId: 1000,
    prodExcelVisibleBlocksByCategory: {},
  };
}

// Draft-namespace field mapping for importFormAnugerahExcelInto's New Order
// call site — every generic name maps to itself. AddOn.jsx calls
// importFormAnugerahExcelInto directly with its OWN remapped `fields` (its
// existing DRAFT_FIELDS, src/pages/AddOn.jsx, plus `category:
// 'addOnCategory'`) for the Tambahan diff-upload feature — `remark`/
// `importFilePath`/`importFileName` are simply left undefined there (no
// AddOn-side equivalent; see src/utils/addOnDiff.js), which no-ops those
// two blocks in importFormAnugerahExcelInto rather than building new
// addOnRemark/addOnImportFilePath plumbing nothing else in the AddOn flow
// reads. Module-level (not a component-local const) so it's a stable
// reference for the importFormAnugerahExcel wrapper's useCallback deps.

// Production's "corrected Excel" scratch import (uploadCorrectedExcel /
// loadCorrectedExcelPreview below) — remark/importFilePath/importFileName
// left undefined (no equivalent; no-ops those blocks in
// importFormAnugerahExcelInto), same as ADDON_IMPORT_FIELDS.
const PROD_EXCEL_IMPORT_FIELDS = {
  lineValues: 'prodExcelLineValues', matrixValues: 'prodExcelMatrixValues', rowsByBlock: 'prodExcelRowsByBlock',
  columnsByBlock: 'prodExcelColumnsByBlock', plakRows: 'prodExcelPlakRows',
  nextRowId: 'prodExcelNextRowId', nextColumnId: 'prodExcelNextColumnId', nextPlakRowId: 'prodExcelNextPlakRowId',
  visibleBlocksByCategory: 'prodExcelVisibleBlocksByCategory', category: 'prodExcelCategory',
};

export function AppStateProvider({ children }) {
  const [state, setState] = useState(initialState);
  const toastTimer = useRef(null);
  const productionToastTimer = useRef(null);
  const draftToastTimer = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((updater) => {
    setState((prev) => ({ ...prev, ...(typeof updater === 'function' ? updater(prev) : updater) }));
  }, []);

  // Shows a message on one of the transient toast state keys (updateToast /
  // productionToast / cartToast) and clears it after a few seconds. Shared
  // by the order-write actions below so they all surface success/failure
  // the same way instead of each rolling their own timer.
  const toastFlashTimer = useRef(null);
  const flashToast = useCallback((key, message) => {
    patch({ [key]: message });
    clearTimeout(toastFlashTimer.current);
    toastFlashTimer.current = setTimeout(() => patch({ [key]: '' }), 3500);
  }, [patch]);

  // Autosave the in-progress order draft so a crash, closed tab, or dead
  // battery mid-order doesn't lose what the teacher already filled in —
  // debounced while typing, flushed immediately on tab close, and always
  // available again on reload since initialState() reads it back.

  // supabase-js persists the auth session in localStorage on its own, but
  // a hard refresh still wipes this component's in-memory state back to
  // role: null — so without this, every refresh bounced a logged-in user
  // back to the Login screen. On first mount, check whether a Supabase
  // session already exists and restore role/sekolah/userAuthId from it
  // before anything renders a route (see the sessionChecked gate in
  // App.jsx), so a refresh lands back on the same page instead.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        // A failed profile fetch here used to be indistinguishable from
        // "not logged in" — role never got set, sessionChecked still
        // flipped true, and RequireRole bounced a perfectly-valid session
        // back to Login. That's not hypothetical: this project is on
        // Supabase's Free tier, where the database can take a moment to
        // wake up after being idle, which is enough to fail this one
        // query on an otherwise-valid refresh. Retry a few times with a
        // short backoff before treating it as a real failure — a login
        // that already succeeded shouldn't be undone by one slow query.
        let profile, profileError;
        for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
          ({ data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role, sekolah, school_language, display_name, status, is_sales_manager, is_store_admin_manager, is_production_manager')
            .eq('id', session.user.id)
            .single());
          if (profile || !profileError) break;
        }
        if (!cancelled && profile) {
          if (profile.status && profile.status !== 'active') {
            await supabase.auth.signOut();
            if (!cancelled) patch({ loginError: 'This account has been deactivated. Please contact your administrator.' });
          } else {
            patch({ role: profile.role, sekolah: profile.sekolah || '', schoolLanguage: profile.school_language || 'SK', userAuthId: session.user.id, isSalesManager: !!profile.is_sales_manager, isStoreAdminManager: !!profile.is_store_admin_manager, isProductionManager: !!profile.is_production_manager });
          }
        } else if (!cancelled && profileError) {
          // Still failing after retries — rather than silently bouncing to
          // Login with no explanation (looks like a random logout), leave
          // the Supabase session intact and surface what actually
          // happened, so the user can just retry instead of re-entering
          // their password for no reason.
          console.error('Failed to load profile on session restore:', profileError);
          patch({ loginError: 'Could not verify your account (connection issue). Please try again.' });
        }
      }
      if (!cancelled) patch({ sessionChecked: true });
    })();
    return () => { cancelled = true; };
  }, [patch]);

  // Set by logout() so the SIGNED_OUT handler below knows this sign-out was
  // the user's own choice (no "session expired" message) rather than a
  // token that finally couldn't be refreshed.
  const deliberateLogoutRef = useRef(false);

  // Without this, once the auth token expired the UI kept showing the
  // logged-in pages (role is still in memory) while every request went out
  // as `anon` — surfacing as "permission denied for function current_role"
  // and "Missing Authorization header" instead of a clean sign-out. This
  // catches the moment the session actually ends — an expired token that
  // couldn't be refreshed, a sign-out in another tab, a revoked account —
  // and drops straight back to Login with a plain message.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
      if (event !== 'SIGNED_OUT') return;
      // GoTrue emits SIGNED_OUT during its own start-up (recover-and-refresh)
      // too — before we've even restored the session. Let the session-restore
      // effect above own that first check, or a cold-start token refresh on
      // the free tier would bounce a login that's actually fine.
      if (!stateRef.current.sessionChecked) return;
      // Already on a logged-out screen — nothing to tear down (this also
      // covers a SIGNED_OUT echoed in from another tab while we sit on Login).
      if (!stateRef.current.role) return;
      // Double-check the session is really gone before showing "expired" and
      // wiping state: a transient refresh hiccup can emit SIGNED_OUT while a
      // usable session is still in storage.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return;
      const wasDeliberate = deliberateLogoutRef.current;
      deliberateLogoutRef.current = false;
      // Keep a more specific message if one is already on screen (e.g. the
      // "account deactivated" the session-restore / login flow sets right
      // before it signs the user out).
      setState((prev) => ({
        ...initialState(),
        sessionChecked: true,
        loginError: prev.loginError || (wasDeliberate ? '' : 'Sesi anda telah tamat. Sila log masuk semula.'),
      }));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Orders live in Supabase (see supabase/migrations/0001_orders.sql) —
  // pull whatever's really in the table on first load. No mock/sample
  // fallback: an empty table means an empty dashboard.
  useEffect(() => {
    if (!state.role) return undefined;
    let cancelled = false;
    fetchOrders(state.userAuthId, state.role)
      .then((orders) => { if (!cancelled) patch({ orders, ordersLoaded: true }); })
      .catch((err) => {
        console.error('Failed to load orders from Supabase:', err);
        if (!cancelled) patch({ ordersLoaded: true });
      });
    return () => { cancelled = true; };
  }, [patch, state.role, state.userAuthId]);

  // Every salesman account — the New Order flow lets the teacher freely
  // pick any of them (see
  // supabase/migrations/0039_teacher_free_salesman_pick_invoicing_assign.sql;
  // Admin no longer manages a school<->salesman relationship at all).
  // `refreshAssignedSalesman` (name kept as-is — still "the salesman
  // assigned to this order") lets NewOrderStep1 re-fetch the list fresh
  // every time the New Order flow starts, on top of this once-per-login
  // fetch, so a newly-created salesman account is picked up rather than
  // trusting a stale value carried over from login.
  const refreshAssignedSalesman = useCallback(async () => {
    const st = stateRef.current;
    if (!['teacher', 'salesman'].includes(st.role) || !st.userAuthId) return;
    try {
      // A salesman's own New Order (on a school's behalf) is always theirs.
      const all = await fetchAllSalesmen();
      const salesmen = st.role === 'salesman' ? all.filter((s) => s.id === st.userAuthId) : all;
      patch((latest) => {
        // Keep the teacher's already-picked salesman if it's still in the
        // (possibly changed) assigned list; auto-pick when there's only
        // one option so the common case needs no extra click.
        const stillValid = salesmen.some((s) => s.id === latest.selectedSalesmanId);
        const selectedSalesmanId = stillValid ? latest.selectedSalesmanId : (salesmen.length === 1 ? salesmen[0].id : '');
        const selected = salesmen.find((s) => s.id === selectedSalesmanId);
        return {
          assignedSalesmen: salesmen, assignedSalesmanLoaded: true,
          selectedSalesmanId, sales: selected?.name || '',
        };
      });
    } catch (err) {
      console.error('Failed to load assigned salesmen:', err);
      patch({ assignedSalesmen: [], assignedSalesmanLoaded: true, selectedSalesmanId: '', sales: '' });
    }
  }, [patch]);

  useEffect(() => {
    if (state.role === 'teacher' && state.userAuthId) refreshAssignedSalesman();
  }, [state.role, state.userAuthId, refreshAssignedSalesman]);

  // The Jenis Plak catalog is a global setting Production manages (see
  // catalogAdminApi.js) — fetched once per login so logging out and into a
  // different account still picks up the latest.
  useEffect(() => {
    if (!state.role) return undefined;
    let cancelled = false;
    fetchPlakCatalog()
      .then((plakCatalog) => { if (!cancelled) patch({ plakCatalog, plakCatalogLoaded: true }); })
      .catch((err) => {
        console.error('Failed to load catalog settings from Supabase:', err);
        if (!cancelled) patch({ plakCatalogLoaded: true });
      });
    return () => { cancelled = true; };
  }, [patch, state.role]);

  // Admin's Grammar Check Dictionary additions (custom_typo_words) — merged
  // into typoCheck.js's in-memory dictionary so every existing typo hint
  // (Reference Sample / Kuantiti Description) also checks against them.
  // No `state` field for this — nothing else reads it, it's purely a side
  // effect that warms up typoCheck.js's module-level word list. Fetched
  // once per login, same as the Jenis Plak catalog above; an admin's own
  // add/remove on AdminAiUsage.jsx additionally calls setCustomTypoWords
  // directly so that session sees it right away too.
  useEffect(() => {
    if (!state.role) return undefined;
    let cancelled = false;
    fetchCustomTypoWords()
      .then((rows) => { if (!cancelled) setCustomTypoWords(rows.map((r) => r.word)); })
      .catch((err) => console.error('Failed to load custom typo words from Supabase:', err));
    return () => { cancelled = true; };
  }, [state.role]);

  const initialDraftToastRef = useRef(state.draftRestoredToast);
  useEffect(() => {
    if (!initialDraftToastRef.current) return undefined;
    draftToastTimer.current = setTimeout(() => patch({ draftRestoredToast: '' }), 4000);
    return () => clearTimeout(draftToastTimer.current);
  }, [patch]);

  // Returns the matched role on success (for the caller to route on), or
  // null on failure (and records the error for the Login screen to show).
  const login = useCallback(async (userId, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: userId,
      password: password,
    });
    if (error) {
      patch({ loginError: 'Invalid User ID or Password.' });
      return null;
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, sekolah, school_language, display_name, status, is_sales_manager, is_store_admin_manager, is_production_manager')
      .eq('id', data.user.id)
      .single();
    if (profileError || !profile) {
      patch({ loginError: 'No role found for this account.' });
      return null;
    }
    if (profile.status && profile.status !== 'active') {
      await supabase.auth.signOut();
      patch({ loginError: 'This account has been deactivated. Please contact your administrator.' });
      return null;
    }
    patch({ role: profile.role, sekolah: profile.sekolah || '', schoolLanguage: profile.school_language || 'SK', userAuthId: data.user.id, isSalesManager: !!profile.is_sales_manager, isStoreAdminManager: !!profile.is_store_admin_manager, isProductionManager: !!profile.is_production_manager, loginError: '', userId: '', password: '' });
    return profile.role;
  }, [patch]);

  // A full reset, not a patch — logging out ends the session, so nothing
  // from the previous account (draft fields, cart, loaded orders) should
  // carry over to whoever logs in next on this browser tab. Also clears
  // the Supabase session itself (not just local state) — otherwise the
  // session-restore effect above would silently log the same account back
  // in on the next refresh.
  const logout = useCallback(() => {
    deliberateLogoutRef.current = true;
    supabase.auth.signOut().catch((err) => console.error('Failed to sign out of Supabase:', err));
    setState({ ...initialState(), sessionChecked: true });
  }, []);

  const resetCurrentCategory = useCallback((catKey) => {
    patch((st) => resetCategoryFields(catKey, st, 'visibleBlocksByCategory'));
  }, [patch]);

  // Wipes the New Order draft (Function Details + Order Details + cart)
  // back to blank whenever the teacher (re)starts the flow via the "New
  // Order" nav link or "Place Another Order" — every field except Sekolah,
  // which stays pinned to the account's school from login.
  const startNewOrder = useCallback(() => {
    clearCrystalDraft(); // a new order starts with no crystal changes
    patch((st) => ({
      sales: '', picName: '', phone: '', ketuaPanitia: '', terms: '', remark: '',
      shipmentDateSelected: null, funcSelected: null,
      logoDataUrl: null, logoFileName: '', logoRemark: '', schoolType: null, stepError: '',
      importFilePath: null, importFileName: null, importFiles: [], kertasKerjaFiles: [],
      step2ImportStatus: null, step2ChoiceAnswers: {},
      step2UploadedFiles: [],

      category: null,
      lineValues: {}, matrixValues: {},
      rowsByBlock: buildInitialRowsByBlock(st.schoolLanguage), columnsByBlock: buildInitialColumnsByBlock(), plakRows: buildInitialPlakRows(),
      nextRowId: 1000, nextPlakRowId: 1000, nextColumnId: 1000, visibleBlocksByCategory: {},

      cart: [], cartToast: '', editOrderId: null,
      // A salesman picks the school fresh for every New Order.
      ...(st.role === 'salesman' ? { sekolah: '', actingSchoolId: null } : {}),
    }));
  }, [patch]);

  // Salesman New Order, Step 1: the school this order is for. Its language
  // decides the default subject lists, so the blank draft is rebuilt for it.
  const pickActingSchool = useCallback((school) => {
    patch((st) => {
      if (!school) return { actingSchoolId: null, sekolah: '' };
      return {
        actingSchoolId: school.id, sekolah: school.sekolah, schoolLanguage: school.schoolLanguage, stepError: '',
        ...(school.schoolLanguage !== st.schoolLanguage ? { rowsByBlock: buildInitialRowsByBlock(school.schoolLanguage) } : {}),
      };
    });
  }, [patch]);

  const addToCart = useCallback(() => {
    setState((st) => {
      const { error, items } = buildCategoryCartItems(st, st.category);
      if (error) return { ...st, cartToast: error };
      if (!items || items.length === 0) {
        return { ...st, cartToast: 'No filled Jenis Plak rows to add.' };
      }
      // Only clears this category's fields once something was actually
      // added — bailing out above (validation error or nothing filled)
      // must never wipe out what the teacher already typed.
      //
      // Replaces (not appends to) this category's existing cart entries —
      // matters for the Edit flow (editCartCategory leaves the original
      // items in place rather than removing them upfront), so re-adding
      // after edits supersedes the old version instead of duplicating it.
      return {
        ...st,
        cart: [...st.cart.filter((ci) => ci.categoryKey !== st.category), ...tagImportFiles(items, st)],
        cartToast: `Added ${items.length} item(s) to cart.`,
        ...resetCategoryFields(st.category, st, 'visibleBlocksByCategory'),
      };
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ cartToast: '' }), 2500);
  }, [patch]);

  // "Add All to Cart" — after an import fills several categories at once
  // (PPKI + MP THP 2 + PBD + ...), the teacher shouldn't have to click into
  // each tab and add it separately. Walks every active category, adds each
  // one that has filled data, and clears it — atomically: a validation
  // error in ANY category aborts the whole thing (adding nothing, switching
  // to that category so the teacher lands on the field to fix), rather than
  // adding some categories and leaving the teacher unsure which made it in.
  const addAllToCart = useCallback(() => {
    setState((st) => {
      let working = st;
      const allItems = [];
      const doneLabels = [];
      // Any sheet-derived dynamic category the current import left in the
      // draft (see AppState.jsx's `parsed.categorized` handling above) —
      // it has no standing ACTIVE_CATEGORIES tab of its own, so it's only
      // ever discoverable via visibleBlocksByCategory.
      const dynamicCats = Object.keys(st.visibleBlocksByCategory || {})
        .filter(isDynamicCategoryKey)
        .map(resolveCategory)
        .filter(Boolean);
      for (const cat of [...ACTIVE_CATEGORIES, ...dynamicCats]) {
        const { engaged, error, items } = buildCategoryCartItems(working, cat.key);
        if (!engaged) continue;
        if (error) return { ...st, category: cat.key, cartToast: `${cat.label}: ${error}` };
        allItems.push(...items);
        doneLabels.push(cat.label);
        working = { ...working, ...resetCategoryFields(cat.key, working, 'visibleBlocksByCategory') };
      }
      if (allItems.length === 0) {
        return { ...st, cartToast: 'No filled categories to add to cart.' };
      }
      // Replaces each touched category's existing cart entries rather than
      // appending duplicates — same reasoning as addToCart's own note.
      const touchedKeys = new Set(allItems.map((it) => it.categoryKey));
      return {
        ...working,
        cart: [...working.cart.filter((ci) => !touchedKeys.has(ci.categoryKey)), ...tagImportFiles(allItems, st)],
        cartToast: `Added ${allItems.length} item(s) from ${doneLabels.length} categor${doneLabels.length === 1 ? 'y' : 'ies'} to cart.`,
      };
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ cartToast: '' }), 3000);
  }, [patch]);

  // Add On's own "Add This Category Only" / "Add All to Cart" (Sean,
  // 2026-10-09) — same checks and items as New Order's, into addOnCart.
  const addOnAddToCart = useCallback((allCategories) => {
    setState((st) => {
      let view = addOnAsDraft(st);
      const order = st.orders.find((o) => o.id === st.addOnOrderId);
      const dynamicKeys = [
        ...categoriesUsedByItems(order?.items || []).map((c) => c.key),
        ...Object.keys(st.addOnVisibleBlocksByCategory || {}),
      ].filter(isDynamicCategoryKey);
      const cats = allCategories
        ? [...ACTIVE_CATEGORIES, ...[...new Set(dynamicKeys)].map(resolveCategory).filter(Boolean)]
        : [resolveCategory(st.addOnCategory)].filter(Boolean);
      // Opened with the order so far: its own wording was already accepted, so a typo hint doesn't
      // block, and the page stays as typed (only what grew goes to the cart).
      const base = st.addOnBaseItems;
      const allItems = [];
      const builtKeys = new Set();
      for (const cat of cats) {
        const { engaged, error, items } = buildCategoryCartItems(view, cat.key, { allowTypos: !!base });
        if (!engaged && allCategories) continue;
        if (error) return { ...st, addOnCategory: cat.key, cartToast: `${cat.label}: ${error}` };
        if (!items || items.length === 0) continue;
        allItems.push(...items);
        builtKeys.add(cat.key);
        if (!base) view = { ...view, ...resetCategoryFields(cat.key, view, 'addOnVisibleBlocksByCategory') };
      }
      if (base) {
        const { items, errors } = diffAddonItems(base, allItems);
        if (errors.length) return { ...st, cartToast: errors[0] };
        const cart = [...st.addOnCart.filter((ci) => !builtKeys.has(ci.categoryKey)), ...withImportFile(items, st.addOnImportFilePath)];
        return {
          ...st, addOnCart: cart,
          cartToast: items.length ? `Tambahan: ${items.reduce((n, it) => n + (Number(it.qty) || 0), 0)} plaque(s) added to cart.` : 'Nothing added yet — raise a QTY or add a new row first.',
        };
      }
      if (allItems.length === 0) return { ...st, cartToast: 'No filled Jenis Plak rows to add.' };
      const touchedKeys = new Set(allItems.map((it) => it.categoryKey));
      return {
        ...st,
        ...draftToAddOn(view),
        addOnCart: [...st.addOnCart.filter((ci) => !touchedKeys.has(ci.categoryKey)), ...withImportFile(allItems, st.addOnImportFilePath)],
        cartToast: `Added ${allItems.length} item(s) to cart.`,
      };
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ cartToast: '' }), 3000);
  }, [patch]);

  const removeFromAddOnCart = useCallback((ids) => {
    patch((st) => ({ addOnCart: st.addOnCart.filter((ci) => !ids.includes(ci.id)) }));
  }, [patch]);

  // Reads a teacher-uploaded past order file — either a filled-in copy of
  // the FORM ANUGERAH Excel template (MP THP 1/2, PBD, LONJAKAN SAUJANA,
  // TOKOH, the native "KLAS MATRIX" sheet — see excelImport.js) or a Word
  // "WORDING / KUANTITI / KOD HADIAH" order table (see docxImport.js), a
  // completely different real-world shape some schools use instead. Both
  // parsers return the same `{ categorized, klasMatrix }` shape, so
  // whichever one matches the file's own extension feeds the same merge
  // step below (a Word award lands in its own dynamic category, see
  // docxImport.js). Deliberately REPLACES
  // rather than merges KLAS_MATRIX's own draft — this is meant to be the
  // teacher's starting point (see NewOrderStep2's "Import from Excel"
  // button), not layered on top of whatever's already there. Never adds
  // straight to cart — the teacher still reviews/edits on Step 2 and clicks
  // Add to Cart themselves, same as manual entry, so a parsing mistake
  // never silently reaches an order. Returns { ok, message } for the caller
  // to show; never throws.
  // `fields` maps this function's generic field names onto the caller's own
  // state-key namespace (see NEW_ORDER_IMPORT_FIELDS above / AddOn.jsx's
  // DRAFT_FIELDS) — the entire body below is pure field-name bookkeeping,
  // parameterized so the SAME import/parsing logic (subject ordering, plak
  // matching, level-breakdown storage, cross-check warnings) serves both
  // the New Order flow and the AddOn Tambahan-upload flow without a second,
  // drift-prone implementation.
  //
  // `applyFilter(catKey, key, maps)`, if provided, is called once per
  // category right after its rows/matrix cells are built into
  // newRowsByBlock/newMatrixValues/newPlakRows but BEFORE they're merged
  // into `next` — it may mutate those maps in place. Used by the AddOn
  // diff-confirmation "Apply" step (src/utils/addOnDiff.js) to keep only
  // the CONFIRMED new rows / confirmed quantity deltas instead of writing
  // the full re-parsed file (which would double-count content already in
  // the order). The New Order flow passes no filter (full import, as
  // today). Only wired into the `parsed.categorized` branch below — the
  // legacy KLAS_MATRIX branch is inactive for the current catalog (see the
  // klasMatrixActive check) and isn't a realistic AddOn target.
  // `parsedOverride` (the AI sheet reader below) skips reading the file
  // and the backup upload — the file was already read and uploaded once.
  // `instructions` (optional): how to read the file, in the user's words,
  // sent with a PDF / Word file the AI reader reads. `base` (optional): the
  // state to import into instead of the current one (convertImportToForm).
  const importFormAnugerahExcelInto = useCallback(async (file, fields, { applyFilter, parsedOverride, instructions = '', base = null, keep = null } = {}) => {
    let parsed = parsedOverride;
    if (!parsed) {
      try {
        const buffer = await file.arrayBuffer();
        if (/\.pdf$/i.test(file.name)) {
          // PDF orders go through the AI reader (pdfImport.js), so only
          // for the roles allowed to use it.
          parsed = canUseAiReader(stateRef.current.role)
            ? await parsePdfOrder(buffer, file.name, instructions)
            : { error: 'PDF orders are not available yet — please upload an .xlsx or .docx file.' };
        } else {
          parsed = /\.docx$/i.test(file.name) ? await parseWordingDocx(buffer) : parseFormAnugerahExcel(buffer);
          // A Word order without a table the rules know (a sample label
          // and a name list, ...) goes to the AI reader, for the roles
          // allowed to use it.
          if (parsed.error && /\.docx$/i.test(file.name) && canUseAiReader(stateRef.current.role)) {
            parsed = await parseDocxOrderWithAi(buffer, file.name, parsed.error, instructions);
          }
        }
      } catch (err) {
        console.error('Failed to read uploaded order file:', err);
        return { ok: false, message: 'Could not read this file. Please try again.' };
      }
    }
    if (parsed.error) {
      return { ok: false, message: parsed.error };
    }

    const st = base || stateRef.current;
    const { finalState, messages, warnings, skippedSheets, categories, parsed: placed } = applyParsedImport(st, parsed, fields, { applyFilter, keep });
    parsed = placed;
    // A Word / PDF order is read twice (convertImportToForm): the first read's file upload lands
    // while the FORM ANUGERAH copy is being made, and this second write — built on that first
    // read's draft (`base`) — must not wipe it, or the order is saved with no file (ORD-0090).
    setState(base && fields.importFilePath
      ? (latest) => ({
        ...finalState,
        [fields.importFilePath]: latest[fields.importFilePath],
        [fields.importFileName]: latest[fields.importFileName],
        ...(fields.importFilePath === 'importFilePath' ? { importFiles: latest.importFiles } : {}),
      })
      : finalState);

    // Keep the raw upload as a backup on the order — Production / Store
    // Admin / Admin download it to cross-check the order details (0055).
    // Fire-and-forget: a failure here just means no backup file, the import
    // already succeeded. An earlier file in the same draft is kept — cart
    // items already added from it still point at it (`importFile`). No
    // AddOn-side equivalent (fields.importFilePath undefined there) —
    // skipped entirely for that flow.
    if (fields.importFilePath && !parsedOverride) {
      uploadOrderImportFile(file).then((res) => {
        if (res) {
          patch((latest) => ({
            [fields.importFilePath]: res.path, [fields.importFileName]: res.name,
            ...(fields.importFilePath === 'importFilePath' ? { importFiles: [...(latest.importFiles || []), res] } : {}),
          }));
        }
      });
    }

    // `draft` is the actual just-committed state, for a caller that needs
    // it back synchronously instead of waiting for a re-render to read it
    // off `state`/`stateRef` — `setState` above won't have been applied by
    // the time an `await`-continuation right after this resolves (that
    // race is exactly what silently emptied every category the very first
    // time parseCorrectedExcelIntoItems read stateRef.current here).
    // Sheets the rule-based reader skipped — what the AI sheet reader can
    // be offered for (NewOrderStep2.jsx).
    // A PDF/Word order read by the AI reader: its tabs, so the page can
    // offer them as a filled-in FORM ANUGERAH (templateExport.js).
    const aiCategorized = parsed.aiRead ? parsed.categorized : undefined;
    return { ok: true, message: `Imported — ${messages.join('; ')}. Please review carefully before adding to cart.`, warnings, draft: finalState, skippedSheets, aiCategorized, categories };
  }, [patch]);

  // Thin, zero-behavior-change wrapper for the existing New Order call site
  // (NewOrderStep2.jsx) — always imports into the New Order draft namespace,
  // full import, no diff filter.
  const importFormAnugerahExcel = useCallback(
    (file, { instructions, keep } = {}) => importFormAnugerahExcelInto(file, NEW_ORDER_IMPORT_FIELDS, { instructions, keep }),
    [importFormAnugerahExcelInto],
  );

  // A Word / PDF order straight into the FORM ANUGERAH layout (Sean,
  // 2026-10-19): `first` (its import result) has its tabs written into the
  // form and read back like an uploaded form (formRoundTrip.js), replacing
  // them, so the order shows and is saved the way an Excel order is. When
  // that can't be done whole, the tabs stay as read and a note says why.
  const convertImportToForm = useCallback(async (file, first, { keep = null } = {}) => {
    const keys = first.categories || [];
    if (!first.ok || !first.draft || keys.length === 0) return first;
    let conv;
    try {
      const res = await fetch(FORM_TEMPLATE_URL);
      conv = res.ok
        ? await draftToFormParsed(first.draft, keys, await res.arrayBuffer())
        : { error: 'the blank FORM ANUGERAH template is not on the site' };
    } catch (err) {
      console.error('Could not put the order into the FORM ANUGERAH layout:', err);
      conv = { error: 'the form could not be made' };
    }
    const base = removeDraftTabs(first.draft, keys);
    // A tab the form fills that already has another file's order in it
    // would be overwritten, so those stay as read.
    if (!conv.error) {
      const taken = Object.entries(conv.parsed.categorized || {})
        .filter(([k, secs]) => secs?.length && !keys.includes(k) && !keep?.has(k))
        .filter(([k]) => { const d = draftPlaques(base, { only: [k] }); return d.plaques.length + d.selempang.length + d.skipped.length > 0; })
        .map(([k]) => resolveCategory(k)?.label || k);
      if (taken.length) conv = { error: `the ${taken.join(', ')} tab already has an order in it` };
    }
    const second = conv.error ? null : await importFormAnugerahExcelInto(file, NEW_ORDER_IMPORT_FIELDS, {
      parsedOverride: conv.parsed, base, keep,
    });
    if (!second?.ok) {
      const why = conv.error || second?.message || 'the form could not be read back';
      return { ...first, warnings: [...(first.warnings || []), { type: 'truncated', text: `Kept as read, not in the FORM ANUGERAH layout: ${why}.` }] };
    }
    // The first read's notes stay (what the AI says about the file), and so
    // do its unmatched Jenis Plak codes: the form only carries them blank.
    // Its cross-check questions were about the tabs just replaced.
    const notes = (first.warnings || []).filter((w) => w.type === 'truncated' || w.type === 'plakMismatch');
    return {
      ...second,
      message: `Read from the file and put into the FORM ANUGERAH layout. ${second.message}`,
      warnings: [...notes, ...(second.warnings || [])],
    };
  }, [importFormAnugerahExcelInto]);

  // AI sheet reader (universal file-reader plan, phase 1): the sheets of an
  // already-imported Excel file that the rule-based reader skipped are
  // sent — as their structure map, never as typed values — to the
  // read-order-file function, which answers with WHERE things are. The
  // values are then read from the file itself (aiMapping.js) and added to
  // the draft as new tabs, alongside what the rules already imported.
  // Returns { ok, message, warnings }; never throws.
  // `memoryOnly` (right after an import): only the sheets a layout the AI
  // learned earlier — from any user's file — fits are read, free; the rest
  // stay offered to the AI button. Returns `remaining` = sheets not read.
  const readSkippedSheetsWithAi = useCallback(async (file, sheetNames, instructions = '', { memoryOnly = false } = {}) => {
    let ir;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      ir = buildWorkbookIr(wb, sheetNames);
    } catch (err) {
      console.error('AI reader could not open the file:', err);
      return { ok: false, message: 'Could not read this file. Please try again.' };
    }
    if (ir.blocks.length === 0) return { ok: false, message: 'Those sheets are empty — nothing to read.' };
    const res = await readSheetsWithAi({ fileName: file.name, irText: renderIrText(ir), sheetNames: ir.blocks.map((b) => b.name), instructions, memoryOnly });
    if (!res.ok) return { ok: false, message: res.message };
    const learned = res.learnedSheets || [];
    // From memory only: map just those sheets (the others weren't read).
    const readIr = memoryOnly ? { ...ir, blocks: ir.blocks.filter((b) => learned.includes(b.name)) } : ir;
    const { categorized, notes } = applyAiMapping(readIr, res.mapping);
    learned.forEach((name) => notes.unshift(`Sheet "${name}": read with a layout the AI learned from an earlier file (no AI cost) — please check it against the file.`));
    if (Object.keys(categorized).length === 0) {
      return { ok: false, message: 'The AI found no order rows in those sheets.', warnings: notes.map((text) => ({ type: 'truncated', text })) };
    }
    const read = await importFormAnugerahExcelInto(file, NEW_ORDER_IMPORT_FIELDS, { parsedOverride: { categorized, notes } });
    // Shown in the FORM ANUGERAH layout, like a Word / PDF order (Sean,
    // 2026-10-19: the TOKOH tab, as in the downloaded form).
    const result = read.ok ? await convertImportToForm(file, read) : read;
    const remaining = memoryOnly ? sheetNames.filter((n) => !learned.includes(n)) : [];
    const message = memoryOnly
      ? `${learned.length} more sheet(s) read with layouts learned earlier — ${Object.keys(categorized).length} new tab(s). Check them against the file before adding to cart.`
      : `AI-read sheets imported — ${Object.keys(categorized).length} new tab(s). Check every AI-read tab carefully against the file before adding to cart.`;
    return { ...result, message, learnedSheets: learned, remaining };
  }, [importFormAnugerahExcelInto, convertImportToForm]);

  const removeFromCart = useCallback((id) => {
    patch((st) => ({ cart: st.cart.filter((c) => c.id !== id) }));
  }, [patch]);

  // "Edit" on a Cart row — reloads every cart item already added under this
  // ONE category back into the New Order draft for that category (every
  // block/section, not just whichever item the row itself represents,
  // since a category can be grouped across several — see Cart.jsx's own
  // groupedCartRowsByPlak), and switches Step 2 to that category tab.
  // Reuses buildDraftFromOrder — same reconstruction reorderOrder already
  // relies on for a full order — just scoped to one category's own cart
  // items instead of a whole submitted order, and merged into the EXISTING
  // draft rather than replacing it, so any other category already in the
  // cart is left untouched.
  //
  // Deliberately does NOT remove the original items from `cart` here —
  // clicking Edit and then navigating back to Cart without ever clicking
  // "Add to Cart" again (a misclick, or just changing your mind) used to
  // silently drop the whole category from the order, since the only copy
  // was sitting in the draft. addToCart/addAllToCart now REPLACE a
  // category's existing cart entries when it's (re-)added, instead of
  // appending — so the stale copy left here is safely superseded on a real
  // re-add, and just as safely still there if the teacher never re-adds.
  const editCartCategory = useCallback((categoryKey) => {
    patch((st) => restoreCategoryDraft(st, categoryKey));
  }, [patch]);

  // Cart's "← Back to Order" (Sean, 2026-10-17): Order Details shows every category in the cart
  // again, as it was added (Add to Cart clears the form). The cart keeps its items; adding again
  // replaces a category's entries, never duplicates them.
  const restoreCartToDraft = useCallback(() => {
    patch((st) => {
      const keys = [...new Set(st.cart.map((ci) => ci.categoryKey))];
      if (keys.length === 0) return {};
      const merged = keys.reduce((acc, key) => ({ ...acc, ...restoreCategoryDraft(acc, key) }), st);
      return {
        lineValues: merged.lineValues, matrixValues: merged.matrixValues, rowsByBlock: merged.rowsByBlock,
        columnsByBlock: merged.columnsByBlock, plakRows: merged.plakRows, nextRowId: merged.nextRowId,
        nextColumnId: merged.nextColumnId, visibleBlocksByCategory: merged.visibleBlocksByCategory, category: keys[0],
      };
    });
  }, [patch]);

  // The order id used to come from a nextOrderSeq counter that lived only
  // in this tab's in-memory state — it reset on every login *and* every
  // refresh, so two submissions from different sessions (or just a
  // refreshed tab) regularly generated the same "ORD-096" id. That was
  // later changed to a client-side "read the current max, then +1" lookup,
  // but that's still a race: two teachers submitting close together can
  // both read the same max before either has inserted, so both compute the
  // same next number and the second insert fails its unique-constraint
  // check with no automatic retry. next_order_seq() (supabase/migrations/
  // 0009) hands out numbers atomically in the database instead, so
  // concurrent submissions can never collide. Returns the new order's id on
  // success, or null if the insert failed, so the caller knows whether it's
  // safe to move on.
  // The school's orders that look like this draft (0095: same teacher, same Function Date) — [] when none, or when
  // the check itself fails (it only warns; it must never stop an order).
  const checkDuplicateOrders = useCallback(async () => {
    const st = stateRef.current;
    const schoolId = st.role === 'salesman' ? st.actingSchoolId : st.userAuthId;
    if (!schoolId) return [];
    try {
      const hashes = orderImportFields(st).importFiles.map((f) => f.hash).filter(Boolean);
      return await findPossibleDuplicates(schoolId, st.funcSelected, hashes, st.picName);
    } catch (err) {
      console.error('Duplicate order check failed:', err);
      return [];
    }
  }, []);

  // artworkConfirmed: the Yes to "crystal artwork checked?" at submit (Cart, crystal orders only)
  // duplicateCheck: the look-alike orders the Cart showed and who went ahead anyway.
  const submitOrder = useCallback(async ({ artworkConfirmed = false, duplicateCheck = null } = {}) => {
    const st = stateRef.current;
    const selectedSalesman = st.assignedSalesmen.find((s) => s.id === st.selectedSalesmanId);
    // The backend (supabase/migrations/0025_allow_multiple_salesmen_per_school.sql)
    // rejects any insert without a salesman_id in the school's current
    // assignment set — this check just avoids burning an order number (see
    // next_order_seq below) on a submission that can never succeed, and
    // gives a clearer message than a raw RLS-violation error would.
    if (st.role === 'salesman' && !st.actingSchoolId) {
      patch({ cartToast: 'Please pick the school on Function Details first.' });
      return null;
    }
    if (!selectedSalesman) {
      patch({ cartToast: st.assignedSalesmen.length === 0 ? 'Your school has not been assigned to a salesman yet. Please contact the administrator.' : 'Please select which salesman this order is for.' });
      return null;
    }
    // One continuous sequence, no year in the id — ORD-0001, ORD-0002, …
    // — except the test account (see isTestAccountUser above), which gets
    // its own counter seeded at 9001 so its orders never share a number
    // with, or shift, anyone real's.
    const isTestAccount = await isTestAccountUser();
    const prefix = 'ORD-';
    let seq;
    try {
      seq = isTestAccount ? await nextOrderSeq('ORD-TEST-', 9001) : await nextOrderSeq(prefix, 1);
    } catch (err) {
      console.error('Failed to reserve the next order number:', err);
      patch({ cartToast: `Could not submit the order: ${err.message || 'unknown error'}. Please try again.` });
      return null;
    }
    const newId = `${prefix}${String(seq).padStart(4, '0')}`;

    const totalAmt = st.cart.reduce((sum, ci) => sum + ci.harga, 0);
    // Only the category-draft portion needs to survive here — sekolah,
    // dates, etc. now live as top-level order fields below, so Sales can
    // rely on every order carrying them regardless of how it was created.
    const snapshot = {
      category: st.category,
      lineValues: { ...st.lineValues }, matrixValues: { ...st.matrixValues },
      rowsByBlock: JSON.parse(JSON.stringify(st.rowsByBlock)),
      plakRows: JSON.parse(JSON.stringify(st.plakRows)),
      columnsByBlock: JSON.parse(JSON.stringify(st.columnsByBlock)),
      // Who typed it in, by name — kept even if the order is later reassigned.
      ...(st.role === 'salesman' ? { placedBy: selectedSalesman.name } : {}),
    };
    // A salesman's New Order belongs to the school they picked (Step 1):
    // that school's account owns it, the salesman is recorded as its maker.
    const bySalesman = st.role === 'salesman';
    const newOrder = {
      id: newId, invoiceId: null, datePlaced: formatDate(malaysiaToday()), deliveryDate: 'TBD',
      totalAmount: totalAmt, status: 'Reviewing Order', priceAdjusted: false,
      createdBy: bySalesman ? st.actingSchoolId : st.userAuthId,
      createdBySalesman: bySalesman ? st.userAuthId : null,
      salesmanId: selectedSalesman.id,
      sekolah: st.sekolah, schoolLanguage: st.schoolLanguage, sales: selectedSalesman.name, picName: st.picName, phone: st.phone, ketuaPanitia: st.ketuaPanitia, terms: st.terms, remark: st.remark,
      ...storedDays({ shipmentDate: st.shipmentDateSelected, functionDate: st.funcSelected }),
      logoDataUrl: st.logoDataUrl, logoFileName: st.logoFileName, logoRemark: st.logoRemark, schoolType: st.schoolType,
      ...orderImportFields(st),
      kertasKerjaFiles: st.kertasKerjaFiles || [],
      duplicateCheck,
      snapshot, items: st.cart.map((ci) => ({ ...ci })),
      artworkConfirmedAt: artworkConfirmed ? new Date().toISOString() : null,
    };

    // Deducted before the insert so a stock failure never creates an order
    // with items it can't actually fulfil. If the insert itself then fails
    // for some other reason, the deduction is compensated (added back)
    // rather than left silently stuck against a school that never got an
    // order — see the catch block below. Skipped entirely for the test
    // account — its orders never touch real stock (see isTestAccountUser).
    try {
      if (!isTestAccount) await deductPlakStock(st.cart.map((ci) => ({ full_path: ci.jenisPlak, qty: ci.qty })));
    } catch (err) {
      console.error('Stock deduction failed for New Order:', err);
      patch({ cartToast: describeStockError(err, patch) });
      return null;
    }

    try {
      await insertOrder(newOrder);
    } catch (err) {
      console.error('Failed to save order to Supabase:', err);
      if (!isTestAccount) {
        restorePlakStock(st.cart.map((ci) => ({ full_path: ci.jenisPlak, qty: ci.qty })))
          .catch((restoreErr) => console.error('Failed to restore stock after a failed order insert:', restoreErr));
      }
      // A row-level-security rejection here means the salesman assignment
      // this submission relied on no longer matches the database (e.g.
      // Admin reassigned the school between page load and submit) — the
      // generic message is misleading for that case, so callers get a hint
      // to refresh instead of just "try again" on a request that will keep
      // failing until they do.
      const message = /row-level security/i.test(err.message || '')
        ? 'This order could not be created — the salesman assignment for your school may have changed. Please refresh the page and try again.'
        : `Could not submit the order: ${err.message || 'unknown error'}. Please try again or contact the administrator.`;
      patch({ cartToast: message });
      return null;
    }
    patch((latest) => ({ lastOrderId: newId, orders: [newOrder, ...latest.orders], cart: [], cartToast: '', step2ImportStatus: null, step2ChoiceAnswers: {}, step2UploadedFiles: [], kertasKerjaFiles: [] }));
    // crystal changes the teacher made before submitting (Cart → Edit Crystal): onto the order now
    if (st.cart.some((ci) => isCrystalCode(ci.jenisPlak))) saveCrystalDraft(newId).catch((err) => console.error('Order saved, but its crystal changes were not:', err));
    // who confirmed the artwork is stamped by the database (0089) — read it back for the order page
    if (artworkConfirmed) {
      fetchOrderById(newId)
        .then((saved) => saved && patch((latest) => ({ orders: latest.orders.map((o) => (o.id === newId ? saved : o)) })))
        .catch((err) => console.error('Order saved, but could not reload it:', err));
    }
    return newId;
  }, [patch]);

  // Rebuilds a full New Order draft straight from the order's own `items`
  // (buildDraftFromOrder — see computeBlocks.js for why the old snapshot-
  // based restore didn't actually work: addToCart always blanks a
  // category's fields the moment it's added, so by Submit time the
  // snapshot was whatever was left over, never what was really ordered).
  // Every category in the order comes back — every field, every
  // duplicated OTHERS Tahun block — so the teacher sees the same order
  // they placed before and can edit whatever needs to change, category by
  // category, the same as any other New Order draft. Starts from the same
  // blank slate startNewOrder does (buildInitial*), then layers the
  // restored categories on top, so nothing from an unrelated in-progress
  // draft leaks in and every other category still has its normal default
  // rows to fall back to.
  const reorderOrder = useCallback((ord) => {
    const restored = buildDraftFromOrder(ord);
    patch((st) => ({
      sekolah: ord.sekolah, sales: ord.sales, picName: ord.picName, phone: ord.phone, ketuaPanitia: ord.ketuaPanitia || '', terms: ord.terms || '', remark: ord.remark,
      shipmentDateSelected: ord.shipmentDate || null, funcSelected: ord.functionDate || null,
      logoDataUrl: ord.logoDataUrl || null, logoFileName: ord.logoFileName || '', logoRemark: ord.logoRemark || '', schoolType: ord.schoolType || null,
      // A reorder is a fresh order — no upload behind it unless the teacher
      // imports one now.
      importFilePath: null, importFileName: null, importFiles: [], kertasKerjaFiles: [],
      stepError: '', editOrderId: null,

      category: restored.category || 'TOKOH',
      lineValues: restored.lineValues, matrixValues: restored.matrixValues,
      rowsByBlock: { ...buildInitialRowsByBlock(st.schoolLanguage), ...restored.rowsByBlock },
      columnsByBlock: { ...buildInitialColumnsByBlock(), ...restored.columnsByBlock },
      plakRows: { ...buildInitialPlakRows(), ...restored.plakRows },
      nextRowId: Math.max(1000, restored.nextId), nextPlakRowId: 1000, nextColumnId: Math.max(1000, restored.nextId),
      visibleBlocksByCategory: restored.visibleBlocksByCategory,

      cart: [], cartToast: '',
    }));
  }, [patch]);

  // Salesman Edit Order (Sean, 2026-11-07): the whole order back in the New Order flow — Function
  // Details on Step 1, every category on Step 2 (already in the cart, so a category left alone stays
  // as it was), a new order file can be uploaded. Cart's Save Changes (saveEditedOrder) writes it over
  // the same order. Only while it's 'Reviewing Order' and Production hasn't done its review.
  const openEditOrder = useCallback((ord) => {
    clearCrystalDraft();
    patch((st) => {
      const lang = ord.schoolLanguage || 'SK';
      const cart = (ord.items || []).map((it) => ({ ...it }));
      const blank = {
        ...st, cart,
        lineValues: {}, matrixValues: {},
        rowsByBlock: buildInitialRowsByBlock(lang), columnsByBlock: buildInitialColumnsByBlock(), plakRows: buildInitialPlakRows(),
        nextRowId: 1000, nextPlakRowId: 1000, nextColumnId: 1000, visibleBlocksByCategory: {},
      };
      const keys = [...new Set(cart.map((ci) => ci.categoryKey))];
      const draft = keys.reduce((acc, key) => ({ ...acc, ...restoreCategoryDraft(acc, key) }), blank);
      return {
        editOrderId: ord.id,
        sekolah: ord.sekolah || '', actingSchoolId: ord.createdBy || null, schoolLanguage: lang,
        sales: ord.sales || '', selectedSalesmanId: ord.salesmanId || '',
        picName: ord.picName || '', phone: ord.phone || '', ketuaPanitia: ord.ketuaPanitia || '', terms: ord.terms || '', remark: ord.remark || '',
        shipmentDateSelected: toMalaysiaDay(ord.shipmentDate), funcSelected: toMalaysiaDay(ord.functionDate),
        logoDataUrl: ord.logoDataUrl || null, logoFileName: ord.logoFileName || '', logoRemark: ord.logoRemark || '', schoolType: ord.schoolType || null,
        // only files uploaded during this edit; the order's own stay on it until one of these replaces them
        importFilePath: null, importFileName: null, importFiles: [], kertasKerjaFiles: ord.kertasKerjaFiles || [],
        step2ImportStatus: null, step2ChoiceAnswers: {}, step2UploadedFiles: [], stepError: '',
        category: keys[0] || null,
        lineValues: draft.lineValues, matrixValues: draft.matrixValues, rowsByBlock: draft.rowsByBlock,
        columnsByBlock: draft.columnsByBlock, plakRows: draft.plakRows,
        nextRowId: draft.nextRowId, nextPlakRowId: draft.nextPlakRowId, nextColumnId: draft.nextColumnId,
        visibleBlocksByCategory: draft.visibleBlocksByCategory,
        cart, cartToast: '',
      };
    });
  }, [patch]);

  // Teacher editing under "Reviewing Order" (until Done Review) — restored 2026-08-25 after
  // being removed in commit 6c03f9b ("Amend ('Update Details') is removed
  // entirely"); re-derived against the CURRENT computeBlocks/
  // buildDraftFromOrder shape rather than the old (PBD-variant-based) one,
  // since the category system changed materially since removal (PBD/ALIRAN
  // split into direct tabs, OTHERS' dynamic Nama Kelas/Tahun blocks).
  // Reuses buildDraftFromOrder — the same reconstruction reorderOrder above
  // already relies on — instead of hand-rolling the lineValues/rowsByBlock/
  // etc rebuild a second time.
  const openAmend = useCallback((ord) => {
    const restored = buildDraftFromOrder(ord);
    patch((st) => ({
      amendOrderId: ord.id,
      amendCategory: restored.category || '',
      amendLineValues: restored.lineValues, amendMatrixValues: restored.matrixValues,
      amendRowsByBlock: { ...buildInitialRowsByBlock(st.schoolLanguage), ...restored.rowsByBlock },
      amendColumnsByBlock: { ...buildInitialColumnsByBlock(), ...restored.columnsByBlock },
      amendPlakRows: { ...buildInitialPlakRows(), ...restored.plakRows },
      amendNextRowId: Math.max(1000, restored.nextId), amendNextPlakRowId: Math.max(1000, restored.nextId), amendNextColumnId: Math.max(1000, restored.nextId),
      amendVisibleBlocksByCategory: restored.visibleBlocksByCategory,
    }));
  }, [patch]);

  // Rebuilds `items` straight from the amend draft, the same "blocks ->
  // cart items" conversion addToCart uses (see above) — one item per
  // filled plakRow, id/batch/originalUnitPrice carried over from the
  // matching original item (buildDraftFromOrder seeds each block's
  // plakRows with the ORIGINAL item ids, and Amend's EDITABLE never allows
  // adding/removing a plakRow or changing its Jenis Plak — see Amend.jsx —
  // so every plakRow here still corresponds 1:1 to a real original item).
  // Only reachable while status is 'Reviewing Order' and not yet reviewed (Dashboard.jsx's
  // canAmend gate), so every item is still batch 0 — nothing here needs to
  // handle an already-approved Tambahan round.
  // An urgent order already in the Google Sheet whose total just changed
  // (amend / add-on / Production edit): refresh its row so the amount and
  // 2.5% commission there stay current. Fire-and-forget, like the first sync.
  const resyncUrgentSheet = useCallback((order) => {
    if (!order?.urgent || !order.urgentSheetSyncedAt) return;
    syncUrgentOrderToSheet({ orderId: order.id }).catch((err) => {
      console.error('Urgent-order Sheet refresh failed:', err);
      patch((latest) => ({ sheetSyncErrors: { ...latest.sheetSyncErrors, [order.id]: err.message } }));
    });
  }, [patch]);

  const updateAmend = useCallback(async () => {
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === st.amendOrderId);
    if (!order) return { ok: false, message: 'Order not found.' };
    if (order.status !== 'Reviewing Order') {
      flashToast('updateToast', 'This order is already approved — please use Add On instead.');
      return { ok: false };
    }
    // An order Production already reviewed goes back for review (0085).
    const reReview = isReviewed(order) ? { reviewedAt: null } : {};
    // Same blocks → items conversion as Add to Cart (buildCategoryCartItems),
    // so every category — ORDER LAIN-LAIN / TOKOH's per-row Jenis Plak too —
    // comes back exactly as a fresh order would.
    const draft = {
      lineValues: st.amendLineValues, matrixValues: st.amendMatrixValues, rowsByBlock: st.amendRowsByBlock,
      plakRows: st.amendPlakRows, columnsByBlock: st.amendColumnsByBlock, plakCatalog: st.plakCatalog, schoolLanguage: st.schoolLanguage,
    };
    const newItems = [];
    for (const cat of categoriesUsedByItems(order.items)) {
      const built = buildCategoryCartItems(draft, cat.key);
      if (built.error) {
        flashToast('updateToast', `${cat.label}: ${built.error}`);
        return { ok: false };
      }
      if (built.items) newItems.push(...built.items);
    }
    if (newItems.length === 0) {
      flashToast('updateToast', 'Nothing to save — the order would have no plaques left.');
      return { ok: false };
    }
    const amendedTotal = newItems.reduce((sum, it) => sum + it.harga, 0);
    // Stock follows the change (it was taken at submit).
    const { deduct, restore } = stockDiff(order.items, newItems);
    const realStock = !isTestOrderId(order.id);
    try {
      if (realStock) await deductPlakStock(deduct);
    } catch (err) {
      console.error('Failed to take stock for an amend:', err);
      flashToast('updateToast', describeStockError(err, patch));
      return { ok: false };
    }
    try {
      await updateOrder(st.amendOrderId, { items: newItems, totalAmount: amendedTotal, ...reReview });
    } catch (err) {
      console.error('Failed to save amend to Supabase:', err);
      if (realStock) restorePlakStock(deduct).catch((e) => console.error('Failed to give stock back after a failed amend:', e));
      flashToast('updateToast', describeOrderWriteError(err, 'update'));
      return { ok: false };
    }
    if (realStock) restorePlakStock(restore).catch((err) => console.error('Failed to give back stock after an amend:', err));
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === st.amendOrderId ? { ...o, items: newItems, totalAmount: amendedTotal, ...reReview } : o)),
    }));
    resyncUrgentSheet(st.orders.find((o) => o.id === st.amendOrderId));
    flashToast('updateToast', reReview.reviewedAt === null ? 'Update successful — Production will review the order again.' : 'Update successful.');
    return { ok: true };
  }, [patch, flashToast, resyncUrgentSheet]);

  // Cart's Save Changes in Salesman Edit Order. Checked against the order as the database has it now:
  // still 'Reviewing Order', Production's review not done. A new order file replaces the order's files;
  // they — and Production's Corrected Excel, which would otherwise still stand in for the order — move to
  // previousImportFiles: kept, never read again. Stock follows the difference, like an amend.
  const saveEditedOrder = useCallback(async ({ artworkConfirmed = false } = {}) => {
    const st = stateRef.current;
    const orderId = st.editOrderId;
    let order;
    try {
      order = orderId ? await fetchOrderById(orderId) : null;
    } catch (err) {
      console.error('Could not re-read the order before saving the edit:', err);
      patch({ cartToast: 'Could not check the order right now. Please try again.' });
      return { ok: false };
    }
    if (!order) { patch({ cartToast: 'Order not found.' }); return { ok: false }; }
    if (order.status !== 'Reviewing Order' || isReviewed(order)) {
      patch({ cartToast: 'Production has already reviewed this order — it can no longer be edited.' });
      return { ok: false };
    }
    if (st.cart.length === 0) { patch({ cartToast: 'The order would have no plaques left.' }); return { ok: false }; }

    const now = new Date().toISOString();
    const { newFiles, replaced, items } = editedOrderFiles(order, st, now);
    const totalAmount = items.reduce((sum, it) => sum + (Number(it.harga) || 0), 0);
    const hasCrystal = items.some((it) => isCrystalCode(it.jenisPlak));
    const fields = {
      picName: st.picName, phone: st.phone, ketuaPanitia: st.ketuaPanitia, terms: st.terms, remark: st.remark,
      ...storedDays({ functionDate: st.funcSelected, shipmentDate: st.shipmentDateSelected }),
      logoDataUrl: st.logoDataUrl, logoFileName: st.logoFileName, logoRemark: st.logoRemark, schoolType: st.schoolType,
      items, totalAmount,
      priceAdjusted: items.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog)),
      kertasKerjaFiles: st.kertasKerjaFiles || [],
      ...(newFiles.length ? { importFilePath: newFiles[0].path, importFileName: newFiles[0].name, importFiles: newFiles } : {}),
      ...(replaced.length ? { previousImportFiles: [...(order.previousImportFiles || []), ...replaced] } : {}),
      ...(order.correctedImportFilePath ? { correctedImportFilePath: null, correctedImportFileName: null, correctedImportUploadedAt: null } : {}),
      // the artwork question was asked again (Cart); a Later leaves it unconfirmed
      ...(hasCrystal && artworkConfirmed && !order.artworkConfirmedAt ? { artworkConfirmedAt: now } : {}),
      ...(hasCrystal && !artworkConfirmed ? { artworkConfirmedAt: null } : {}),
      salesmanEditedAt: now,
    };

    const { deduct, restore } = stockDiff(order.items, items);
    const realStock = !isTestOrderId(order.id);
    try {
      if (realStock) await deductPlakStock(deduct);
    } catch (err) {
      console.error('Failed to take stock for a salesman edit:', err);
      patch({ cartToast: describeStockError(err, patch) });
      return { ok: false };
    }
    try {
      await updateOrder(order.id, fields);
    } catch (err) {
      console.error('Failed to save the salesman edit:', err);
      if (realStock) restorePlakStock(deduct).catch((e) => console.error('Failed to give stock back after a failed edit:', e));
      patch({ cartToast: describeOrderWriteError(err, 'update') });
      return { ok: false };
    }
    if (realStock) restorePlakStock(restore).catch((err) => console.error('Failed to give back stock after an edit:', err));
    // crystal changes made from the Cart (Edit Crystal) go onto the order, as at submit
    if (hasCrystal) saveCrystalDraft(order.id).catch((err) => console.error('Order saved, but its crystal changes were not:', err));
    let fresh = null;
    try { fresh = await fetchOrderById(order.id); } catch (err) { console.error('Saved, but could not reload the order:', err); }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === order.id ? (fresh || { ...o, ...fields }) : o)),
      editOrderId: null, cart: [], cartToast: '', importFilePath: null, importFileName: null, importFiles: [],
      step2ImportStatus: null, step2ChoiceAnswers: {}, step2UploadedFiles: [], kertasKerjaFiles: [],
    }));
    flashToast('updateToast', 'Order updated — Production will see the new version.');
    return { ok: true, id: order.id };
  }, [patch, flashToast]);

  // Add On opens with the order so far — the original plus every earlier Tambahan (Sean, 2026-11-10):
  // raise a QTY or add a row; Add to Cart keeps only what grew (addonDiff.js).
  const openAddOn = useCallback((ord) => {
    patch((st) => {
      const p = addonPrefill(ord, st.orders.filter((o) => o.parentOrderId === ord.id), ord.schoolLanguage || st.schoolLanguage);
      return {
        addOnOrderId: ord.id, addOnCategory: p.category, addOnCart: [], addOnImportFilePath: null, addOnImportFileName: null, addOnKertasKerja: [],
        addOnBaseItems: p.baseItems,
        addOnLineValues: p.lineValues, addOnMatrixValues: p.matrixValues,
        addOnRowsByBlock: p.rowsByBlock, addOnColumnsByBlock: p.columnsByBlock, addOnPlakRows: p.plakRows,
        addOnNextRowId: p.nextId, addOnNextPlakRowId: p.nextId, addOnNextColumnId: p.nextId, addOnVisibleBlocksByCategory: p.visibleBlocksByCategory,
      };
    });
  }, [patch]);

  // An uploaded Tambahan Excel holds only the add-on: the page goes blank first, and everything in
  // the file is the Tambahan (no comparing with the order).
  const clearAddOnPrefill = useCallback(() => {
    const st = stateRef.current;
    const blank = {
      ...st, addOnBaseItems: null, addOnCart: [], addOnCategory: null,
      addOnLineValues: {}, addOnMatrixValues: {},
      addOnRowsByBlock: buildInitialRowsByBlock(st.schoolLanguage), addOnColumnsByBlock: buildInitialColumnsByBlock(), addOnPlakRows: buildInitialPlakRows(),
      addOnNextRowId: 1000, addOnNextPlakRowId: 1000, addOnNextColumnId: 1000, addOnVisibleBlocksByCategory: {},
    };
    setState(blank);
    stateRef.current = blank;
    return blank;
  }, []);

  // Teacher submits an add-on for Sales review — unlike the old
  // commitAddOn (which merged straight into `items`/`totalAmount`, no
  // review at all), this only writes the draft into `pendingAddonItems`.
  // The order's real items/total stay untouched until Sales calls
  // approveAddOn; Sales can also send it back via rejectAddOn, and the
  // teacher can withdraw it with cancelPendingAddOn — see
  // supabase/migrations/0021_addon_approval_workflow.sql.
  // Now async (it used to be a synchronous setState updater) because stock
  // must be deducted — an await-able network round trip — before the
  // add-on is committed as 'pending'. Returns true on success, false
  // otherwise, so AddOnSummary can decide whether it's safe to navigate
  // away. Reads/writes via stateRef.current + patch (submitOrder's
  // pattern above) rather than setState, since the stock calls in the
  // middle need a stable snapshot of the draft, not a re-run on every
  // render.
  // shipmentDate ("YYYY-MM-DD", salesman only — 0098): the Tambahan's own Shipment Date; '' = the order's.
  const submitPendingAddOn = useCallback(async ({ shipmentDate = '' } = {}) => {
    const st = stateRef.current;
    const addOnOrder = st.orders.find((o) => o.id === st.addOnOrderId);
    // Exactly what was added to the add-on cart (addOnAddToCart). An item
    // added before its Excel finished uploading gets the upload now, so
    // Production can still download it.
    const newItems = st.addOnCart.map((ci) => (
      ci.importFile || !st.addOnImportFilePath ? { ...ci } : { ...ci, importFile: st.addOnImportFilePath }
    ));
    if (newItems.length === 0) {
      flashToast('updateToast', 'No add-on items to submit.');
      return false;
    }

    const order = addOnOrder;
    const isTestOrder = isTestOrderId(st.addOnOrderId);
    const pendingAddonShipmentDate = /^\d{4}-\d\d-\d\d$/.test(shipmentDate) ? `${shipmentDate}T00:00:00+08:00` : null;
    // A still-'pending' add-on being overwritten by this fresh submission
    // already had its own stock deducted once (below, on its own earlier
    // call) — restore that first so resubmitting can never leave the
    // earlier batch's deduction stranded on top of the new one. A
    // 'rejected' add-on was already restored when it was rejected (see
    // rejectAddOn), so this only fires for 'pending'. Skipped for the test
    // account's own orders — their stock was never touched to begin with.
    if (!isTestOrder && isAddonInFlight(order) && order.pendingAddonItems?.length) {
      try {
        await restorePlakStock(order.pendingAddonItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })));
      } catch (err) {
        console.error('Failed to restore stock for the add-on being replaced:', err);
      }
    }

    try {
      if (!isTestOrder) await deductPlakStock(newItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })));
    } catch (err) {
      console.error('Stock deduction failed for Add On:', err);
      flashToast('updateToast', describeStockError(err, patch));
      return false;
    }

    const pendingAddonKertasKerja = st.addOnKertasKerja?.length ? st.addOnKertasKerja : null;
    try {
      await updateOrder(st.addOnOrderId, { pendingAddonItems: newItems, pendingAddonStatus: 'pending', pendingAddonRejectReason: null, pendingAddonShipmentDate, pendingAddonKertasKerja });
    } catch (err) {
      console.error('Failed to submit add-on to Supabase:', err);
      if (!isTestOrder) {
        restorePlakStock(newItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })))
          .catch((restoreErr) => console.error('Failed to restore stock after a failed add-on submit:', restoreErr));
      }
      flashToast('updateToast', `Could not submit the add-on: ${err.message || 'unknown error'}. Please try again.`);
      return false;
    }

    patch((latest) => ({
      orders: latest.orders.map((o) => (
        o.id === st.addOnOrderId ? { ...o, pendingAddonItems: newItems, pendingAddonStatus: 'pending', pendingAddonRejectReason: null, pendingAddonShipmentDate, pendingAddonKertasKerja } : o
      )),
      addOnCart: [],
      addOnKertasKerja: [],
    }));
    flashToast('updateToast', 'Add-on submitted — Production will review it, then Sales approves it.');
    return true;
  }, [patch, flashToast]);

  // Teacher withdraws a pending or rejected add-on before/without Sales
  // acting on it further — clears it back to no-add-on-in-flight. Awaits
  // the write and only updates local state on success; returns { ok }.
  const cancelPendingAddOn = useCallback(async (orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false };
    const fields = { pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null, pendingAddonShipmentDate: null, pendingAddonKertasKerja: null };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to cancel add-on in Supabase:', err);
      flashToast('updateToast', describeOrderWriteError(err, 'update'));
      return { ok: false };
    }
    patch((st) => ({
      orders: st.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
    }));
    // A 'rejected' add-on already had its stock restored when it was
    // rejected (see rejectAddOn) — only a still-'pending' one still has its
    // submission-time deduction outstanding. Best-effort, after the write.
    // Skipped for the test account's own orders (never deducted).
    if (!isTestOrderId(orderId) && isAddonInFlight(order) && order.pendingAddonItems?.length) {
      try {
        await restorePlakStock(order.pendingAddonItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })));
      } catch (err) {
        console.error('Failed to restore stock for a cancelled add-on:', err);
        flashToast('updateToast', 'Add-on withdrawn — but its stock could not be returned automatically. Please tell an administrator.');
        return { ok: true };
      }
    }
    flashToast('updateToast', 'Add-on withdrawn.');
    return { ok: true };
  }, [patch, flashToast]);

  // Sales sends a pending add-on back to the teacher with an optional
  // reason, instead of approving it — `pendingAddonItems` stays as-is so
  // the teacher can see what was submitted; only cancelPendingAddOn or a
  // fresh submitPendingAddOn (which overwrites it) clears it from here.
  const rejectAddOn = useCallback(async (orderId, reason) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false };
    const fields = { pendingAddonStatus: 'rejected', pendingAddonRejectReason: reason || '' };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to reject add-on in Supabase:', err);
      flashToast('updateToast', describeOrderWriteError(err, 'update'));
      return { ok: false };
    }
    patch((st) => ({
      orders: st.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
    }));
    // Skipped for the test account's own orders (never deducted).
    if (!isTestOrderId(orderId) && order.pendingAddonItems?.length) {
      try {
        await restorePlakStock(order.pendingAddonItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })));
      } catch (err) {
        console.error('Failed to restore stock for a rejected add-on:', err);
        flashToast('updateToast', 'Add-on rejected — but its stock could not be returned automatically. Please tell an administrator.');
        return { ok: true };
      }
    }
    flashToast('updateToast', 'Add-on sent back to the teacher.');
    return { ok: true };
  }, [patch, flashToast]);

  // Cancels an order that isn't going to be fulfilled and hands its
  // submit-time stock deduction back (there's no stock trigger — the app
  // orchestrates stock, the DB only enforces the floor; see
  // supabase/migrations/0042_order_cancellation.sql). Who may cancel, and
  // from which status, is enforced server-side by orders_write_guard — the
  // client just surfaces whatever it says. `status` is written FIRST (so a
  // failed stock restore can't be retried into a double-credit — the order
  // is already terminal and re-cancelling is refused), then the stock is
  // restored. A pending add-on on the order is withdrawn and its own
  // deduction restored in the same step. Returns { ok, message }; never
  // throws. Reads/writes via stateRef + patch, awaiting each network call,
  // rather than the optimistic "local first, fire-and-forget" pattern —
  // cancelling must never show as done locally while the database still has
  // the order live.
  const cancelOrder = useCallback(async (orderId, reason) => {
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, message: 'Order not found.' };
    if (order.status === 'Cancelled') return { ok: false, message: 'This order is already cancelled.' };

    const hadPendingAddon = isAddonInFlight(order) && order.pendingAddonItems?.length;
    const cancelFields = {
      status: 'Cancelled',
      cancelReason: (reason || '').trim() || null,
      cancelledAt: new Date().toISOString(),
      cancelledBy: st.userAuthId || null,
      ...(hadPendingAddon
        ? { pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null, pendingAddonShipmentDate: null }
        : {}),
    };

    try {
      await updateOrder(orderId, cancelFields);
    } catch (err) {
      console.error('Failed to cancel order in Supabase:', err);
      const message = describeOrderWriteError(err, 'cancel');
      flashToast('updateToast', message);
      return { ok: false, message };
    }

    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...cancelFields } : o)),
    }));
    // a cancelled order is no longer urgent: its KIT DOC row loses the red
    if (order.urgent) highlightUrgentKitDoc();

    // Stock restore is best-effort AFTER the cancel is committed. A failure
    // here leaves the order correctly cancelled but the stock not yet
    // credited back — surfaced clearly so an admin can restock by hand,
    // rather than silently swallowed. Skipped for the test account's own
    // orders — nothing was ever deducted for them to begin with.
    if (isTestOrderId(orderId)) {
      flashToast('updateToast', 'Order cancelled.');
      return { ok: true, message: 'Order cancelled.' };
    }
    const toRestore = [
      ...(order.items || []).map((it) => ({ full_path: it.jenisPlak, qty: it.qty })),
      ...(hadPendingAddon ? order.pendingAddonItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })) : []),
    ];
    try {
      await restorePlakStock(toRestore);
    } catch (err) {
      console.error('Order cancelled, but restoring its stock failed:', err);
      flashToast('updateToast', 'Order cancelled — but its stock could not be returned automatically. Please tell an administrator to restock manually.');
      return { ok: true, message: 'Order cancelled (stock restore failed — see an administrator).' };
    }

    flashToast('updateToast', 'Order cancelled and stock returned.');
    return { ok: true, message: 'Order cancelled and stock returned.' };
  }, [patch, flashToast]);

  // Hands an order to a different salesman — for when the teacher picked
  // the wrong one on submit (any salesman can be chosen freely, see
  // submitOrder above) and the order needs to move to whoever actually
  // covers that school. Only the RPC (reassign_order_salesman) can move
  // salesman_id; it re-checks ownership/role/target server-side. Once it
  // succeeds this salesman no longer owns the order (RLS scopes "salesman
  // reads own orders" to salesman_id = auth.uid()), so it's dropped from
  // local state rather than patched in place — it would otherwise linger
  // on screen until the next full refetch.
  const reassignSalesman = useCallback(async (orderId, newSalesmanId) => {
    try {
      await reassignOrderSalesman(orderId, newSalesmanId);
    } catch (err) {
      console.error('Failed to reassign order:', err);
      const message = err.message || 'Could not reassign this order.';
      flashToast('updateToast', message);
      return { ok: false, message };
    }
    patch((latest) => ({ orders: latest.orders.filter((o) => o.id !== orderId) }));
    flashToast('updateToast', 'Order reassigned.');
    return { ok: true };
  }, [patch, flashToast]);

  // Parses `file` as a scratch, throwaway draft (never shown as an editable
  // screen) and turns it into cart-shaped items for Production's CSV export
  // — never order.items, total_amount, stock, or pricing (Production has no
  // UI for any of those, and there is no stock give-back path anywhere in
  // this app to safely reconcile a qty change against). Reused by both
  // uploadCorrectedExcel (right after a fresh upload) and
  // loadCorrectedExcelPreview (re-deriving it from the already-stored file
  // whenever anyone opens the order, so it's never stale relative to
  // whoever originally uploaded it).
  const parseCorrectedExcelIntoItems = useCallback(async (order, file) => {
    // schoolLanguage is a top-level, "current working context" field (see
    // NEW_ORDER_IMPORT_FIELDS/ADDON_IMPORT_FIELDS callers, which all belong
    // to a teacher already working on THIS school's own order) —
    // Production has no school of their own, so it must be pointed at
    // THIS order's school before every parse, or a SJKC file would import
    // against the wrong (default SK) subject/column lists.
    patch({
      schoolLanguage: order.schoolLanguage || 'SK',
      prodExcelCategory: '', prodExcelLineValues: {}, prodExcelMatrixValues: {},
      prodExcelRowsByBlock: buildInitialRowsByBlock(order.schoolLanguage || 'SK'),
      prodExcelColumnsByBlock: buildInitialColumnsByBlock(), prodExcelPlakRows: buildInitialPlakRows(),
      prodExcelNextRowId: 1000, prodExcelNextPlakRowId: 1000, prodExcelNextColumnId: 1000,
      prodExcelVisibleBlocksByCategory: {},
    });
    const res = await importFormAnugerahExcelInto(file, PROD_EXCEL_IMPORT_FIELDS);
    if (!res.ok) return { ok: false, message: res.message };

    // Read the just-committed draft straight off the import's own return
    // value (`res.draft`), NOT stateRef.current — the setState inside
    // importFormAnugerahExcelInto is not guaranteed to have been applied
    // (and stateRef.current updated) by the time this async function's
    // very next line runs, so reading the ref here could still see the
    // pre-import (blank) draft and report every category as unreadable.
    const next = res.draft;
    const f = PROD_EXCEL_IMPORT_FIELDS;
    const draft = {
      lineValues: next[f.lineValues], matrixValues: next[f.matrixValues], rowsByBlock: next[f.rowsByBlock],
      plakRows: next[f.plakRows], columnsByBlock: next[f.columnsByBlock],
      plakCatalog: next.plakCatalog, schoolLanguage: next.schoolLanguage,
    };
    const items = [];
    const warnings = [];
    // Every STATIC category (MP1/MP2/PPKI/PBD/LONJAKAN/...) plus every
    // DYNAMIC one this parse actually touched. visibleBlocksByCategory
    // alone isn't enough — importFormAnugerahExcelInto only ever sets it
    // for a dynamic key (a static category always has its own standing tab
    // elsewhere, so nothing else needed to read it there — see the comment
    // by its own `isDynamicCategoryKey(catKey)` check). Missing that meant
    // MP THP 1/2, PPKI, PBD, LONJAKAN etc silently never got built here even
    // though the parse itself had populated them correctly. A static
    // category the file didn't touch just resolves to {engaged: false} and
    // is skipped, same as submitPendingAddOn's own [...CATEGORIES, ...dynamicCats] sweep.
    const dynamicKeys = Object.keys(next[f.visibleBlocksByCategory] || {});
    [...CATEGORIES.map((c) => c.key), ...dynamicKeys].forEach((catKey) => {
      const built = buildCategoryCartItems(draft, catKey, { allowTypos: true });
      if (built.items) { items.push(...built.items); return; }
      if (!built.error) return;
      // Can't be built from the file alone (e.g. a Jenis Plak it doesn't name; a possible
      // typo no longer blocks here — ORD-0065): keep the order's own saved details for it, never drop it.
      const label = resolveCategory(catKey)?.label || catKey;
      const saved = (order.items || []).filter((it) => it.categoryKey === catKey);
      items.push(...saved);
      warnings.push(saved.length
        ? `${label}: not read from this file (${built.error}) — using the order's saved details for it.`
        : `${label}: ${built.error}`);
    });
    if (items.length === 0) {
      return { ok: false, message: 'Nothing recognizable in this file — no categories could be read.' };
    }
    return { ok: true, items, warnings };
  }, [patch, importFormAnugerahExcelInto]);

  // Production spotted a qty/wording problem against the teacher's
  // original file — this uploads the corrected copy (kept separate from
  // import_file_path, the teacher's own original) and immediately re-derives
  // export items from it. Returns the fresh items so the caller can show
  // them without a second round trip.
  // The corrected file becomes the order itself (Sean, 2026-10-23): its items, QTY and total are
  // saved over the order (hand-adjusted prices, row order and MERAH kept — withOrderOwnSettings),
  // and stock follows the difference, like a Production edit — so Summary, every dashboard card,
  // Store Admin and the urgent sheet show the corrected amounts. `oldTotal` / `totalAmount` come back
  // for the page to tell Production when the total changed (an issued invoice needs updating).
  const uploadCorrectedExcel = useCallback(async (orderId, file) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, message: 'Order not found.' };
    const uploaded = await uploadOrderImportFile(file);
    if (!uploaded) return { ok: false, message: 'Could not upload this file. Please try again.' };

    const res = await parseCorrectedExcelIntoItems(order, file);
    if (!res.ok) return res;

    const items = withOrderOwnSettings(order, res.items);
    const totalAmount = items.reduce((sum, it) => sum + (Number(it.harga) || 0), 0);
    const st = stateRef.current;
    const { deduct, restore } = stockDiff(order.items, items);
    const realStock = !isTestOrderId(order.id);
    try {
      if (realStock) await deductPlakStock(deduct);
    } catch (err) {
      console.error('Failed to take stock for a corrected Excel:', err);
      return { ok: false, message: describeStockError(err, patch) };
    }
    const correctedFields = {
      correctedImportFilePath: uploaded.path, correctedImportFileName: uploaded.name,
      correctedImportUploadedAt: new Date().toISOString(),
      items, totalAmount,
      priceAdjusted: items.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog)),
    };
    try {
      await updateOrder(orderId, correctedFields);
    } catch (err) {
      console.error('Failed to save the corrected Excel on the order:', err);
      if (realStock) restorePlakStock(deduct).catch((e) => console.error('Failed to give stock back after a failed correction:', e));
      return { ok: false, message: describeOrderWriteError(err, 'save the corrected file for') };
    }
    if (realStock) restorePlakStock(restore).catch((err) => console.error('Failed to give back stock after a correction:', err));
    patch((latest) => ({ orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...correctedFields } : o)) }));
    resyncUrgentSheet({ ...order, ...correctedFields });
    return { ...res, oldTotal: Number(order.totalAmount) || 0, totalAmount };
  }, [patch, parseCorrectedExcelIntoItems, resyncUrgentSheet]);

  // Re-derives export items from whichever corrected Excel is already on
  // record (order.correctedImportFilePath) — called whenever
  // ProductionOrderDetail opens an order that has one, so export always
  // reflects the latest file on file rather than whatever the uploader's
  // own browser happened to compute at upload time.
  const loadCorrectedExcelPreview = useCallback(async (order) => {
    if (!order?.correctedImportFilePath) return { ok: false, message: 'No corrected file on this order.' };
    const url = await getOrderImportUrl(order.correctedImportFilePath);
    if (!url) return { ok: false, message: 'Could not download the corrected file. Please try again.' };
    let file;
    try {
      const blob = await (await fetch(url)).blob();
      file = new File([blob], order.correctedImportFileName || 'corrected.xlsx');
    } catch (err) {
      console.error('Failed to fetch the corrected Excel file:', err);
      return { ok: false, message: 'Could not download the corrected file. Please try again.' };
    }
    return parseCorrectedExcelIntoItems(order, file);
  }, [parseCorrectedExcelIntoItems]);

  // Sales approves a pending add-on — `updatedItems` carries each item's
  // (possibly Sales-negotiated) unitPrice/harga, same as approveOrder
  // below. Stamps every item with the next batch number (1, 2, 3…) so it
  // stays visually distinct from the original order and any earlier
  // add-on rounds permanently, not just on this review screen — see
  // src/utils/orderBatches.js. Only ever adds to items/totalAmount; never
  // touches the order's main `status`, so an add-on can be approved
  // whether the order is already In Production or beyond.
  const approveAddOn = useCallback(async (orderId, updatedItems) => {
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, message: 'Order not found.' };
    if (order.pendingAddonStatus !== 'reviewed') {
      flashToast('updateToast', 'Production has to review this add-on before it can be approved.');
      return { ok: false };
    }
    // Stamps `originalUnitPrice` the first time Sales negotiates an add-on
    // item's price away from what the teacher's own pending add-on had —
    // compared against the item as it stood before THIS approval, not the
    // live catalog rate (that's the separate priceAdjusted concept below).
    const priorItems = order.pendingAddonItems || [];
    const withOriginalPrice = updatedItems.map((it) => {
      const prior = priorItems.find((p) => p.id === it.id);
      if (prior && prior.unitPrice !== it.unitPrice && it.originalUnitPrice == null) {
        return { ...it, originalUnitPrice: prior.unitPrice };
      }
      return it;
    });
    // Its own order from here on (0091, Sean 2026-10-14): the next order number, only the
    // add-on's items, function details / dates / urgency of this order, straight into Typing
    // (or KIV & ARTWORK). Store Admin bills it in AutoCount — nothing to enter on the website.
    const priceAdjusted = withOriginalPrice.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog));
    let newId;
    try {
      newId = await approveAddonAsOrder(orderId, withOriginalPrice, priceAdjusted);
    } catch (err) {
      console.error('Failed to approve add-on in Supabase:', err);
      flashToast('updateToast', describeOrderWriteError(err, 'approve the add-on for'));
      return { ok: false };
    }
    let child = null;
    try {
      child = await fetchOrderById(newId);
    } catch (err) {
      console.error('Add-on approved, but its new order could not be loaded:', err);
    }
    const cleared = { pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null, pendingAddonShipmentDate: null, pendingAddonKertasKerja: null };
    patch((latest) => ({
      orders: [
        ...(child ? [child] : []),
        ...latest.orders.map((o) => (o.id === orderId ? { ...o, ...cleared } : o)),
      ],
    }));
    // urgent like its original (same Shipment Date): its own row in the urgent Sheet
    if (child?.urgent) resyncUrgentSheet(child);
    flashToast('updateToast', `Add-on approved — the Tambahan is now order ${newId}.`);
    return { ok: true, newId };
  }, [patch, flashToast, resyncUrgentSheet]);

  // Sales approval: `updatedItems` carries each item's (possibly
  // Sales-negotiated) unitPrice and recalculated harga. priceAdjusted is
  // true whenever any item's unit price no longer matches the standard
  // catalog rate — that's the flag that turns the order's total red
  // downstream, so production knows to double-check it against the catalog.
  // Only once Production has reviewed it (Done Review, order.reviewedAt);
  // the order then waits as 'Salesman Approved' until Store Admin enters
  // the Invoice Number (setInvoiceId / approveAndSetInvoiceId → In Production).
  // `overrides` lets Sales adjust Shipment Date (shipmentDate) / Function Date (in addition to
  // per-item price, already folded into updatedItems) at the same moment
  // they approve — the only point before production where those dates are
  // still editable.
  const approveOrder = useCallback(async (orderId, updatedItems, overrides = {}) => {
    const st = stateRef.current;
    const priorOrder = st.orders.find((o) => o.id === orderId);
    if (!priorOrder) return { ok: false, message: 'Order not found.' };
    if (priorOrder.status !== 'Reviewing Order' || !isReviewed(priorOrder)) {
      flashToast('updateToast', 'Production hasn’t finished reviewing this order yet.');
      return { ok: false };
    }
    // Stamps `originalUnitPrice` the first time Sales changes an item's
    // price away from what the teacher's own cart had — compared against
    // the order as it stood before THIS approval, not the live catalog rate
    // (the separate priceAdjusted concept below). Never overwritten once set.
    const priorItems = priorOrder.items || [];
    const itemsWithOriginalPrice = updatedItems.map((it) => {
      const prior = priorItems.find((p) => p.id === it.id);
      if (prior && prior.unitPrice !== it.unitPrice && it.originalUnitPrice == null) {
        return { ...it, originalUnitPrice: prior.unitPrice };
      }
      return it;
    });
    const totalAmount = itemsWithOriginalPrice.reduce((sum, it) => sum + it.harga, 0);
    const priceAdjusted = itemsWithOriginalPrice.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog));
    // Shipment Date is first set right here (never at order creation — see
    // urgentOrder.js) — this is the one moment "urgent" gets snapshotted,
    // and it's never recomputed after this. overrides.shipmentDate is
    // absent only if Sales approved without touching the date picker, in
    // which case priorOrder.urgent (false from insert) just carries through.
    const urgent = overrides.shipmentDate ? isUrgentShipment(malaysiaToday(), overrides.shipmentDate) : priorOrder.urgent;
    const fields = { items: itemsWithOriginalPrice, totalAmount, priceAdjusted, status: 'Salesman Approved', ...storedDays(overrides), urgent };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to save approval to Supabase:', err);
      flashToast('updateToast', describeOrderWriteError(err, 'approve'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
    }));
    // the Google Form is filled from the page's popup (GoogleFormSchoolModal), with the salesman's own words
    return { ok: true, googleForm: !!priorOrder.createdBySalesman };
  }, [patch, flashToast]);

  // One-time Google Sheets sync for urgent orders (see urgentOrder.js) —
  // fired right after Store Admin saves the Invoice Number, from either
  // setInvoiceId or approveAndSetInvoiceId below. Deliberately
  // fire-and-forget relative to the invoice save that triggers it: the
  // invoice save is the real, already-successful action and must never be
  // rolled back or delayed by a Sheets failure. `urgentSheetSyncedAt`
  // (set only on success) is both the idempotency guard against a double
  // append and the persisted "still pending" flag the retry UI on
  // StoreAdminOrderDetail.jsx reads — sheetSyncErrors is only the
  // human-readable message for that UI, not the source of truth.
  const attemptUrgentSheetSync = useCallback(async (order) => {
    // The function reads everything else from the saved order itself.
    try {
      await syncUrgentOrderToSheet({ orderId: order.id });
      const syncedAt = new Date().toISOString();
      await updateOrder(order.id, { urgentSheetSyncedAt: syncedAt });
      patch((latest) => ({
        orders: latest.orders.map((o) => (o.id === order.id ? { ...o, urgentSheetSyncedAt: syncedAt } : o)),
        sheetSyncErrors: { ...latest.sheetSyncErrors, [order.id]: undefined },
      }));
    } catch (err) {
      console.error('Urgent-order Sheet sync failed:', err);
      patch((latest) => ({ sheetSyncErrors: { ...latest.sheetSyncErrors, [order.id]: err.message } }));
    }
  }, [patch]);

  // Production: fix a wrong Shipment Date and/or the Urgent flag (Sean,
  // 2026-10-09). The order is saved first; the urgent Google Sheet then
  // follows — its row updated, added (urgent + invoiced) or removed (no
  // longer urgent). A Sheet failure never undoes the save; the message lands
  // in sheetSyncErrors and the result.
  const updateShipmentAndUrgency = useCallback(async (orderId, shipmentDate, urgent) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order || !SHIPMENT_EDITABLE_STATUSES.includes(order.status)) {
      return { ok: false, message: 'This order can no longer have its shipment date changed.' };
    }
    const fields = { ...storedDays({ shipmentDate }), urgent };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to save shipment date / urgency:', err);
      return { ok: false, message: describeOrderWriteError(err, 'update') };
    }
    patch((latest) => ({ orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)) }));

    const action = urgentSheetAction({ urgent, wasSynced: !!order.urgentSheetSyncedAt, hasInvoice: !!order.invoiceId });
    if (!action) return { ok: true };
    try {
      await syncUrgentOrderToSheet({ orderId });
      const urgentSheetSyncedAt = action === 'sync' ? new Date().toISOString() : null;
      await updateOrder(orderId, { urgentSheetSyncedAt });
      patch((latest) => ({
        orders: latest.orders.map((o) => (o.id === orderId ? { ...o, urgentSheetSyncedAt } : o)),
        sheetSyncErrors: { ...latest.sheetSyncErrors, [orderId]: undefined },
      }));
      return { ok: true, sheet: action };
    } catch (err) {
      console.error('Urgent-order Sheet update failed:', err);
      patch((latest) => ({ sheetSyncErrors: { ...latest.sheetSyncErrors, [orderId]: err.message } }));
      return { ok: true, sheetError: `Saved, but the urgent Google Sheet could not be updated: ${err.message}` };
    }
  }, [patch]);

  // Production: a Function Date / Remark a salesman sent through the Telegram bot (Sean, 2026-11-05;
  // utils/botRequests.js) — applied from the order page, never by the bot itself.
  const updateOrderDetails = useCallback(async (orderId, details) => {
    const fields = storedDays(details);
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to save the order details:', err);
      return { ok: false, message: describeOrderWriteError(err, 'update') };
    }
    patch((latest) => ({ orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)) }));
    return { ok: true };
  }, [patch]);

  const retryUrgentSheetSync = useCallback((orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (order) attemptUrgentSheetSync(order);
  }, [attemptUrgentSheetSync]);

  // Production: records the invoice ID billing hands over on paper once an
  // approved order's hardcopy comes back invoiced. Guarded against orders
  // that aren't yet approved, blank input, and overwriting an existing
  // invoiceId — that paperwork is treated as immutable once recorded.
  const setInvoiceId = useCallback(async (orderId, invoiceId) => {
    // Strips every space (not just leading/trailing) before saving or
    // comparing, so "INV 2026 090" and "INV2026090" are treated as the
    // same invoice number for the duplicate check below.
    const normalized = (invoiceId || '').replace(/\s+/g, '');
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'Salesman Approved') {
      flashToast('productionToast', 'This order is not ready for invoice entry.');
      return { ok: false };
    }
    if (order.invoiceId) {
      flashToast('productionToast', 'Invoice ID is already set for this order.');
      return { ok: false };
    }
    if (!normalized) {
      flashToast('productionToast', 'Enter a valid Invoice ID.');
      return { ok: false };
    }
    if (invoiceNumberTaken(st.orders, orderId, normalized)) {
      flashToast('productionToast', 'Invoice ID invalid because repeated, please try again.');
      return { ok: false };
    }
    // urgent counts from the invoice day (urgentOrder.js)
    const urgent = isUrgentShipment(malaysiaToday(), order.shipmentDate);
    try {
      await updateOrder(orderId, { invoiceId: normalized, status: 'In Production', urgent });
    } catch (err) {
      console.error('Failed to save invoice ID to Supabase:', err);
      flashToast('productionToast', describeOrderWriteError(err, 'save the invoice number for'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, invoiceId: normalized, status: 'In Production', urgent } : o)),
    }));
    flashToast('productionToast', 'Invoice ID saved — order is ready for export.');
    // The other place an Invoice Number lands, so the other trigger point for the
    // one-time Sheets sync. Fire-and-forget: never blocks/undoes the invoice save above.
    if (urgent && !order.urgentSheetSyncedAt) {
      attemptUrgentSheetSync({ ...order, invoiceId: normalized, urgent });
    }
    return { ok: true };
  }, [patch, flashToast, attemptUrgentSheetSync]);

  // Store Admin: splits an order across a second (or third, ...) invoice
  // number by moving `jenisPlakList` into a group billed under `invoiceId`
  // (orders.invoice_groups, 0070_order_invoice_groups.sql). Split by Jenis
  // Plak, not category — "PKC 263" is one physical Illustrator file no
  // matter which category ordered it (see combineByJenisPlak), so that's
  // the natural billing unit here, same as the price table above it already
  // groups by. Any Jenis Plak NOT listed in any group keeps billing under
  // the order's own invoiceId — invoiceGroups only ever needs to record the
  // exceptions. A Jenis Plak can only belong to one invoice at a time, so
  // it's first pulled out of whichever OTHER group already held it before
  // being (re)placed.
  //
  // `qtyDrafts` ({ [jenisPlak]: qty }, optional) moves only PART of a Jenis
  // Plak — e.g. 5 of 15 PKC 263 on the new invoice, the other 10 staying on
  // the order's own one (stored as the group's qtyByJenisPlak; see
  // getInvoiceItems, src/utils/orderBatches.js). Blank / full QTY = move all.
  const setJenisPlakInvoiceGroup = useCallback(async (orderId, invoiceId, jenisPlakList, qtyDrafts = {}) => {
    const normalized = (invoiceId || '').replace(/\s+/g, '');
    const keys = (jenisPlakList || []).filter(Boolean);
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false };
    if (!normalized) {
      flashToast('updateToast', 'Enter a valid Invoice ID.');
      return { ok: false };
    }
    if (keys.length === 0) {
      flashToast('updateToast', 'Tick at least one Jenis Plak to assign.');
      return { ok: false };
    }
    if (invoiceNumberTaken(st.orders, orderId, normalized)) {
      flashToast('updateToast', 'Invoice ID invalid because repeated, please try again.');
      return { ok: false };
    }
    const strip = (v) => (v || '').replace(/\s+/g, '');
    const toMain = normalized === strip(order.invoiceId);
    // A QTY moves that many out of what's still on the main invoice — a Jenis Plak can be shared
    // over several invoices (Sean, 2026-10-23, ORD-0108); retyping one invoice's QTY replaces it.
    const others = (order.invoiceGroups || []).filter((g) => strip(g.invoiceId) !== normalized);
    const { qtyByJenisPlak, error: qtyError } = normalizeSplitQty(order.items, keys, toMain ? {} : qtyDrafts, others);
    if (qtyError) {
      flashToast('updateToast', qtyError);
      return { ok: false };
    }
    // Moved whole (no QTY), or back to the main invoice: out of every other invoice first. A
    // part (QTY) leaves the other invoices' shares as they are.
    const wholeKeys = keys.filter((k) => qtyByJenisPlak[k] == null);
    const withoutKeys = (order.invoiceGroups || [])
      .map((g) => withoutJenisPlak(g, toMain || strip(g.invoiceId) === normalized ? keys : wholeKeys))
      .filter((g) => g.jenisPlakList.length > 0);
    // Assigning back to the order's own (default) invoice number just
    // removes the exception entirely — no group needed to say "use the
    // default", that's already what an absent entry means.
    const newGroups = toMain
      ? withoutKeys
      : (() => {
        const existing = withoutKeys.find((g) => strip(g.invoiceId) === normalized);
        if (existing) {
          return withoutKeys.map((g) => (g === existing
            ? withSplitQty({ ...g, jenisPlakList: [...g.jenisPlakList, ...keys] }, qtyByJenisPlak)
            : g));
        }
        // Stamped with the order's current status (same reasoning as
        // approveAndSetInvoiceId above) so this newly-split-off invoice
        // starts tracking its own production/delivery status right away.
        // (an invoice whose only Jenis Plak are being retyped keeps its own status / dates)
        const was = (order.invoiceGroups || []).find((g) => strip(g.invoiceId) === normalized);
        const { jenisPlakList: _jp, qtyByJenisPlak: _q, ...wasRest } = was || {};
        return [...withoutKeys, withSplitQty(was
          ? { ...wasRest, jenisPlakList: keys }
          : { invoiceId: normalized, jenisPlakList: keys, status: order.status, invoicedAt: new Date().toISOString() }, qtyByJenisPlak)];
      })();
    try {
      await updateOrder(orderId, { invoiceGroups: newGroups });
    } catch (err) {
      console.error('Failed to save invoice group to Supabase:', err);
      flashToast('updateToast', describeOrderWriteError(err, 'save the invoice split for'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, invoiceGroups: newGroups } : o)),
    }));
    flashToast('updateToast', 'Invoice split saved.');
    return { ok: true };
  }, [patch, flashToast]);

  // Store Admin: replaces an invoice number that's ALREADY on record — the
  // order's own invoiceId or one split group's — at any status. Billing
  // re-issues a new number when an order gets amended / a Tambahan lands in
  // the following month, so the old number must be swappable. The guard
  // (0070) lets store_admin write invoice_id / invoice_groups at any time.
  const renameInvoiceNumber = useCallback(async (orderId, oldInvoiceId, newInvoiceId) => {
    const normalized = (newInvoiceId || '').replace(/\s+/g, '');
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    const groups = order?.invoiceGroups || [];
    const isMain = !!order && !!oldInvoiceId && order.invoiceId === oldInvoiceId;
    if (!order || (!isMain && !groups.some((g) => g.invoiceId === oldInvoiceId))) {
      flashToast('productionToast', 'That invoice number is no longer on this order. Please refresh.');
      return { ok: false };
    }
    if (!normalized) {
      flashToast('productionToast', 'Enter a valid Invoice ID.');
      return { ok: false };
    }
    if (normalized === oldInvoiceId) return { ok: true, invoiceId: normalized };
    const ownOthers = [order.invoiceId, ...groups.map((g) => g.invoiceId)].filter((v) => v && v !== oldInvoiceId);
    if (ownOthers.includes(normalized)) {
      flashToast('productionToast', 'Invoice numbers must be different from each other.');
      return { ok: false };
    }
    if (invoiceNumberTaken(st.orders, orderId, normalized)) {
      flashToast('productionToast', 'Invoice ID invalid because repeated, please try again.');
      return { ok: false };
    }
    const fields = isMain
      ? { invoiceId: normalized }
      : { invoiceGroups: groups.map((g) => (g.invoiceId === oldInvoiceId ? { ...g, invoiceId: normalized } : g)) };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to rename invoice number in Supabase:', err);
      flashToast('productionToast', describeOrderWriteError(err, 'change the invoice number for'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
    }));
    flashToast('productionToast', `Invoice number changed to ${normalized}.`);
    return { ok: true, invoiceId: normalized };
  }, [patch, flashToast]);

  // Store Admin: approves a reviewed, still-"Reviewing Order" order (or a Salesman Approved one) and
  // assigns its Invoice Number in the same action — for orders a Salesman
  // hands over as a paper hard copy before ever clicking Approve
  // themselves (receiving the hard copy already means they've agreed to
  // it). A merge of approveOrder (originalUnitPrice capture, totalAmount/
  // priceAdjusted recompute, status -> 'In Production') and setInvoiceId
  // (normalize/validate/duplicate-check) into ONE updateOrder call — the
  // orders_write_guard trigger (0038_invoicing_can_approve.sql) validates
  // old vs new as a single row change, so items/status/invoiceId must all
  // land in the same write, not two separate ones. Sales' own approve
  // button (approveOrder) is untouched — this is an additional path to
  // the same end state, not a replacement.
  //
  // `invoiceGroups` (optional, 0070) lets Store Admin decide the split
  // BEFORE ever clicking Approve — tick which Jenis Plak go on a second
  // invoice while filling in the main one, then Approve does everything
  // (status, main invoiceId, AND the split) in this one write, same order
  // id. Kept optional/defaulted to [] so every other caller of this action
  // (the common, un-split case) is unaffected.
  const approveAndSetInvoiceId = useCallback(async (orderId, updatedItems, invoiceId, overrides = {}, invoiceGroups = []) => {
    const normalized = (invoiceId || '').replace(/\s+/g, '');
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    const salesApproved = order?.status === 'Salesman Approved';
    if (!order || !(salesApproved || (order.status === 'Reviewing Order' && isReviewed(order)))) {
      flashToast('productionToast', order?.status === 'Reviewing Order'
        ? 'Production hasn’t finished reviewing this order yet.'
        : 'This order is not ready for invoice entry.');
      return { ok: false };
    }
    if (salesApproved && order.invoiceId) {
      flashToast('productionToast', 'Invoice ID is already set for this order.');
      return { ok: false };
    }
    if (!normalized) {
      flashToast('productionToast', 'Enter a valid Invoice ID.');
      return { ok: false };
    }
    // Normalize the split groups alongside the main invoice number — a
    // group whose number turns out identical to the main one needs no
    // exception at all (that's already the default), and every number
    // (main + every split) must be distinct from each other and from every
    // OTHER order's invoiceId, same rule setInvoiceId/setJenisPlakInvoiceGroup
    // already enforce individually.
    const normalizedGroups = [];
    let qtyError = null;
    (invoiceGroups || []).forEach((g) => {
      const gNorm = (g.invoiceId || '').replace(/\s+/g, '');
      const keys = (g.jenisPlakList || []).filter(Boolean);
      if (!gNorm || keys.length === 0 || gNorm === normalized) return;
      const split = normalizeSplitQty(updatedItems, keys, g.qtyByJenisPlak);
      if (split.error) { qtyError = split.error; return; }
      // Stamped with the status the order is being approved into (below) so
      // this group tracks its OWN production/delivery status from the
      // start (markProductionDone, per-invoice — 0072) instead of quietly
      // inheriting whatever orders.status happens to be until Production
      // marks it done independently — see getOrderInvoiceSlices's fallback
      // (src/utils/orderBatches.js), which only exists for groups created
      // before this existed.
      normalizedGroups.push(withSplitQty({ invoiceId: gNorm, jenisPlakList: keys, status: 'In Production', invoicedAt: new Date().toISOString() }, split.qtyByJenisPlak));
    });
    if (qtyError) {
      flashToast('productionToast', qtyError);
      return { ok: false };
    }
    const allInvoiceNumbers = [normalized, ...normalizedGroups.map((g) => g.invoiceId)];
    if (new Set(allInvoiceNumbers).size !== allInvoiceNumbers.length) {
      flashToast('productionToast', 'Invoice numbers must be different from each other.');
      return { ok: false };
    }
    if (allInvoiceNumbers.some((num) => invoiceNumberTaken(st.orders, orderId, num))) {
      flashToast('productionToast', 'Invoice ID invalid because repeated, please try again.');
      return { ok: false };
    }
    const priorItems = order.items || [];
    const itemsWithOriginalPrice = updatedItems.map((it) => {
      const prior = priorItems.find((p) => p.id === it.id);
      if (prior && prior.unitPrice !== it.unitPrice && it.originalUnitPrice == null) {
        return { ...it, originalUnitPrice: prior.unitPrice };
      }
      return it;
    });
    const totalAmount = itemsWithOriginalPrice.reduce((sum, it) => sum + it.harga, 0);
    const priceAdjusted = itemsWithOriginalPrice.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog));
    // urgent counts from the invoice day — today (urgentOrder.js)
    const urgent = isUrgentShipment(malaysiaToday(), overrides.shipmentDate || order.shipmentDate);
    // Already approved by Sales: prices / dates are settled — only the
    // Invoice Number (and any split) lands now.
    const fields = salesApproved
      ? { status: 'In Production', invoiceId: normalized, invoiceGroups: normalizedGroups, urgent }
      : {
        items: itemsWithOriginalPrice, totalAmount, priceAdjusted, status: 'In Production', invoiceId: normalized, invoiceGroups: normalizedGroups, ...storedDays(overrides), urgent,
      };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to approve and save invoice ID to Supabase:', err);
      flashToast('productionToast', describeOrderWriteError(err, 'approve'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
    }));
    flashToast('productionToast', salesApproved ? 'Invoice Number saved — order is now In Production.' : 'Order approved and Invoice Number saved.');
    // Invoice Number and `urgent` both land in this same write — this is
    // the other trigger point for the one-time Sheets sync (setInvoiceId
    // above is the other). Fire-and-forget, same reasoning as there.
    if (urgent && !order.urgentSheetSyncedAt) {
      attemptUrgentSheetSync({ ...order, ...fields });
    }
    return { ok: true };
  }, [patch, flashToast, attemptUrgentSheetSync]);

  // Stamps the actual moment a Teacher/Salesman print action happened —
  // not the order's creation date — so "Order Printed" on the printout
  // reflects when it was really printed. Overwrites on every re-print (no
  // history table — consistent with the rest of this flat-column orders
  // table, and there's no prior print-time data to lose). Optimistic
  // local update first so the just-updated value is already in the DOM by
  // the time window.print() reads it; Supabase write is fire-and-forget,
  // same pattern as setInvoiceId above.
  const recordPrint = useCallback((orderId) => {
    const printedAt = new Date().toISOString();
    patch((st) => ({
      orders: st.orders.map((o) => (o.id === orderId ? { ...o, printedAt } : o)),
    }));
    updateOrder(orderId, { printedAt })
      .catch((err) => console.error('Failed to save print timestamp to Supabase:', err));
  }, [patch]);

  // fetchOrders() only pulls a bounded window of recent orders into
  // `state.orders`. A detail page opened for an order outside that window
  // (an old one, a deep link) would otherwise find nothing — this fetches
  // that one order by id (RLS still applies) and merges it in, so every
  // existing `state.orders.find(...)` keeps working. No-op if it's already
  // loaded or the caller can't see it.
  const ensureOrderLoaded = useCallback(async (orderId) => {
    if (!orderId || stateRef.current.orders.some((o) => o.id === orderId)) return;
    try {
      const order = await fetchOrderById(orderId);
      if (!order) return;
      patch((latest) => (
        latest.orders.some((o) => o.id === orderId) ? {} : { orders: [order, ...latest.orders] }
      ));
    } catch (err) {
      console.error('Failed to load order on demand:', orderId, err);
    }
  }, [patch]);

  // Production: signals the order — or, for a split order (0070), just ONE
  // of its invoices — is physically finished and handed off to delivery.
  // Only offered once an invoice ID is on record (production's own
  // dashboard groups orders into "Pending Invoice" vs "Ready for Export" —
  // this button lives in the latter, see src/pages/ProductionDashboard.jsx).
  // `sliceInvoiceId` is whichever invoice's card the button was clicked on
  // (see getOrderInvoiceSlices, src/utils/orderBatches.js) — when it's the
  // order's own (default) invoiceId this writes orders.status exactly as
  // before; when it's one of order.invoiceGroups' own invoiceId, only that
  // group's own `status` field is written, so the order's other invoice(s)
  // are untouched and keep moving independently. Unlike setInvoiceId/
  // approveOrder above (which update local state immediately and let the
  // Supabase write fail silently in the background), this awaits the write
  // first — a failed status change here must never show "Waiting for
  // Delivery" locally when the database still says otherwise — and
  // surfaces success/failure via the same `productionToast` the rest of
  // this page's actions already use.
  // Writes `fields` onto one invoice slice of an order: the order itself for
  // its own (default) invoice, else that invoice_groups entry.
  const writeSlice = useCallback(async (order, slice, fields) => {
    const next = slice.isDefault
      ? fields
      : { invoiceGroups: slice.groups.map((g) => (g === slice.group ? { ...g, ...fields } : g)) };
    await updateOrder(order.id, next);
    patch((st) => ({ orders: st.orders.map((o) => (o.id === order.id ? { ...o, ...next } : o)) }));
  }, [patch]);

  const flashProductionToast = useCallback((message) => {
    patch({ productionToast: message });
    clearTimeout(productionToastTimer.current);
    productionToastTimer.current = setTimeout(() => patch({ productionToast: '' }), 2500);
  }, [patch]);

  // Production's Done Typing (0078): the AI file for this invoice is
  // generated — the Production head can print it. Status stays In Production.
  const markTypingDone = useCallback(async (orderId, sliceInvoiceId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    const slice = findInvoiceSlice(order, sliceInvoiceId);
    if (!slice || slice.status !== 'In Production' || slice.typedAt) {
      flashProductionToast('This order is not waiting for typing.');
      return;
    }
    const typedAt = new Date().toISOString();
    try {
      // confirmed crystals were typed with these plaques (crystalWithPlak)
      await writeSlice(order, slice, slice.isDefault && crystalWithPlak(order) ? { typedAt, crystalTypedAt: typedAt } : { typedAt });
      flashProductionToast('Typing done — the order is now In Production, ready to print.');
    } catch (err) {
      console.error('Failed to mark typing done in Supabase:', err);
      flashProductionToast(describeOrderWriteError(err, 'update'));
    }
  }, [writeSlice, flashProductionToast]);

  // KIV & ARTWORK (Sean, 2026-10-14) — an order's Reserved plaques and
  // crystals, made alongside its ordinary plaques (exportCsv.js kivParts).
  // Its own card: KIV & ARTWORK Done → In Production → Done. The order is
  // Completed once this AND its plaque card are done (whichever is last
  // moves it — see completeOrder / markProductionDone).
  const completeOrder = useCallback(async (order, extraFields = {}) => {
    const fields = { ...extraFields, status: 'Completed' };
    await updateOrder(order.id, fields);
    patch((st) => ({ orders: st.orders.map((o) => (o.id === order.id ? { ...o, ...fields } : o)) }));
    flashProductionToast('Production completed. Order is now Completed.');
  }, [patch, flashProductionToast]);

  const markKivDone = useCallback(async (orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order || !needsKiv(order)) {
      flashProductionToast('This order has nothing waiting in KIV & ARTWORK.');
      return;
    }
    // every KIV & ARTWORK card has DONE (Sean, 2026-10-28), SHORT SUPPLY too with Reserved names
    // still unfilled (Sean, 2026-11-02); crystal artwork not confirmed yet is confirmed by this DONE
    // (the database stamps who and when)
    const confirmsArtwork = kivParts(order).includes('CRYSTAL') && !order.artworkConfirmedAt;
    const kivDoneAt = new Date().toISOString();
    try {
      await updateOrder(orderId, confirmsArtwork ? { kivDoneAt, artworkConfirmedAt: kivDoneAt } : { kivDoneAt });
    } catch (err) {
      console.error('Failed to mark KIV & ARTWORK done in Supabase:', err);
      flashProductionToast(describeOrderWriteError(err, 'update'));
      return;
    }
    patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, kivDoneAt, ...(confirmsArtwork ? { artworkConfirmedAt: kivDoneAt } : {}) } : o)) }));
    flashProductionToast(`${kivParts(order).join(' + ')} done${confirmsArtwork ? ' (artwork confirmed)' : ''} — now in In Production.`);
  }, [patch, flashProductionToast]);

  // The crystal artwork is right (Sean, 2026-10-14): a salesman's Confirm Artwork. The database
  // stamps who and when (0089) — read back so the page shows it. Returns an error message or null.
  const confirmArtwork = useCallback(async (orderId) => {
    try {
      await updateOrder(orderId, { artworkConfirmedAt: new Date().toISOString() });
    } catch (err) {
      console.error('Failed to confirm the artwork in Supabase:', err);
      return describeOrderWriteError(err, 'update');
    }
    try {
      const fresh = await fetchOrderById(orderId);
      if (fresh) patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? fresh : o)) }));
    } catch (err) {
      console.error('Confirmed, but could not reload the order:', err);
    }
    return null;
  }, [patch]);

  // Manual (Sean, 2026-10-19): the salesman sends the crystal on without confirming the
  // preview — Production sees it needs a designer (0102). Same return as confirmArtwork.
  const manualArtwork = useCallback(async (orderId) => {
    try {
      await markArtworkManual(orderId);
    } catch (err) {
      console.error('Failed to mark the artwork manual in Supabase:', err);
      return describeOrderWriteError(err, 'update');
    }
    try {
      const fresh = await fetchOrderById(orderId);
      if (fresh) patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? fresh : o)) }));
    } catch (err) {
      console.error('Marked manual, but could not reload the order:', err);
    }
    return null;
  }, [patch]);

  // The salesman's Printed mark (0115): on = now, off = cleared. Returns an error message, or null.
  const setSalesmanPrinted = useCallback(async (orderId, on) => {
    const at = on ? new Date().toISOString() : null;
    try {
      await saveSalesmanPrinted(orderId, at);
    } catch (err) {
      console.error('Failed to save the Printed mark in Supabase:', err);
      return describeOrderWriteError(err, 'update');
    }
    patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, salesmanPrintedAt: at } : o)) }));
    return null;
  }, [patch]);

  // Production's remark on an In Production card (0109). Returns an error message, or null.
  const setProductionNote = useCallback(async (orderId, note) => {
    try {
      await saveProductionNote(orderId, note.trim());
    } catch (err) {
      console.error('Failed to save the Production remark in Supabase:', err);
      return describeOrderWriteError(err, 'update');
    }
    patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, productionNote: note.trim() } : o)) }));
    return null;
  }, [patch]);

  // Production or the order's salesman types the real names over its "Reserved" rows
  // (0097, Sean 2026-10-17). names: { rowId: name }. Returns an error message, or null.
  const fillReservedNames = useCallback(async (orderId, names) => {
    const { error } = await supabase.rpc('fill_reserved_names', { p_order_id: orderId, p_names: names });
    if (error) {
      console.error('Failed to fill in the Reserved names:', error);
      return error.message || 'Could not save the names. Please try again.';
    }
    try {
      const fresh = await fetchOrderById(orderId);
      if (fresh) patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? fresh : o)) }));
    } catch (err) {
      console.error('Names saved, but could not reload the order:', err);
    }
    return null;
  }, [patch]);

  const markKivProductionDone = useCallback(async (orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'In Production' || !kivInProduction(order)) {
      flashProductionToast('This order’s KIV & ARTWORK part is not ready to be marked done.');
      return;
    }
    if (!order.invoiceId && !order.parentOrderId) {
      flashProductionToast('Waiting for Store Admin to assign an Invoice Number before this can be marked done.');
      return;
    }
    const kivProductionDoneAt = new Date().toISOString();
    // an invoice of only crystals / Reserved rows has no Typing card: it's done with this card (ORD-0108)
    const doneFields = { kivProductionDoneAt, ...((order.invoiceGroups || []).length ? { invoiceGroups: kivOnlyGroupsDone(order) } : {}) };
    try {
      if (hasPlakPart(order) && !order.plakDoneAt) {
        await updateOrder(orderId, doneFields);
        patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, ...doneFields } : o)) }));
        flashProductionToast(`${kivParts(order).join(' + ')} done — the order moves on once its plaques are done too.`);
      } else {
        await completeOrder(order, doneFields);
      }
    } catch (err) {
      console.error('Failed to mark KIV & ARTWORK production done in Supabase:', err);
      flashProductionToast('Unable to update order status. Please try again.');
    }
  }, [patch, flashProductionToast, completeOrder]);

  const markProductionDone = useCallback(async (orderId, sliceInvoiceId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    const slice = findInvoiceSlice(order, sliceInvoiceId);
    if (!slice || slice.status !== 'In Production') {
      flashProductionToast('This order is not ready to be marked done.');
      return;
    }
    // a Tambahan's own order (0091) is billed under its original's invoice
    if (slice.isDefault && !order.invoiceId && !order.parentOrderId) {
      flashProductionToast('Waiting for Store Admin to assign an Invoice Number before this can be marked done.');
      return;
    }
    if (!slice.typedAt) {
      flashProductionToast('Click Done Typing first — this order’s AI file isn’t typed yet.');
      return;
    }
    // The KIV & ARTWORK part still being made: just mark the plaques done; the
    // order moves on when that part's own In Production Done comes.
    if (slice.isDefault && kivParts(order).length > 0 && !order.kivProductionDoneAt) {
      const plakDoneAt = new Date().toISOString();
      try {
        await updateOrder(orderId, { plakDoneAt });
        patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, plakDoneAt } : o)) }));
        flashProductionToast(`Plaques done — the order moves on once its ${kivParts(order).join(' + ')} is done too.`);
      } catch (err) {
        console.error('Failed to mark plaques done in Supabase:', err);
        flashProductionToast('Unable to update order status. Please try again.');
      }
      return;
    }
    try {
      await writeSlice(order, slice, { status: 'Completed' });
      flashProductionToast('Production completed. Order is now Completed.');
    } catch (err) {
      console.error('Failed to mark order done in Supabase:', err);
      flashProductionToast('Unable to update order status. Please try again.');
    }
  }, [patch, writeSlice, flashProductionToast]);

  // Production's editor (ProductionEditOrder.jsx) while an order is being
  // reviewed — the order re-opened as a draft in Production's own scratch
  // fields (prodExcel*, the same ones the corrected-Excel parse fills), every
  // field editable.
  const openProductionEdit = useCallback((ord) => {
    const restored = buildDraftFromOrder(ord);
    const language = ord.schoolLanguage || 'SK';
    patch({
      schoolLanguage: language,
      prodExcelCategory: restored.category || '',
      prodExcelLineValues: restored.lineValues, prodExcelMatrixValues: restored.matrixValues,
      prodExcelRowsByBlock: { ...buildInitialRowsByBlock(language), ...restored.rowsByBlock },
      prodExcelColumnsByBlock: { ...buildInitialColumnsByBlock(), ...restored.columnsByBlock },
      prodExcelPlakRows: { ...buildInitialPlakRows(), ...restored.plakRows },
      prodExcelNextRowId: Math.max(1000, restored.nextId), prodExcelNextPlakRowId: Math.max(1000, restored.nextId), prodExcelNextColumnId: Math.max(1000, restored.nextId),
      prodExcelVisibleBlocksByCategory: restored.visibleBlocksByCategory,
    });
  }, [patch]);

  // Fills that editor from a corrected Excel instead (Production downloads
  // the teacher's file, fixes it, uploads it here) — Production checks the
  // result on screen and only Save changes the order.
  const loadExcelIntoProductionEdit = useCallback(async (ord, file) => {
    const language = ord.schoolLanguage || 'SK';
    patch({
      schoolLanguage: language,
      prodExcelCategory: '', prodExcelLineValues: {}, prodExcelMatrixValues: {},
      prodExcelRowsByBlock: buildInitialRowsByBlock(language),
      prodExcelColumnsByBlock: buildInitialColumnsByBlock(), prodExcelPlakRows: buildInitialPlakRows(),
      prodExcelNextRowId: 1000, prodExcelNextPlakRowId: 1000, prodExcelNextColumnId: 1000,
      prodExcelVisibleBlocksByCategory: {},
    });
    return importFormAnugerahExcelInto(file, PROD_EXCEL_IMPORT_FIELDS);
  }, [patch, importFormAnugerahExcelInto]);

  // Saves that editor over the order (still 'Reviewing Order' — nothing is
  // approved or invoiced yet): lines, quantities, Jenis Plak, website prices
  // and total are rebuilt with the same blocks → items conversion a teacher's
  // Submit uses (buildCategoryCartItems), and stock follows the difference
  // (stockDiff). Every role's pages show the result straight away. A
  // corrected-Excel overlay left from before is dropped — the order itself
  // is now the corrected version.
  // `addOn`: saves over the submitted add-on (pendingAddonItems) instead —
  // Production reviewing a Tambahan the same way as an order (Sean,
  // 2026-10-09). Its stock follows the difference too; the order's own
  // items/total are untouched.
  const saveProductionEdit = useCallback(async (orderId, { addOn = false } = {}) => {
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    if (addOn ? !isAddonInFlight(order) : !canProductionEdit(order)) {
      return { ok: false, message: addOn ? 'This order has no add-on waiting for review.' : 'Only an order being reviewed or In Production can be edited here.' };
    }
    const f = PROD_EXCEL_IMPORT_FIELDS;
    const draft = {
      lineValues: st[f.lineValues], matrixValues: st[f.matrixValues], rowsByBlock: st[f.rowsByBlock],
      plakRows: st[f.plakRows], columnsByBlock: st[f.columnsByBlock], plakCatalog: st.plakCatalog, schoolLanguage: st.schoolLanguage,
    };
    const catKeys = new Set([...CATEGORIES.map((c) => c.key), ...Object.keys(st[f.visibleBlocksByCategory] || {})]);
    const items = [];
    for (const catKey of catKeys) {
      const built = buildCategoryCartItems(draft, catKey);
      if (built.error) return { ok: false, message: `${resolveCategory(catKey)?.label || catKey}: ${built.error}` };
      if (built.items) items.push(...built.items);
    }
    if (items.length === 0) return { ok: false, message: 'Nothing to save — the order would have no plaques left.' };
    const before = addOn ? order.pendingAddonItems : order.items;
    // In Production it is already invoiced: the prices it was billed at stay
    const inProduction = !addOn && order.status === 'In Production';
    if (inProduction) items.splice(0, items.length, ...keepPrices(before, items));
    const totalAmount = items.reduce((sum, it) => sum + it.harga, 0);
    const { deduct, restore } = stockDiff(before, items);
    const realStock = !isTestOrderId(order.id);
    try {
      if (realStock) await deductPlakStock(deduct);
    } catch (err) {
      console.error('Failed to take stock for a Production edit:', err);
      return { ok: false, message: describeStockError(err, patch) };
    }
    // An edited add-on keeps pointing at the Excel it came from.
    const addonFile = addOn ? (order.pendingAddonItems || []).find((it) => it.importFile)?.importFile : null;
    const fields = addOn
      ? { pendingAddonItems: withImportFile(items, addonFile), pendingAddonStatus: 'pending' }
      : {
        items, totalAmount,
        priceAdjusted: inProduction ? items.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog)) : false,
        correctedImportFilePath: null, correctedImportFileName: null, correctedImportUploadedAt: null,
      };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to save a Production edit:', err);
      if (realStock) restorePlakStock(deduct).catch((e) => console.error('Failed to give stock back after a failed edit:', e));
      return { ok: false, message: describeOrderWriteError(err, 'save') };
    }
    if (realStock) restorePlakStock(restore).catch((err) => console.error('Failed to give back stock after a Production edit:', err));
    patch((latest) => ({ orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)) }));
    return { ok: true };
  }, [patch]);

  // Production adjusts prices while reviewing (Sean, 2026-10-09 — e.g. RM1
  // more on plaques carrying a student's name): the order's items, or with
  // `addOn` the submitted add-on's. The salesman still sees (and can change)
  // them when approving.
  const saveProductionPrices = useCallback(async (orderId, drafts, { addOn = false } = {}) => {
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    if (addOn ? !isAddonInFlight(order) : (!order || order.status !== 'Reviewing Order')) {
      return { ok: false, message: addOn ? 'This order has no add-on waiting for review.' : 'Prices can only be changed while the order is being reviewed.' };
    }
    const res = applyPriceDrafts(addOn ? order.pendingAddonItems : order.items, drafts);
    if (res.error) return { ok: false, message: res.error };
    const fields = addOn
      ? { pendingAddonItems: res.items }
      : {
        items: res.items,
        totalAmount: res.items.reduce((sum, it) => sum + (Number(it.harga) || 0), 0),
        priceAdjusted: res.items.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog)),
      };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to save Production prices:', err);
      return { ok: false, message: describeOrderWriteError(err, 'save the prices of') };
    }
    patch((latest) => ({ orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)) }));
    return { ok: true };
  }, [patch]);

  // Production: "Done Review" — the order has been checked (and fixed if
  // needed, see saveProductionEdit); Sales / Store Admin can approve it now.
  // The status stays 'Reviewing Order' — reviewedAt is the mark.
  const markReviewDone = useCallback(async (orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'Reviewing Order' || isReviewed(order)) return { ok: false };
    const reviewedAt = new Date().toISOString();
    try {
      await updateOrder(orderId, { reviewedAt });
    } catch (err) {
      console.error('Failed to save Done Review:', err);
      flashToast('productionToast', describeOrderWriteError(err, 'mark as reviewed'));
      return { ok: false };
    }
    patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, reviewedAt } : o)) }));
    flashToast('productionToast', 'Review done — Sales can approve this order now.');
    return { ok: true };
  }, [patch, flashToast]);

  // Production: "Done Review" on a submitted add-on (0085) — the salesman
  // can approve it after this.
  const markAddOnReviewed = useCallback(async (orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order || order.pendingAddonStatus !== 'pending') return { ok: false };
    try {
      await updateOrder(orderId, { pendingAddonStatus: 'reviewed' });
    } catch (err) {
      console.error('Failed to save add-on review:', err);
      flashToast('productionToast', describeOrderWriteError(err, 'mark the add-on as reviewed for'));
      return { ok: false };
    }
    patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, pendingAddonStatus: 'reviewed' } : o)) }));
    flashToast('productionToast', 'Add-on reviewed — Sales can approve it now.');
    return { ok: true };
  }, [patch, flashToast]);

  // Production: re-orders one category block's Reference Sample rows after
  // the order is submitted (ProductionOrderDetail gates this until the
  // Shipment Date). Only that block's refOrder line changes — on every item
  // sharing the block, since each Jenis Plak item carries its own copy of
  // the block's lines — so every CSV / AI file for the category follows it.
  const updateReferenceOrder = useCallback(async (orderId, refOrderKey, value) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    // the row order (refOrder), or Production's MERAH ticks while reviewing (redLines)
    const reviewing = order?.status === 'Reviewing Order';
    const field = refOrderKey.endsWith('::refOrder') ? 'refOrder'
      : refOrderKey.endsWith('::redLines') && reviewing ? 'redLines'
        : refOrderKey.endsWith('::umumRed') && reviewing ? 'umumRed' : null;
    if (!order || !field) return false;
    const blockPrefix = refOrderKey.slice(0, -field.length);
    const items = (order.items || []).map((it) => (
      it.detail && `${it.categoryKey}::${it.blockIdx ?? 0}::` === blockPrefix
        ? { ...it, detail: { ...it.detail, lines: { ...(it.detail.lines || {}), [refOrderKey]: value } } }
        : it
    ));
    try {
      await updateOrder(orderId, { items });
      patch((st) => ({ orders: st.orders.map((o) => (o.id === orderId ? { ...o, items } : o)) }));
      return true;
    } catch (err) {
      console.error('Failed to save the Reference Sample row order:', err);
      return false;
    }
  }, [patch]);

  // Production catalog admin: add/remove/edit-price/hide all change the
  // source of truth in Supabase, then refetch the whole (small, ~150-node)
  // tree and rebuild it client-side — simpler and less error-prone than
  // hand-patching a nested tree in local state to match.
  const refreshPlakCatalog = useCallback(async () => {
    try {
      const plakCatalog = await fetchPlakCatalog();
      patch({ plakCatalog });
    } catch (err) {
      console.error('Failed to refresh Jenis Plak catalog from Supabase:', err);
    }
  }, [patch]);

  // parentId null adds a new top-level code; pass an existing node's id to
  // add a variant underneath it (e.g. a new color under an existing code).
  const addCatalogNode = useCallback(async (parentId, code, price, siblingCount) => {
    try {
      await addPlakNode(parentId, code, price, siblingCount || 0);
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to add Jenis Plak code to Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  // Deletes the node and everything beneath it (the FK cascades).
  const removeCatalogNode = useCallback(async (id) => {
    try {
      await removePlakNode(id);
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to remove Jenis Plak code from Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  const updateCatalogNodePrice = useCallback(async (id, price) => {
    try {
      await updatePlakNode(id, { price });
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to update Jenis Plak price in Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  // Renames a code / variant. Only NEW orders pick up the new name — an
  // order already placed stores its Jenis Plak as the old " / "-joined
  // path text, and nothing rewrites that (the catalog page warns before
  // it saves). Fine for a typo fix; risky for a code with live orders.
  const renameCatalogNode = useCallback(async (id, code) => {
    try {
      await updatePlakNode(id, { code });
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to rename Jenis Plak code in Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  // Sets a leaf's STOCK number (stock_baseline) — the running BALANCE
  // (stock_qty) shifts by the same delta rather than getting overwritten
  // (see updatePlakNodeStock / 0073_stock_restock_preserves_balance.sql),
  // so restocking preserves whatever's already been used instead of
  // resetting it. `stockGroupKey` routes the write to the shared
  // plak_stock_groups row instead of the node's own columns when this node
  // is linked to one (see linkCatalogNodeStockGroup below).
  const updateCatalogNodeStock = useCallback(async (id, stockQty, stockGroupKey) => {
    try {
      if (stockGroupKey) await updateStockGroupStock(stockGroupKey, stockQty);
      else await updatePlakNodeStock(id, stockQty);
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to update Jenis Plak stock in Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  // Attaches a node to a shared Stock Group (creating it with
  // initialStockQty if the name is new) so it shares one stock count with
  // every other node linked to the same key — see
  // 0058_add_plak_stock_groups.sql. Rethrows (unlike the other catalog
  // actions here) because the caller needs to know linking failed — e.g. no
  // starting number was given for a brand new group — so it can keep its
  // draft input instead of quietly reverting.
  const linkCatalogNodeStockGroup = useCallback(async (id, groupKey, initialStockQty) => {
    await linkPlakNodeToStockGroup(id, groupKey, initialStockQty);
    await refreshPlakCatalog();
  }, [refreshPlakCatalog]);

  // Detaches a node from its Stock Group back to independent tracking
  // (starting from "not tracked yet", same as a brand new code).
  const unlinkCatalogNodeStockGroup = useCallback(async (id) => {
    try {
      await unlinkPlakNodeFromStockGroup(id);
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to unlink Jenis Plak Stock Group in Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  // Hiding is per-node, not per-path — hiding a group hides everything
  // beneath it (see filterHiddenPlakCatalog), but each node's hidden state
  // is stored and toggled independently, so unhiding a group later doesn't
  // silently reveal a variant that was individually hidden before that.
  // `patch` is { hidden } or { show_when_low } — see catalogVisibilityToggle.
  const setCatalogNodeVisibility = useCallback(async (id, patch) => {
    try {
      await updatePlakNode(id, patch);
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to update Jenis Plak visibility in Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  // Swaps a node with its previous/next sibling and renumbers every
  // sibling's sort_order 0..N-1 to match — not just the swapped pair,
  // since ties are common (new codes/variants all default to sort_order
  // 0 or a rough count) and only a full renumber reliably fixes those
  // instead of leaving some pairs still tied.
  const moveCatalogNode = useCallback(async (id, direction) => {
    const found = findNodeAndSiblings(stateRef.current.plakCatalog, id);
    if (!found) return;
    const { siblings } = found;
    const idx = siblings.findIndex((n) => n.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    try {
      await Promise.all(reordered.map((n, i) => updatePlakNode(n.id, { sort_order: i })));
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to reorder Jenis Plak catalog in Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  // Drag-and-drop reorder (AdminCatalog.jsx) — `orderedIds` is the full
  // sibling group in its new order. Unlike moveCatalogNode above (always a
  // 2-row adjacent swap), a drag can shift many siblings' indices in one
  // move, so this writes the whole group in a single batched upsert
  // (updatePlakNodeOrder) instead of N sequential updates, skipping rows
  // whose sort_order didn't actually change.
  const reorderCatalogSiblings = useCallback(async (orderedIds) => {
    const found = findNodeAndSiblings(stateRef.current.plakCatalog, orderedIds[0]);
    if (!found) return;
    const { siblings } = found;
    const originalIndex = new Map(siblings.map((n, i) => [n.id, i]));
    const rows = orderedIds
      .map((id, i) => ({ id, sort_order: i }))
      .filter(({ id, sort_order }) => originalIndex.get(id) !== sort_order);
    if (rows.length === 0) return;
    try {
      await updatePlakNodeOrder(rows);
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to reorder Jenis Plak catalog in Supabase:', err);
    }
  }, [refreshPlakCatalog]);

  const value = {
    state, patch, today: TODAY, login, logout,
    resetCurrentCategory, startNewOrder, addToCart, addAllToCart, removeFromCart, editCartCategory, restoreCartToDraft, submitOrder, checkDuplicateOrders, reorderOrder, openEditOrder, saveEditedOrder,
    importFormAnugerahExcel, importFormAnugerahExcelInto, convertImportToForm, readSkippedSheetsWithAi,
    openAmend, updateAmend,
    openAddOn, clearAddOnPrefill, addOnAddToCart, removeFromAddOnCart, submitPendingAddOn, cancelPendingAddOn, rejectAddOn, approveAddOn, approveOrder, setInvoiceId, approveAndSetInvoiceId,
    setJenisPlakInvoiceGroup, renameInvoiceNumber,
    retryUrgentSheetSync, updateShipmentAndUrgency, updateOrderDetails,
    cancelOrder,
    reassignSalesman,
    uploadCorrectedExcel, loadCorrectedExcelPreview,
    recordPrint,
    ensureOrderLoaded,
    markProductionDone,
    markTypingDone,
    updateReferenceOrder,
    markReviewDone,
    markAddOnReviewed, saveProductionPrices, markKivDone, markKivProductionDone, confirmArtwork, manualArtwork, setProductionNote, setSalesmanPrinted, fillReservedNames,
    openProductionEdit,
    loadExcelIntoProductionEdit,
    saveProductionEdit,
    addCatalogNode, removeCatalogNode, updateCatalogNodePrice, renameCatalogNode, updateCatalogNodeStock, setCatalogNodeVisibility, moveCatalogNode,
    linkCatalogNodeStockGroup, unlinkCatalogNodeStockGroup,
    reorderCatalogSiblings,
    refreshAssignedSalesman,
    pickActingSchool,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
