import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CATEGORIES, ACTIVE_CATEGORIES, formatDate, standardUnitPrice, getCategorySubjects, matrixCellKey, customMatrixLabelKey,
  deliveryStageForShipmentDate, SELEMPANG_CODE,
  resolveCategory, categoriesUsedByItems, isDynamicCategoryKey,
} from '../data/catalog';
import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';
import {
  computeBlocks, snapshotDetail, noopUpdaters, buildDraftFromOrder,
} from '../utils/computeBlocks';
import {
  parseFormAnugerahExcel, matchJenisPlakPath, deriveKlasMatrixSectionLines, populateMatrixSectionBlock,
} from '../utils/excelImport';
import { parseWordingDocx } from '../utils/docxImport';
import { checkColumnTotals, checkExpansionTotals, checkLevelBreakdownMatch, checkAliranKelasTotals } from '../utils/importChecks';
import { buildCategoryCartItems } from './categoryCartItems';
import { AppStateContext } from './AppStateContext';
import {
  fetchOrders, fetchOrderById, insertOrder, updateOrder, nextOrderSeq, fetchAllSalesmen, reassignOrderSalesman,
} from '../lib/ordersApi';
import {
  fetchPlakCatalog, addPlakNode, removePlakNode, updatePlakNode, updatePlakNodeOrder, updatePlakNodeStock,
  linkPlakNodeToStockGroup, unlinkPlakNodeFromStockGroup, updateStockGroupStock,
  deductPlakStock, restorePlakStock,
} from '../lib/catalogAdminApi';
import { supabase } from '../lib/supabaseClient';
import { uploadOrderImportFile, removeOrderImportFile, getOrderImportUrl } from '../lib/storageApi';
import { syncUrgentOrderToSheet } from '../lib/urgentSheetApi';
import { isUrgentShipment } from '../utils/urgentOrder';

// Real "today", normalized to midnight so it compares cleanly against the
// midnight-constructed dates the calendar cells and date-math use.
const now = new Date();
const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());

// plak_stock_deduct (supabase/migrations/0032_add_plak_stock.sql) raises a
// plain-text exception shaped 'INSUFFICIENT_STOCK:<full path>:<max
// orderable>' when a line would breach the reserve floor — turns that into
// the "contact your salesman" message the teacher actually needs, falling
// back to the raw error for anything else (unknown code, connection issue).
function describeStockError(err) {
  const m = /^INSUFFICIENT_STOCK:(.*):(\d+)$/.exec(err?.message || '');
  if (m) return `Not enough stock for "${m[1]}" — only ${m[2]} left available to order. Please lower the quantity or contact your salesman.`;
  return `Could not check stock: ${err?.message || 'unknown error'}. Please try again.`;
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
  if (/already in production|submit an Add-On|can no longer be edited|awaiting approval|only move an order|has been cancelled/i.test(m)) {
    return `This order can't be changed that way anymore: ${m}`;
  }
  if (/row-level security|not authorized|account is not active/i.test(m)) {
    return `You're not allowed to ${verb} this order right now — it may have moved to a later stage, or your session changed. Please refresh and try again.`;
  }
  return `Could not ${verb} this order: ${m || 'unknown error'}. Please try again.`;
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

function initialState() {
  return {
    userId: '',
    password: '',
    loginError: '',
    role: null,
    isSalesManager: false,
    isStoreAdminManager: false,
    sessionChecked: false,

    sekolah: '',
    schoolLanguage: 'SK',
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

    // Teacher editing under Submitted to Sales (see openAmend/updateAmend
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
const NEW_ORDER_IMPORT_FIELDS = {
  lineValues: 'lineValues', matrixValues: 'matrixValues', rowsByBlock: 'rowsByBlock', columnsByBlock: 'columnsByBlock', plakRows: 'plakRows',
  nextRowId: 'nextRowId', nextColumnId: 'nextColumnId', nextPlakRowId: 'nextPlakRowId',
  visibleBlocksByCategory: 'visibleBlocksByCategory', category: 'category',
  remark: 'remark', importFilePath: 'importFilePath', importFileName: 'importFileName',
};

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
            .select('role, sekolah, school_language, display_name, status, is_sales_manager, is_store_admin_manager')
            .eq('id', session.user.id)
            .single());
          if (profile || !profileError) break;
        }
        if (!cancelled && profile) {
          if (profile.status && profile.status !== 'active') {
            await supabase.auth.signOut();
            if (!cancelled) patch({ loginError: 'This account has been deactivated. Please contact your administrator.' });
          } else {
            patch({ role: profile.role, sekolah: profile.sekolah || '', schoolLanguage: profile.school_language || 'SK', userAuthId: session.user.id, isSalesManager: !!profile.is_sales_manager, isStoreAdminManager: !!profile.is_store_admin_manager });
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
    if (st.role !== 'teacher' || !st.userAuthId) return;
    try {
      const salesmen = await fetchAllSalesmen();
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
      .select('role, sekolah, school_language, display_name, status, is_sales_manager, is_store_admin_manager')
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
    patch({ role: profile.role, sekolah: profile.sekolah || '', schoolLanguage: profile.school_language || 'SK', userAuthId: data.user.id, isSalesManager: !!profile.is_sales_manager, isStoreAdminManager: !!profile.is_store_admin_manager, loginError: '', userId: '', password: '' });
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
    patch((st) => ({
      sales: '', picName: '', phone: '', ketuaPanitia: '', terms: '', remark: '',
      shipmentDateSelected: null, funcSelected: null,
      logoDataUrl: null, logoFileName: '', logoRemark: '', schoolType: null, stepError: '',
      importFilePath: null, importFileName: null,

      category: null,
      lineValues: {}, matrixValues: {},
      rowsByBlock: buildInitialRowsByBlock(st.schoolLanguage), columnsByBlock: buildInitialColumnsByBlock(), plakRows: buildInitialPlakRows(),
      nextRowId: 1000, nextPlakRowId: 1000, nextColumnId: 1000, visibleBlocksByCategory: {},

      cart: [], cartToast: '',
    }));
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
        cart: [...st.cart.filter((ci) => ci.categoryKey !== st.category), ...items],
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
        cart: [...working.cart.filter((ci) => !touchedKeys.has(ci.categoryKey)), ...allItems],
        cartToast: `Added ${allItems.length} item(s) from ${doneLabels.length} categor${doneLabels.length === 1 ? 'y' : 'ies'} to cart.`,
      };
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ cartToast: '' }), 3000);
  }, [patch]);

  // Reads a teacher-uploaded past order file — either a filled-in copy of
  // the FORM ANUGERAH Excel template (MP THP 1/2, PBD, LONJAKAN SAUJANA,
  // TOKOH, the native "KLAS MATRIX" sheet — see excelImport.js) or a Word
  // "WORDING / KUANTITI / KOD HADIAH" order table (see docxImport.js), a
  // completely different real-world shape some schools use instead. Both
  // parsers return the exact same `{ klasMatrix: { sections } }` shape, so
  // whichever one matches the file's own extension feeds the same merge
  // step below — every recognized award, regardless of source format,
  // lands in KLAS_MATRIX (see excelImport.js's header comment for why one
  // destination beats splitting across categories). Deliberately REPLACES
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
  const importFormAnugerahExcelInto = useCallback(async (file, fields, { applyFilter } = {}) => {
    let parsed;
    try {
      const buffer = await file.arrayBuffer();
      parsed = /\.docx$/i.test(file.name) ? await parseWordingDocx(buffer) : parseFormAnugerahExcel(buffer);
    } catch (err) {
      console.error('Failed to read uploaded order file:', err);
      return { ok: false, message: 'Could not read this file. Please try again.' };
    }
    if (parsed.error) {
      return { ok: false, message: parsed.error };
    }

    const messages = [];
    const warnings = [];
    const remarkNotes = [];
    let landOn = null;

    // Computed from a plain snapshot (stateRef.current — nothing else can
    // change it between here and the setState call below, since there's no
    // `await` in between) rather than inside a setState updater function:
    // React 18 Strict Mode deliberately invokes an updater function TWICE
    // in development to catch impurity, and `warnings`/`messages`
    // above are mutated (via .push) as a side effect of running this block
    // — a second invocation would silently double every warning/message
    // (exactly what duplicated every "couldn't match Jenis Plak" line in
    // the review list). Computing the whole result once, up front, and
    // handing setState an already-finished plain object sidesteps the
    // problem entirely — merging the same finished object twice is a
    // no-op, not a double-push.
    const st = stateRef.current;
    let next = st;

    // KLAS_MATRIX ("Mata Pelajaran / Klas (Matrix)") is retired from new
    // orders (catalog.js) — every FORM ANUGERAH sheet now has its own
    // category. A generic/legacy sheet that would once have landed there
    // (e.g. a stray "TOKOH" or "KLAS MATRIX" sheet) is reported as skipped
    // rather than filling a category the teacher can no longer see or edit.
    const klasMatrixActive = CATEGORIES.find((c) => c.key === 'KLAS_MATRIX')?.active !== false;
    if (parsed.klasMatrix && !klasMatrixActive) {
      warnings.push({
        type: 'truncated',
        text: `${parsed.klasMatrix.sections.length} section(s) in this file didn't match any FORM ANUGERAH sheet and were skipped — please add them by hand.`,
      });
    }

    if (parsed.klasMatrix && klasMatrixActive) {
      const catKey = 'KLAS_MATRIX';
      const cat = CATEGORIES.find((c) => c.key === catKey);
      const maxSections = Math.min(parsed.klasMatrix.sections.length, cat.blocksCount || 1);
      // A file with more independent awards than KLAS_MATRIX has room for
      // (catalog.js's blocksCount) would otherwise just silently lose the
      // rest — nothing else here would ever tell the teacher a whole
      // section didn't make it in at all.
      if (parsed.klasMatrix.sections.length > maxSections) {
        warnings.push({ type: 'truncated', text: `This file has ${parsed.klasMatrix.sections.length} sections, but only the first ${maxSections} could be imported — please upload the rest separately.` });
      }
      const defaultNames = getCategorySubjects(cat, next.schoolLanguage);
      let nextRowId = next[fields.nextRowId];
      let nextColumnId = next[fields.nextColumnId];
      let nextPlakRowId = next[fields.nextPlakRowId];
      const newLineValues = { ...next[fields.lineValues] };
      const newMatrixValues = { ...next[fields.matrixValues] };
      const newRowsByBlock = { ...next[fields.rowsByBlock] };
      const newColumnsByBlock = { ...next[fields.columnsByBlock] };
      const newPlakRows = { ...next[fields.plakRows] };
      // Clear every pre-allocated block's own draft first — a fresh import
      // is meant to fully replace whatever was there, not layer on top,
      // including any block this file's sections don't reach.
      for (let b = 0; b < (cat.blocksCount || 1); b++) {
        const key = `${catKey}::${b}`;
        Object.keys(newLineValues).forEach((k) => { if (k.startsWith(`${key}::`)) delete newLineValues[k]; });
        Object.keys(newMatrixValues).forEach((k) => { if (k.startsWith(`${key}::`)) delete newMatrixValues[k]; });
      }

      for (let b = 0; b < maxSections; b++) {
        const section = parsed.klasMatrix.sections[b];
        const key = `${catKey}::${b}`;
        // Only subjects this section's own source actually carried any
        // qty for — a section imported from PBD/LONJAKAN (their own
        // synthetic "KUANTITI"/"KEDUDUKAN" single-column stand-in) or from
        // a Nama Kelas list has no real subject breakdown at all, and
        // padding it out with the other 12 always-empty default subject
        // columns would just be noise the teacher has to scroll past and
        // manually delete. Subjects actually present are ordered to match
        // the familiar default-13 order first, with any name outside that
        // list (MP THP 2's own SEJARAH/REKA BENTUK & TEKNOLOGI, or the
        // synthetic stand-ins above) appended after — see
        // populateMatrixSectionBlock.
        //
        // "SM - 13187 (GOLD)" etc isn't itself a valid Jenis Plak value —
        // PlakPicker/pricing need the exact ' / '-joined catalog path
        // (e.g. "SM-13187 / GOLD / NORMAL") — matchJenisPlakPath walks the
        // LIVE catalog tree to build it, defaulting an unmentioned base to
        // "NORMAL" the same way a teacher would if they left it out. Left
        // BLANK (never the raw, un-matched text) when even the code itself
        // can't be found in the catalog at all — raw text sitting in this
        // field would otherwise look like a real, chosen Jenis Plak (it
        // satisfies addToCart's own hasJenisPlak check, silently letting a
        // completely un-priced, unstocked value through to checkout);
        // leaving it genuinely blank routes it through that SAME existing
        // "please choose a Jenis Plak" gate instead of past it. The
        // teacher would never otherwise realize this one field didn't
        // actually come from their file — flagged in `warnings` below.
        // `blockIdx` lets NewOrderStep2.jsx re-check THIS specific block's
        // own live plakRows on every render and drop the warning the
        // moment the teacher actually picks something — a warning that
        // still said "please choose manually" after they just did would
        // read as broken, not helpful.
        const ids = { nextRowId, nextColumnId, nextPlakRowId };
        const matchedPlak = populateMatrixSectionBlock(
          section, key, defaultNames, ids,
          { newLineValues, newMatrixValues, newRowsByBlock, newColumnsByBlock, newPlakRows },
          next.plakCatalog,
        );
        ({ nextRowId, nextColumnId, nextPlakRowId } = ids);
        if (section.jenisPlak && !matchedPlak) {
          warnings.push({ type: 'plakMismatch', blockIdx: b, text: `Section ${b + 1}: couldn't match Jenis Plak "${section.jenisPlak}" to anything in the catalog — please choose it manually.` });
        }
        // A PERASMI section's own wording (findPerasmiSections) also goes
        // into the order's Remark, not just its own Reference Sample —
        // Sales/Invoicing/Production reading the order later never open
        // Step 2's block editor, so the ONLY place they'd otherwise see
        // this at all is the printed plaque preview itself.
        if (section.remarkNote) remarkNotes.push(section.remarkNote);
      }

      next = {
        ...next,
        [fields.lineValues]: newLineValues, [fields.matrixValues]: newMatrixValues,
        [fields.rowsByBlock]: newRowsByBlock, [fields.columnsByBlock]: newColumnsByBlock, [fields.plakRows]: newPlakRows,
        [fields.visibleBlocksByCategory]: { ...next[fields.visibleBlocksByCategory], [catKey]: maxSections },
        [fields.nextRowId]: nextRowId, [fields.nextColumnId]: nextColumnId, [fields.nextPlakRowId]: nextPlakRowId,
      };
      landOn = catKey;
      messages.push(`Mata Pelajaran/Klas (Matrix): ${maxSections} section(s)`);

      // Cross-check each subject matrix against the teacher's own TOTAL row.
      // A mismatch becomes a `type:'choice'` warning the teacher must answer
      // on Step 2 before Add to Cart (see NewOrderStep2's "需要你确认"
      // panel) — never auto-corrected here. Each option carries the exact
      // draft edits its answer implies, resolved to real row/column ids now
      // while newRowsByBlock/newColumnsByBlock are in scope.
      const importedSections = parsed.klasMatrix.sections.slice(0, maxSections);
      const columnTotalIssues = checkColumnTotals(importedSections);
      columnTotalIssues.forEach((iss) => {
        const key = `${catKey}::${iss.sectionIdx}`;
        const rows = newRowsByBlock[key] || [];
        const cols = newColumnsByBlock[key] || [];
        const col = cols.find((c) => (c.namaKelas || c.tahunFrom || c.tahunTo || '') === iss.classLabel);
        const addPatches = [];
        if (col) {
          iss.missing.forEach((m) => {
            const row = rows.find((r) => r.desc === m.name);
            if (row) addPatches.push({ mkey: `${key}::${row.id}::${col.id}`, value: String(m.qty) });
          });
        }
        const options = [];
        if (iss.missing.length > 0 && addPatches.length === iss.missing.length) {
          options.push({ key: 'add', label: `${iss.missing.map((m) => m.name).join(', ')} was left blank — fill it back in` });
        }
        options.push({ key: 'total', label: `The TOTAL figure is wrong — it should be ${iss.computed}` });
        options.push({ key: 'keep', label: 'Neither is right — I will fix it myself below' });
        warnings.push({
          type: 'choice',
          id: iss.id,
          blockIdx: iss.sectionIdx,
          text: `Section ${iss.sectionIdx + 1} · ${iss.classLabel}: you filled in ${iss.computed}, but the TOTAL says ${iss.stated}.`,
          options,
          addPatches,
        });
      });

      // Second cross-check: what each plaque code's sections add up to vs
      // the school's own FRONT PG grand total. No auto-fix — the parser
      // can't know where a shortfall belongs — so this only asks, and it
      // skips any code already covered by a column-total question above.
      checkExpansionTotals(importedSections, columnTotalIssues.map((i) => i.sectionIdx)).forEach((iss) => {
        const where = iss.sectionIdxs.map((i) => i + 1).join(', ');
        warnings.push({
          type: 'choice',
          id: iss.id,
          blockIdx: iss.sectionIdxs[0],
          text: `${iss.jenisPlak} (section ${where}): the imported classes add up to ${iss.computed}, but FRONT PG says ${iss.stated}. Something didn't come through — check this section below.`,
          options: [{ key: 'keep', label: 'Got it — take me to that section' }],
          addPatches: [],
        });
      });

    }

    // Sections from a sheet with its own dedicated real category (PPKI, MP
    // THP 1, ...) — see excelImport.js's `categorized` split — write
    // straight into that category's own fixed matrix instead of
    // KLAS_MATRIX. These are `mode:'matrix'` categories (catalog.js): the
    // subject/column list is a fixed catalog list, not per-order like
    // KLAS_MATRIX's own teacher-defined rows/columns, so there's no
    // rowsByBlock/columnsByBlock bookkeeping needed here at all — just one
    // matrixValues cell per (subject, column) pair, keyed by their own
    // literal text (matrixCellKey), the same key shape MP THP has always
    // used for a hand-filled block.
    if (parsed.categorized) {
      Object.entries(parsed.categorized).forEach(([catKey, sections]) => {
        // resolveCategory (not a raw CATEGORIES.find) also resolves a
        // renamed/duplicated template sheet's synthetic key — see
        // excelImport.js's dynamicCategoryKey / catalog.js's
        // makeDynamicCategoryKey.
        const cat = resolveCategory(catKey);
        if (!cat || sections.length === 0) return;
        // blocksCount is always 1 for these categories today — a file with
        // more than one independent section for the same sheet has nowhere
        // else to land the rest, same overflow story as KLAS_MATRIX's own
        // maxSections above.
        if (sections.length > (cat.blocksCount || 1)) {
          warnings.push({ type: 'truncated', text: `${cat.label}: this file has ${sections.length} sections, but only the first could be imported — please upload the rest separately.` });
        }
        const section = sections[0];
        const key = `${catKey}::0`;
        const newLineValues = { ...next[fields.lineValues] };
        const newMatrixValues = { ...next[fields.matrixValues] };
        const newRowsByBlock = { ...next[fields.rowsByBlock] };
        let nextRowId = next[fields.nextRowId];
        // Subject name -> the `custom-<id>` row it became (subjectsFromImport
        // branch below) — used to resolve a level-breakdown mismatch
        // question's "betulkan" fix to the exact matrix cell.
        let importedRowIdByName = null;
        // A fresh import fully replaces whatever was there before, same as
        // KLAS_MATRIX's own per-block clear above.
        Object.keys(newLineValues).forEach((k) => { if (k.startsWith(`${key}::`)) delete newLineValues[k]; });
        Object.keys(newMatrixValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete newMatrixValues[k]; });
        Object.keys(newRowsByBlock).forEach((k) => { if (k.startsWith(`${key}::`)) delete newRowsByBlock[k]; });

        // A renamed/duplicated PPKI/MP-THP-shaped sheet (excelImport.js's
        // dynamicCategoryKey, templateKind 'KLAS_MATRIX') needs the SAME
        // rows-as-subjects + columns-as-classes storage the KLAS_MATRIX
        // multi-section import above uses (mode: 'dynamicMatrix') — quite
        // unlike every branch below, which all populate either a FIXED
        // matrix (mode: 'matrix') or a plain row list (mode: 'list'), and
        // none of which ever touch columnsByBlock. Handled as its own
        // self-contained branch (via the shared populateMatrixSectionBlock
        // the KLAS_MATRIX loop above also uses) and returned early, rather
        // than threaded through the generic chain below.
        if (cat.mode === 'dynamicMatrix') {
          const newColumnsByBlockDyn = { ...next[fields.columnsByBlock] };
          Object.keys(newColumnsByBlockDyn).forEach((k) => { if (k.startsWith(`${key}::`)) delete newColumnsByBlockDyn[k]; });
          const newPlakRowsDyn = { ...next[fields.plakRows] };
          const defaultNamesDyn = getCategorySubjects(cat, next.schoolLanguage);
          const ids = { nextRowId, nextColumnId: next[fields.nextColumnId], nextPlakRowId: next[fields.nextPlakRowId] };
          const matchedPlak = populateMatrixSectionBlock(
            section, key, defaultNamesDyn, ids,
            { newLineValues, newMatrixValues, newRowsByBlock, newColumnsByBlock: newColumnsByBlockDyn, newPlakRows: newPlakRowsDyn },
            next.plakCatalog,
          );
          if (section.jenisPlak && !matchedPlak) {
            warnings.push({ type: 'plakMismatch', blockIdx: 0, catKey, text: `${cat.label}: couldn't match Jenis Plak "${section.jenisPlak}" to anything in the catalog — please choose it manually.` });
          }
          if (section.remarkNote) remarkNotes.push(section.remarkNote);
          if (applyFilter) applyFilter(catKey, key, { newLineValues, newMatrixValues, newRowsByBlock, newPlakRows: newPlakRowsDyn });
          next = {
            ...next,
            [fields.lineValues]: newLineValues, [fields.matrixValues]: newMatrixValues, [fields.rowsByBlock]: newRowsByBlock,
            [fields.columnsByBlock]: newColumnsByBlockDyn, [fields.plakRows]: newPlakRowsDyn,
            [fields.nextRowId]: ids.nextRowId, [fields.nextColumnId]: ids.nextColumnId, [fields.nextPlakRowId]: ids.nextPlakRowId,
            [fields.visibleBlocksByCategory]: { ...next[fields.visibleBlocksByCategory], [catKey]: 1 },
          };
          if (!landOn) landOn = catKey;
          messages.push(`${cat.label}: imported`);
          return;
        }

        if (section.isSimpleTahunList) {
          // LONJAKAN SAUJANA — TAHUN 1-6, each with its own QTY + Jenis Plak.
          const byTahun = new Map(section.tahunRows.filter((tr) => tr.tahun).map((tr) => [tr.tahun, tr]));
          // An un-matched Jenis Plak just leaves the row blank — the teacher
          // picks it here. NewOrderStep2's "can't add to cart" panel
          // (buildCategoryCartItems) names every such row, so no separate
          // import warning is raised.
          const fixedRows = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'].map((tahun) => {
            const tr = byTahun.get(tahun);
            const matched = tr?.jenisPlak ? matchJenisPlakPath(tr.jenisPlak, next.plakCatalog) : '';
            return { id: nextRowId++, desc: tahun, qty: tr && tr.qty ? String(tr.qty) : '', jenisPlak: matched };
          });
          // A row whose own label isn't a plain "TAHUN n" (e.g. "TAHAP 1",
          // "TAHAP 2") is an extra row the teacher added on the sheet, not a
          // same-numbered TAHUN slot — kept as its own row with that exact
          // wording instead of being folded into the fixed 6 above.
          const extraRows = section.tahunRows.filter((tr) => !tr.tahun).map((tr) => {
            const matched = tr.jenisPlak ? matchJenisPlakPath(tr.jenisPlak, next.plakCatalog) : '';
            return { id: nextRowId++, desc: tr.label, qty: tr.qty ? String(tr.qty) : '', jenisPlak: matched };
          });
          newRowsByBlock[key] = [...fixedRows, ...extraRows];
        } else if (section.isTokohList) {
          // TOKOH (excelImport.js's parseTokohAnugerahSheet) — one honour
          // per row, in sheet order (not a fixed preset). Each row keeps
          // its own NAMA MURID / GAMBAR / DESIGN metadata + its own Jenis
          // Plak (plakPerRow).
          newRowsByBlock[key] = section.tokohRows.map((tr) => {
            const matched = tr.jenisPlak ? matchJenisPlakPath(tr.jenisPlak, next.plakCatalog) : '';
            // Un-matched → blank, picked here; flagged by buildCategoryCartItems.
            return {
              id: nextRowId++, desc: tr.desc, qty: tr.qty ? String(tr.qty) : '',
              jenisPlak: matched, namaMurid: tr.namaMurid || '', gambar: tr.gambar || '', design: tr.design || '',
            };
          });
        } else if (section.isAliran || section.isAliranKelas) {
          // ALIRAN TERBAIK (excelImport.js's parseAliranSheet) — six fixed
          // TAHUN rows, each carrying a KEDUDUKAN "hingga" place or a flat
          // qty; plus a multi-row JENIS PLAK footer of position ranges.
          const byTahun = new Map(section.tahunRows.map((tr) => [tr.tahun, tr]));
          newRowsByBlock[key] = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'].map((tahun) => {
            const tr = byTahun.get(tahun);
            if (tr && tr.hingga) return { id: nextRowId++, desc: tahun, qty: String(tr.hingga - (tr.dari || 1) + 1), kedudukanHingga: tr.hingga };
            if (tr && tr.flatQty) return { id: nextRowId++, desc: tahun, qty: String(tr.flatQty), kedudukanHingga: 0 };
            return { id: nextRowId++, desc: tahun, qty: '', kedudukanHingga: 0 };
          });
          // "Kalau ada kelas" — each Tahun's own Nama Kelas list, stored the
          // same way PPKI/PBD's level breakdown is (`${key}::${tahun}::main`),
          // so computeBlocks / draftUpdaters can show and re-sum it.
          (section.levelBreakdown || []).forEach(({ label, mainRows }) => {
            newRowsByBlock[`${key}::${label}::main`] = mainRows.map((r) => ({ id: nextRowId++, desc: r.name, qty: String(r.qty) }));
          });
          // A Tahun whose typed TOTAL disagrees with its own Nama Kelas sum
          // — almost always a wrong headcount. Surfaced as a Step-2
          // question; the website always uses the class-sum figure
          // regardless of the answer.
          if (section.isAliranKelas) {
            checkAliranKelasTotals(section).forEach((iss) => {
              warnings.push({
                type: 'choice',
                id: `${catKey}::${iss.id}`,
                blockIdx: 0,
                catKey,
                text: `${cat.label} · ${iss.level}: TOTAL dalam fail ialah ${iss.stated}, tapi ikut senarai Nama Kelas (${iss.classSum} murid) sepatutnya ${iss.computed}. Sila semak bilangan murid.`,
                options: [{ key: 'keep', label: 'OK, saya semak' }],
                addPatches: [],
              });
            });
          }
        } else if (section.isSelempangList) {
          // SELEMPANG (excelImport.js's parseSelempangSheet) — plain
          // ACARA / WARNA / KUANTITI rows. computeBlocks re-resolves the
          // colour text, so only the raw values are stored here.
          newRowsByBlock[key] = (section.selempangRows || []).map((sr) => ({
            id: nextRowId++, acara: sr.acara || '', warna: sr.warna || '', qty: sr.qty ? String(sr.qty) : '',
          }));
          if (newRowsByBlock[key].length === 0) newRowsByBlock[key] = [{ id: nextRowId++, acara: '', warna: '', qty: '' }];
        } else if (section.isTahunList) {
          // PBD (excelImport.js's parsePbdSheet) — no subject axis, one
          // KUANTITI total per Tahun. The category is a 1-column matrix
          // whose "subject" rows ARE the Tahuns, kept as editable
          // `custom-<id>` rows built from the sheet's own labels (which can
          // carry a qualifier like "PKB", or be an added row) — same as
          // PPKI/MP THP's subjects. The single column is "KUANTITI".
          importedRowIdByName = new Map();
          (section.subjectOrder || section.tahunRows.map((tr) => tr.tahun)).forEach((label) => {
            if (!label || importedRowIdByName.has(label)) return;
            const rowId = nextRowId++;
            importedRowIdByName.set(label, rowId);
            newMatrixValues[customMatrixLabelKey(catKey, rowId)] = label;
          });
          section.tahunRows.forEach(({ tahun, qty }) => {
            const rowId = importedRowIdByName.get(tahun);
            if (rowId == null || !qty) return;
            newMatrixValues[matrixCellKey(catKey, `custom-${rowId}`, 'KUANTITI')] = String(qty);
          });
        } else if (cat.subjectsFromImport && section.subjectOrder) {
          // PPKI / MP THP 1 / MP THP 2 (+ variants): the subject list is
          // whatever the sheet has — renamed, added or blank rows and all —
          // so every subject becomes an editable `custom-<id>` matrix row
          // (getCustomMatrixRowIds), in sheet order, rather than being
          // matched against the fixed catalog list. The column labels are
          // still the fixed catalog ones (PRA PPKI/PPKI/PRASEKOLAH, TAHUN N).
          const qtyByColThenName = new Map();
          section.classes.forEach((cls) => {
            const column = cls.namaKelas || cls.tahunFrom;
            if (!column) return;
            const byName = qtyByColThenName.get(column) || new Map();
            cls.subjects.forEach(({ name, qty }) => { if (name) byName.set(name, qty); });
            qtyByColThenName.set(column, byName);
          });
          importedRowIdByName = new Map();
          section.subjectOrder.forEach((name) => {
            if (!name) return;
            const rowId = nextRowId++;
            if (!importedRowIdByName.has(name)) importedRowIdByName.set(name, rowId);
            newMatrixValues[customMatrixLabelKey(catKey, rowId)] = name;
            qtyByColThenName.forEach((byName, column) => {
              const qty = byName.get(name);
              if (qty) newMatrixValues[matrixCellKey(catKey, `custom-${rowId}`, column)] = String(qty);
            });
          });
        } else {
          section.classes.forEach((cls) => {
            // PPKI's classes carry their level in `namaKelas` (PRA PPKI/PPKI/
            // PRASEKOLAH — free text, not a real TAHUN), MP THP 1's in
            // `tahunFrom` (TAHUN 1/2/3) — either way this must exactly match
            // one of the category's own fixed columnsByLanguage labels.
            const column = cls.namaKelas || cls.tahunFrom;
            if (!column) return;
            cls.subjects.forEach(({ name, qty }) => {
              if (!name || !qty) return;
              newMatrixValues[matrixCellKey(catKey, name, column)] = String(qty);
            });
          });
        }
        // PPKI's own Nama Kelas + Moral Kelas breakdown behind those KUANTITI
        // totals (catalog.js's hasLevelBreakdown, excelImport.js's
        // parsePpkiSheet) — stored per level under its own composite
        // rowsByBlock key so computeBlocks.js/draftUpdaters.js can show and
        // re-sum it independently of the other levels.
        if (cat.hasLevelBreakdown && section.levelBreakdown) {
          section.levelBreakdown.forEach(({ label, mainRows, moralRows }) => {
            newRowsByBlock[`${key}::${label}::main`] = mainRows.map((r) => ({ id: nextRowId++, desc: r.name, qty: String(r.qty) }));
            newRowsByBlock[`${key}::${label}::moral`] = moralRows.map((r) => ({ id: nextRowId++, desc: r.name, qty: String(r.qty) }));
          });

          // A subject whose imported KUANTITI for a level doesn't match that
          // level's own Nama Kelas breakdown total (every subject offered at
          // a level takes that same total — see importChecks.js) becomes a
          // `type:'choice'` question on Step 2. "Betulkan" writes the level
          // total straight into that one cell; "Betul" just acknowledges.
          checkLevelBreakdownMatch(section).forEach((iss) => {
            const rowId = importedRowIdByName ? importedRowIdByName.get(iss.subject) : null;
            const fixPatches = rowId != null
              ? [{ mkey: matrixCellKey(catKey, `custom-${rowId}`, iss.level), value: String(iss.expected) }]
              : [];
            const options = [];
            if (fixPatches.length > 0) {
              options.push({ key: 'fix', label: `Salah taip — betulkan jadi ${iss.expected}` });
            }
            options.push({ key: 'keep', label: 'Betul — memang lain, biar macam ni' });
            warnings.push({
              type: 'choice',
              id: `${catKey}::${iss.id}`,
              blockIdx: 0,
              catKey,
              text: `${cat.label} · ${iss.subject} — ${iss.level}: awak isi ${iss.qty}, tapi ikut senarai Nama Kelas ${iss.level} (${iss.classCount} kelas) sepatutnya ${iss.expected}.`,
              options,
              addPatches: fixPatches,
            });
          });
        }
        const sectionLines = section.skipLineDerivation ? section.lines : deriveKlasMatrixSectionLines(section);
        Object.entries(sectionLines).forEach(([slot, val]) => { newLineValues[`${key}::${slot}`] = val; });

        let nextPlakRowId = next[fields.nextPlakRowId];
        let newPlakRows;
        if (section.isSimpleTahunList || section.isTokohList || section.isSelempangList) {
          // LONJAKAN / TOKOH — Jenis Plak lives per row (plakPerRow); SELEMPANG
          // has one implicit shared code. Either way, no block-level plak row.
          newPlakRows = { ...next[fields.plakRows], [key]: [] };
        } else if (section.isAliran || section.isAliranKelas) {
          // One plak row per JENIS PLAK footer entry, each carrying its own
          // position range (posDari/posHingga). QTY per row is derived later
          // (computeBlocks.js) UNLESS the sheet typed its own — then that's
          // carried as an override. An un-matched code is left blank and
          // flagged, same as everywhere else.
          // The sheet's own footer QTY is only pinned as an override when it
          // DIFFERS from what the position-range × ranked-TAHUNs math derives
          // — a matching number stays null (reactive) so later TAHUN edits
          // still reflow it. `flatTotal` covers a rangeless (flat) footer row.
          const flatTotal = (section.tahunRows || []).reduce((s, tr) => s + (tr.hingga ? 0 : (tr.flatQty || 0)), 0);
          const derivedFor = (dari, hingga) => {
            if (!dari) return flatTotal;
            return (section.tahunRows || []).reduce((s, tr) => (
              s + (tr.hingga ? Math.max(0, Math.min(hingga || dari, tr.hingga) - dari + 1) : 0)
            ), 0);
          };
          const aliranRows = (section.plakRanges || []).map((pr) => {
            // Un-matched → blank, picked here; flagged by buildCategoryCartItems.
            const matched = matchJenisPlakPath(pr.jenisPlak, next.plakCatalog);
            // "Kalau ada kelas" footer QTY is always derived (Nama Kelas ×
            // range), never a teacher override — the sheet's own number, if
            // any, is just the school's arithmetic, not a real override.
            const override = !section.isAliranKelas && pr.qty && pr.qty !== derivedFor(pr.dari || null, pr.hingga || null) ? pr.qty : null;
            return { id: nextPlakRowId++, jenisPlak: matched, posDari: pr.dari || null, posHingga: pr.hingga || null, qty: override };
          });
          // Any TAHUN with no KEDUDUKAN (a flat "ikut sample" count) needs
          // its own Jenis Plak row with no position range — seed a blank one
          // if the sheet didn't already give a rangeless footer entry, so the
          // teacher just has to pick the plak instead of remembering to add
          // the row (its qty derives from those flat TAHUNs' totals). For
          // "Kalau ada kelas" a flat TAHUN is one with a Nama Kelas list but
          // no KEDUDUKAN range.
          const rangedTahuns = new Set((section.tahunRows || []).filter((tr) => tr.hingga).map((tr) => tr.tahun));
          const hasFlatTahun = (section.tahunRows || []).some((tr) => !tr.hingga && (tr.flatQty || 0) > 0)
            || (section.isAliranKelas && (section.levelBreakdown || []).some((lb) => lb.mainRows.length > 0 && !rangedTahuns.has(lb.label)));
          const hasRangelessRow = aliranRows.some((r) => !r.posDari);
          if (hasFlatTahun && !hasRangelessRow) {
            aliranRows.push({ id: nextPlakRowId++, jenisPlak: '', posDari: null, posHingga: null, qty: null });
          }
          if (aliranRows.length === 0) aliranRows.push({ id: nextPlakRowId++, jenisPlak: '', posDari: 1, posHingga: null, qty: null });
          newPlakRows = { ...next[fields.plakRows], [key]: aliranRows };
        } else {
          // Un-matched → blank, picked here; flagged by buildCategoryCartItems.
          const matchedPlak = matchJenisPlakPath(section.jenisPlak, next.plakCatalog);
          newPlakRows = { ...next[fields.plakRows], [key]: [{ id: nextPlakRowId++, jenisPlak: matchedPlak }] };
        }
        if (applyFilter) applyFilter(catKey, key, { newLineValues, newMatrixValues, newRowsByBlock, newPlakRows });
        next = {
          ...next,
          [fields.lineValues]: newLineValues, [fields.matrixValues]: newMatrixValues, [fields.rowsByBlock]: newRowsByBlock, [fields.plakRows]: newPlakRows,
          [fields.nextPlakRowId]: nextPlakRowId, [fields.nextRowId]: nextRowId,
          // Every category here is single-block, so nothing else ever needs
          // to read visibleBlocksByCategory for a FIXED key (a static
          // ACTIVE_CATEGORIES tab is always shown regardless). A dynamic
          // key has no such standing tab — this is the only signal
          // NewOrderStep2.jsx/AddOn.jsx have that it now exists in the
          // draft, so it's set only for those.
          ...(isDynamicCategoryKey(catKey) ? { [fields.visibleBlocksByCategory]: { ...next[fields.visibleBlocksByCategory], [catKey]: 1 } } : {}),
        };
        if (!landOn) landOn = catKey;
        messages.push(`${cat.label}: imported`);
      });
    }

    // A sheet that had something typed into it but matched no recognized
    // format at all (excelImport.js's unrecognizedSheets) — surfaced so the
    // teacher/production knows to check it by hand, instead of that data
    // silently not appearing anywhere.
    if (parsed.unrecognizedSheets?.length) {
      parsed.unrecognizedSheets.forEach((name) => {
        warnings.push({ type: 'truncated', text: `Couldn't recognize the format of sheet "${name}" — please check it and add its data by hand if needed.` });
      });
    }

    // A KIV line (excelImport.js's findKivNotes) has no recipient data at
    // all yet, so it never becomes a KLAS_MATRIX section the teacher could
    // review — it only reaches Sales/Invoicing/Production at all if it
    // lands somewhere they actually look. Appended (never replacing)
    // whatever Remark text is already there, so a fresh import can't wipe
    // out a note the teacher already typed by hand.
    if (parsed.kivNotes?.length) {
      parsed.kivNotes.forEach((n) => remarkNotes.push(`${n.desc}${n.qty ? ` — ${n.qty} ORANG` : ''} — KIV (belum ada nama, jangan cetak buat masa ini)`));
    }
    // No AddOn-side equivalent (fields.remark undefined there) — AddOn
    // uploads simply don't surface KIV/PERASMI notes anywhere, rather than
    // building new addOnRemark plumbing nothing else in that flow reads.
    if (fields.remark && remarkNotes.length > 0) {
      next = { ...next, [fields.remark]: next[fields.remark] ? `${next[fields.remark]}\n${remarkNotes.join('\n')}` : remarkNotes.join('\n') };
      messages.push(`${remarkNotes.length} note(s) added to Remark`);
    }

    const finalState = { ...next, [fields.category]: landOn || next[fields.category] };
    setState(finalState);

    // Keep the raw upload as a backup on the order — Production / Store
    // Admin / Admin download it to cross-check the order details (0055).
    // Fire-and-forget: a failure here just means no backup file, the import
    // already succeeded. Replaces a file from an earlier import in the same
    // draft. No AddOn-side equivalent (fields.importFilePath undefined
    // there) — skipped entirely for that flow.
    if (fields.importFilePath) {
      const prevImportPath = st[fields.importFilePath];
      uploadOrderImportFile(file).then((res) => {
        if (res) {
          patch({ [fields.importFilePath]: res.path, [fields.importFileName]: res.name });
          if (prevImportPath && prevImportPath !== res.path) removeOrderImportFile(prevImportPath);
        }
      });
    }

    // `draft` is the actual just-committed state, for a caller that needs
    // it back synchronously instead of waiting for a re-render to read it
    // off `state`/`stateRef` — `setState` above won't have been applied by
    // the time an `await`-continuation right after this resolves (that
    // race is exactly what silently emptied every category the very first
    // time parseCorrectedExcelIntoItems read stateRef.current here).
    return { ok: true, message: `Imported — ${messages.join('; ')}. Please review carefully before adding to cart.`, warnings, draft: finalState };
  }, [patch]);

  // Thin, zero-behavior-change wrapper for the existing New Order call site
  // (NewOrderStep2.jsx) — always imports into the New Order draft namespace,
  // full import, no diff filter.
  const importFormAnugerahExcel = useCallback(
    (file) => importFormAnugerahExcelInto(file, NEW_ORDER_IMPORT_FIELDS),
    [importFormAnugerahExcelInto],
  );

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
    patch((st) => {
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
  const submitOrder = useCallback(async () => {
    const st = stateRef.current;
    const selectedSalesman = st.assignedSalesmen.find((s) => s.id === st.selectedSalesmanId);
    // The backend (supabase/migrations/0025_allow_multiple_salesmen_per_school.sql)
    // rejects any insert without a salesman_id in the school's current
    // assignment set — this check just avoids burning an order number (see
    // next_order_seq below) on a submission that can never succeed, and
    // gives a clearer message than a raw RLS-violation error would.
    if (!selectedSalesman) {
      patch({ cartToast: st.assignedSalesmen.length === 0 ? 'Your school has not been assigned to a salesman yet. Please contact the administrator.' : 'Please select which salesman this order is for.' });
      return null;
    }
    // One continuous sequence, no year in the id — ORD-0001, ORD-0002, …
    const prefix = 'ORD-';
    let seq;
    try {
      seq = await nextOrderSeq(prefix, 1);
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
    };
    const newOrder = {
      id: newId, invoiceId: null, datePlaced: formatDate(TODAY), deliveryDate: 'TBD',
      totalAmount: totalAmt, status: 'Submitted to Sales', priceAdjusted: false,
      createdBy: st.userAuthId,
      salesmanId: selectedSalesman.id,
      sekolah: st.sekolah, schoolLanguage: st.schoolLanguage, sales: selectedSalesman.name, picName: st.picName, phone: st.phone, ketuaPanitia: st.ketuaPanitia, terms: st.terms, remark: st.remark,
      shipmentDate: st.shipmentDateSelected, functionDate: st.funcSelected,
      logoDataUrl: st.logoDataUrl, logoFileName: st.logoFileName, logoRemark: st.logoRemark, schoolType: st.schoolType,
      importFilePath: st.importFilePath, importFileName: st.importFileName,
      snapshot, items: st.cart.map((ci) => ({ ...ci })),
    };

    // Deducted before the insert so a stock failure never creates an order
    // with items it can't actually fulfil. If the insert itself then fails
    // for some other reason, the deduction is compensated (added back)
    // rather than left silently stuck against a school that never got an
    // order — see the catch block below.
    try {
      await deductPlakStock(st.cart.map((ci) => ({ full_path: ci.jenisPlak, qty: ci.qty })));
    } catch (err) {
      console.error('Stock deduction failed for New Order:', err);
      patch({ cartToast: describeStockError(err) });
      return null;
    }

    try {
      await insertOrder(newOrder);
    } catch (err) {
      console.error('Failed to save order to Supabase:', err);
      restorePlakStock(st.cart.map((ci) => ({ full_path: ci.jenisPlak, qty: ci.qty })))
        .catch((restoreErr) => console.error('Failed to restore stock after a failed order insert:', restoreErr));
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
    patch((latest) => ({ lastOrderId: newId, orders: [newOrder, ...latest.orders], cart: [], cartToast: '' }));
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
      importFilePath: null, importFileName: null,
      stepError: '',

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

  // Teacher editing under "Submitted to Sales" — restored 2026-08-25 after
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
  // Only reachable while status is 'Submitted to Sales' (Dashboard.jsx's
  // canAmend gate), so every item is still batch 0 — nothing here needs to
  // handle an already-approved Tambahan round.
  const updateAmend = useCallback(async () => {
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === st.amendOrderId);
    if (!order) return { ok: false, message: 'Order not found.' };
    const originalById = new Map((order.items || []).map((it) => [it.id, it]));
    const categoriesUsed = categoriesUsedByItems(order.items);
    const newItems = [];
    categoriesUsed.forEach((cat) => {
      const { blocks, isMatrix, isDynamicMatrix } = computeBlocks(
        cat.key, st.amendLineValues, st.amendMatrixValues, st.amendRowsByBlock, st.amendPlakRows, st.amendColumnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage,
      );
      const visibleCount = st.amendVisibleBlocksByCategory[cat.key] || 1;
      blocks.slice(0, visibleCount).forEach((blk) => {
        // SELEMPANG has no plak rows — one combined item, its acara/warna
        // rows carried in `detail.rows`. Amend only lets the teacher change
        // KUANTITI (EDITABLE.rowDesc is false), so warna stays valid.
        if (cat.selempang) {
          const prior = (order.items || []).find((it) => it.categoryKey === cat.key);
          const rows = (blk.rows || []).filter((r) => Number(r.qty) > 0 && r.warnaResolved && (r.acara || '').trim());
          if (rows.length === 0) return;
          const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
          const unitPrice = blk.selempangUnitPrice;
          newItems.push({
            id: prior?.id || crypto.randomUUID(),
            jenisPlak: SELEMPANG_CODE, qty: totalQty, unitPrice, harga: unitPrice * totalQty,
            categoryLabel: cat.label, categoryKey: cat.key, blockIdx: blk.idx,
            detail: { rows: rows.map((r) => ({ id: r.id, acara: r.acara.trim(), warna: r.warnaResolved.warna, warnaCode: r.warnaResolved.code, qty: String(r.qty) })) },
            ...(prior?.batch ? { batch: prior.batch } : {}),
          });
          return;
        }
        blk.plakRows.forEach((pr) => {
          if (!pr.jenisPlak || !pr.qty) return;
          const prior = originalById.get(pr.id);
          newItems.push({
            id: pr.id, jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice,
            categoryLabel: blk.qtyLabel, categoryKey: cat.key, blockIdx: blk.idx,
            detail: snapshotDetail(cat.key, blk.idx, isMatrix, isDynamicMatrix, st.amendLineValues, st.amendMatrixValues, st.amendRowsByBlock, st.amendColumnsByBlock),
            ...(prior?.batch ? { batch: prior.batch } : {}),
            ...(prior?.originalUnitPrice != null ? { originalUnitPrice: prior.originalUnitPrice } : {}),
          });
        });
      });
    });
    const amendedTotal = newItems.reduce((sum, it) => sum + it.harga, 0);
    try {
      await updateOrder(st.amendOrderId, { items: newItems, totalAmount: amendedTotal });
    } catch (err) {
      console.error('Failed to save amend to Supabase:', err);
      flashToast('updateToast', describeOrderWriteError(err, 'update'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === st.amendOrderId ? { ...o, items: newItems, totalAmount: amendedTotal } : o)),
    }));
    flashToast('updateToast', 'Update successful.');
    return { ok: true };
  }, [patch, flashToast]);

  const openAddOn = useCallback((ord) => {
    patch((st) => ({
      addOnOrderId: ord.id, addOnCategory: null,
      addOnLineValues: {}, addOnMatrixValues: {},
      addOnRowsByBlock: buildInitialRowsByBlock(st.schoolLanguage), addOnColumnsByBlock: buildInitialColumnsByBlock(), addOnPlakRows: buildInitialPlakRows(),
      addOnNextRowId: 1000, addOnNextPlakRowId: 1000, addOnNextColumnId: 1000, addOnVisibleBlocksByCategory: {},
    }));
  }, [patch]);

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
  const submitPendingAddOn = useCallback(async () => {
    const st = stateRef.current;
    const newItems = [];
    const addOnOrder = st.orders.find((o) => o.id === st.addOnOrderId);
    // A renamed/duplicated template sheet from the original order's own
    // import has no entry in the static CATEGORIES list at all — without
    // this, anything the teacher typed into that tab (AddOn.jsx's own
    // allCategories) would be silently dropped here instead of submitted.
    const dynamicCats = addOnOrder ? categoriesUsedByItems(addOnOrder.items).filter((c) => isDynamicCategoryKey(c.key)) : [];
    // Every category (including PBD/ALIRAN, split into their own
    // top-level entries — see catalog.js) has exactly one block, so this
    // naturally picks up whichever categories/blocks actually have data
    // in the draft regardless of which category tab the teacher currently
    // has open — no per-variant block-index bookkeeping needed here.
    [...CATEGORIES, ...dynamicCats].forEach((cat) => {
      // SELEMPANG builds one combined item (acara/warna rows in detail.rows)
      // — buildCategoryCartItems already knows its shape and validation.
      if (cat.selempang) {
        const res = buildCategoryCartItems({
          lineValues: st.addOnLineValues, matrixValues: st.addOnMatrixValues, rowsByBlock: st.addOnRowsByBlock,
          plakRows: st.addOnPlakRows, columnsByBlock: st.addOnColumnsByBlock,
          plakCatalog: st.plakCatalog, schoolLanguage: st.schoolLanguage,
        }, cat.key);
        if (res.items) newItems.push(...res.items);
        return;
      }
      const { blocks: catBlocks, isMatrix: catIsMatrix, isDynamicMatrix: catIsDynamicMatrix } = computeBlocks(
        cat.key, st.addOnLineValues, st.addOnMatrixValues, st.addOnRowsByBlock, st.addOnPlakRows, st.addOnColumnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage,
      );
      catBlocks.forEach((blk) => {
        blk.plakRows.forEach((pr) => {
          if (pr.jenisPlak && pr.qty) newItems.push({
            id: crypto.randomUUID(), jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice, categoryLabel: blk.qtyLabel,
            categoryKey: cat.key, blockIdx: blk.idx,
            detail: snapshotDetail(cat.key, blk.idx, catIsMatrix, catIsDynamicMatrix, st.addOnLineValues, st.addOnMatrixValues, st.addOnRowsByBlock, st.addOnColumnsByBlock),
          });
        });
      });
    });
    if (newItems.length === 0) {
      flashToast('updateToast', 'No add-on items to submit.');
      return false;
    }

    const order = addOnOrder;
    // A still-'pending' add-on being overwritten by this fresh submission
    // already had its own stock deducted once (below, on its own earlier
    // call) — restore that first so resubmitting can never leave the
    // earlier batch's deduction stranded on top of the new one. A
    // 'rejected' add-on was already restored when it was rejected (see
    // rejectAddOn), so this only fires for 'pending'.
    if (order?.pendingAddonStatus === 'pending' && order.pendingAddonItems?.length) {
      try {
        await restorePlakStock(order.pendingAddonItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })));
      } catch (err) {
        console.error('Failed to restore stock for the add-on being replaced:', err);
      }
    }

    try {
      await deductPlakStock(newItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })));
    } catch (err) {
      console.error('Stock deduction failed for Add On:', err);
      flashToast('updateToast', describeStockError(err));
      return false;
    }

    try {
      await updateOrder(st.addOnOrderId, { pendingAddonItems: newItems, pendingAddonStatus: 'pending', pendingAddonRejectReason: null });
    } catch (err) {
      console.error('Failed to submit add-on to Supabase:', err);
      restorePlakStock(newItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })))
        .catch((restoreErr) => console.error('Failed to restore stock after a failed add-on submit:', restoreErr));
      flashToast('updateToast', `Could not submit the add-on: ${err.message || 'unknown error'}. Please try again.`);
      return false;
    }

    patch((latest) => ({
      orders: latest.orders.map((o) => (
        o.id === st.addOnOrderId ? { ...o, pendingAddonItems: newItems, pendingAddonStatus: 'pending', pendingAddonRejectReason: null } : o
      )),
    }));
    flashToast('updateToast', 'Add-on submitted — waiting for Sales approval.');
    return true;
  }, [patch, flashToast]);

  // Teacher withdraws a pending or rejected add-on before/without Sales
  // acting on it further — clears it back to no-add-on-in-flight. Awaits
  // the write and only updates local state on success; returns { ok }.
  const cancelPendingAddOn = useCallback(async (orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false };
    const fields = { pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null };
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
    if (order.pendingAddonStatus === 'pending' && order.pendingAddonItems?.length) {
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
    if (order.pendingAddonItems?.length) {
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

    const hadPendingAddon = order.pendingAddonStatus === 'pending' && order.pendingAddonItems?.length;
    const cancelFields = {
      status: 'Cancelled',
      cancelReason: (reason || '').trim() || null,
      cancelledAt: new Date().toISOString(),
      cancelledBy: st.userAuthId || null,
      ...(hadPendingAddon
        ? { pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null }
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

    // Stock restore is best-effort AFTER the cancel is committed. A failure
    // here leaves the order correctly cancelled but the stock not yet
    // credited back — surfaced clearly so an admin can restock by hand,
    // rather than silently swallowed.
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
      const built = buildCategoryCartItems(draft, catKey);
      if (built.items) items.push(...built.items);
      else if (built.error) warnings.push(`${resolveCategory(catKey)?.label || catKey}: ${built.error}`);
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
  const uploadCorrectedExcel = useCallback(async (orderId, file) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, message: 'Order not found.' };
    const uploaded = await uploadOrderImportFile(file);
    if (!uploaded) return { ok: false, message: 'Could not upload this file. Please try again.' };

    const res = await parseCorrectedExcelIntoItems(order, file);
    if (!res.ok) return res;

    const correctedFields = {
      correctedImportFilePath: uploaded.path, correctedImportFileName: uploaded.name,
      correctedImportUploadedAt: new Date().toISOString(),
    };
    try {
      await updateOrder(orderId, correctedFields);
    } catch (err) {
      console.error('Failed to save the corrected Excel on the order:', err);
      return { ok: false, message: describeOrderWriteError(err, 'save the corrected file for') };
    }
    patch((latest) => ({ orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...correctedFields } : o)) }));
    return res;
  }, [patch, parseCorrectedExcelIntoItems]);

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
    const nextBatch = order.items.reduce((max, it) => Math.max(max, it.batch || 0), 0) + 1;
    const batchedItems = withOriginalPrice.map((it) => ({ ...it, batch: nextBatch }));
    const combinedItems = [...order.items, ...batchedItems];
    // Recompute the whole total from combinedItems, not order.totalAmount +
    // delta — an incremental sum inherits any rounding drift the order
    // already carried and would then fail the server-side items<->total
    // check (orders_amount_guard, supabase/migrations/0041).
    const combinedTotal = combinedItems.reduce((sum, it) => sum + it.harga, 0);
    const priceAdjusted = order.priceAdjusted || batchedItems.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog));
    const fields = {
      items: combinedItems, totalAmount: combinedTotal, priceAdjusted,
      pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null,
    };
    try {
      await updateOrder(orderId, fields);
    } catch (err) {
      console.error('Failed to approve add-on in Supabase:', err);
      flashToast('updateToast', describeOrderWriteError(err, 'approve the add-on for'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
    }));
    flashToast('updateToast', 'Add-on approved and added to the order.');
    return { ok: true };
  }, [patch, flashToast]);

  // Sales approval: `updatedItems` carries each item's (possibly
  // Sales-negotiated) unitPrice and recalculated harga. priceAdjusted is
  // true whenever any item's unit price no longer matches the standard
  // catalog rate — that's the flag that turns the order's total red
  // downstream, so production knows to double-check it against the catalog.
  // Approving sends the order straight into production — there's no
  // separate "approved but not yet in production" holding stage.
  // `overrides` lets Sales adjust Shipment Date (shipmentDate) / Function Date (in addition to
  // per-item price, already folded into updatedItems) at the same moment
  // they approve — the only point before production where those dates are
  // still editable.
  const approveOrder = useCallback(async (orderId, updatedItems, overrides = {}) => {
    const st = stateRef.current;
    const priorOrder = st.orders.find((o) => o.id === orderId);
    if (!priorOrder) return { ok: false, message: 'Order not found.' };
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
    const urgent = overrides.shipmentDate ? isUrgentShipment(TODAY, overrides.shipmentDate) : priorOrder.urgent;
    const fields = { items: itemsWithOriginalPrice, totalAmount, priceAdjusted, status: 'In Production', ...overrides, urgent };
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
    return { ok: true };
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
  const attemptUrgentSheetSync = useCallback(async (order, fields) => {
    const payload = {
      orderId: order.id,
      invoiceId: fields.invoiceId ?? order.invoiceId,
      amount: fields.totalAmount ?? order.totalAmount,
      salesman: order.sales,
      school: order.sekolah,
      shipmentDate: fields.shipmentDate ?? order.shipmentDate,
      functionDate: fields.functionDate ?? order.functionDate,
      datePlaced: order.datePlaced,
    };
    try {
      await syncUrgentOrderToSheet(payload);
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

  const retryUrgentSheetSync = useCallback((orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (order) attemptUrgentSheetSync(order, {});
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
    if (!order || order.status !== 'In Production') {
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
    const isDuplicate = st.orders.some((o) => (
      o.id !== orderId && o.invoiceId && o.invoiceId.replace(/\s+/g, '') === normalized
    ));
    if (isDuplicate) {
      flashToast('productionToast', 'Invoice ID invalid because repeated, please try again.');
      return { ok: false };
    }
    try {
      await updateOrder(orderId, { invoiceId: normalized });
    } catch (err) {
      console.error('Failed to save invoice ID to Supabase:', err);
      flashToast('productionToast', describeOrderWriteError(err, 'save the invoice number for'));
      return { ok: false };
    }
    patch((latest) => ({
      orders: latest.orders.map((o) => (o.id === orderId ? { ...o, invoiceId: normalized } : o)),
    }));
    flashToast('productionToast', 'Invoice ID saved — order is ready for export.');
    // `urgent` was already snapshotted earlier by approveOrder/
    // approveAndSetInvoiceId — this is just the OTHER place an Invoice
    // Number can land, so it's the other trigger point for the one-time
    // Sheets sync. Fire-and-forget: never blocks/undoes the invoice save
    // above, which already succeeded.
    if (order.urgent && !order.urgentSheetSyncedAt) {
      attemptUrgentSheetSync(order, { invoiceId: normalized });
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
  const setJenisPlakInvoiceGroup = useCallback(async (orderId, invoiceId, jenisPlakList) => {
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
    const isDuplicate = normalized !== (order.invoiceId || '').replace(/\s+/g, '')
      && st.orders.some((o) => (
        o.id !== orderId && o.invoiceId && o.invoiceId.replace(/\s+/g, '') === normalized
      ));
    if (isDuplicate) {
      flashToast('updateToast', 'Invoice ID invalid because repeated, please try again.');
      return { ok: false };
    }
    const withoutKeys = (order.invoiceGroups || [])
      .map((g) => ({ ...g, jenisPlakList: (g.jenisPlakList || []).filter((k) => !keys.includes(k)) }))
      .filter((g) => g.jenisPlakList.length > 0);
    // Assigning back to the order's own (default) invoice number just
    // removes the exception entirely — no group needed to say "use the
    // default", that's already what an absent entry means.
    const newGroups = normalized === (order.invoiceId || '').replace(/\s+/g, '')
      ? withoutKeys
      : (() => {
        const existing = withoutKeys.find((g) => g.invoiceId.replace(/\s+/g, '') === normalized);
        if (existing) {
          return withoutKeys.map((g) => (g === existing ? { ...g, jenisPlakList: [...g.jenisPlakList, ...keys] } : g));
        }
        return [...withoutKeys, { invoiceId: normalized, jenisPlakList: keys }];
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

  // Store Admin: approves a still-"Submitted to Sales" order and
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
  const approveAndSetInvoiceId = useCallback(async (orderId, updatedItems, invoiceId, overrides = {}) => {
    const normalized = (invoiceId || '').replace(/\s+/g, '');
    const st = stateRef.current;
    const order = st.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'Submitted to Sales') {
      flashToast('productionToast', 'This order is not awaiting approval.');
      return { ok: false };
    }
    if (!normalized) {
      flashToast('productionToast', 'Enter a valid Invoice ID.');
      return { ok: false };
    }
    const isDuplicate = st.orders.some((o) => (
      o.id !== orderId && o.invoiceId && o.invoiceId.replace(/\s+/g, '') === normalized
    ));
    if (isDuplicate) {
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
    // Shipment Date is first set right here too (same as approveOrder) —
    // see urgentOrder.js. overrides.shipmentDate is placed after ...overrides
    // and urgent placed after that, so urgent stays authoritative.
    const urgent = overrides.shipmentDate ? isUrgentShipment(TODAY, overrides.shipmentDate) : order.urgent;
    const fields = {
      items: itemsWithOriginalPrice, totalAmount, priceAdjusted, status: 'In Production', invoiceId: normalized, ...overrides, urgent,
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
    flashToast('productionToast', 'Order approved and Invoice Number saved.');
    // Invoice Number and `urgent` both land in this same write — this is
    // the other trigger point for the one-time Sheets sync (setInvoiceId
    // above is the other). Fire-and-forget, same reasoning as there.
    if (urgent && !order.urgentSheetSyncedAt) {
      attemptUrgentSheetSync({ ...order, ...fields }, fields);
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

  // Production: signals the order is physically finished and handed off to
  // delivery. Only offered once an invoice ID is on record (production's own
  // dashboard groups orders into "Pending Invoice" vs "Ready for Export" —
  // this button lives in the latter, see src/pages/ProductionDashboard.jsx).
  // Unlike setInvoiceId/approveOrder above (which update local state
  // immediately and let the Supabase write fail silently in the
  // background), this awaits the write first — a failed status change here
  // must never show "Waiting for Delivery" locally when the database still
  // says otherwise — and surfaces success/failure via the same
  // `productionToast` the rest of this page's actions already use.
  const markProductionDone = useCallback(async (orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'In Production') {
      patch({ productionToast: 'This order is not ready to be marked done.' });
    } else if (!order.invoiceId) {
      patch({ productionToast: 'Waiting for Store Admin to assign an Invoice Number before this can be marked done.' });
    } else {
      // Status isn't always 'Waiting for Delivery': if this order's Shipment
      // Date has already arrived (or passed) by the time Production finishes,
      // the calendar rule sends it straight to 'Shipped' / 'Completed', the
      // same as the daily sweep_shipped_orders job would on its next run.
      const nextStatus = deliveryStageForShipmentDate(order.shipmentDate, TODAY);
      const toastForStatus = {
        'Waiting for Delivery': 'Production completed. Order is now waiting for delivery.',
        Shipped: 'Production completed. Shipment Date has arrived — order is now Shipped.',
        Completed: 'Production completed. Shipment Date has passed — order is now Completed.',
      };
      try {
        await updateOrder(orderId, { status: nextStatus });
        patch((st) => ({
          orders: st.orders.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)),
          productionToast: toastForStatus[nextStatus],
        }));
      } catch (err) {
        console.error('Failed to mark order done in Supabase:', err);
        patch({ productionToast: 'Unable to update order status. Please try again.' });
      }
    }
    clearTimeout(productionToastTimer.current);
    productionToastTimer.current = setTimeout(() => patch({ productionToast: '' }), 2500);
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

  // Sets a leaf's current stock count — also resets stock_baseline to the
  // same value (see updatePlakNodeStock), so every time Production/Admin
  // types a new number here (first count, restock, or correction) the
  // 15%/25% thresholds recalibrate against it rather than staying pinned
  // to whatever was entered before. `stockGroupKey` routes the write to the
  // shared plak_stock_groups row instead of the node's own columns when
  // this node is linked to one (see linkCatalogNodeStockGroup below).
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
  const setCatalogNodeHidden = useCallback(async (id, hidden) => {
    try {
      await updatePlakNode(id, { hidden });
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
    resetCurrentCategory, startNewOrder, addToCart, addAllToCart, removeFromCart, editCartCategory, submitOrder, reorderOrder,
    importFormAnugerahExcel, importFormAnugerahExcelInto,
    openAmend, updateAmend,
    openAddOn, submitPendingAddOn, cancelPendingAddOn, rejectAddOn, approveAddOn, approveOrder, setInvoiceId, approveAndSetInvoiceId,
    setJenisPlakInvoiceGroup,
    retryUrgentSheetSync,
    cancelOrder,
    reassignSalesman,
    uploadCorrectedExcel, loadCorrectedExcelPreview,
    recordPrint,
    ensureOrderLoaded,
    markProductionDone,
    addCatalogNode, removeCatalogNode, updateCatalogNodePrice, renameCatalogNode, updateCatalogNodeStock, setCatalogNodeHidden, moveCatalogNode,
    linkCatalogNodeStockGroup, unlinkCatalogNodeStockGroup,
    reorderCatalogSiblings,
    refreshAssignedSalesman,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
