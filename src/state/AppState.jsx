import { useState, useCallback, useRef, useEffect } from 'react';
import { CATEGORIES, formatDate, standardUnitPrice, getCategorySubjects } from '../data/catalog';
import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';
import {
  computeBlocks, snapshotDetail, noopUpdaters, buildDraftFromOrder,
} from '../utils/computeBlocks';
import { parseFormAnugerahExcel, matchJenisPlakPath } from '../utils/excelImport';
import { parseWordingDocx } from '../utils/docxImport';
import { checkColumnTotals, checkExpansionTotals } from '../utils/importChecks';
import { aiResultToParsed, importLooksThin } from '../utils/aiImportMap';
import { renderSheetsText, uploadOrderFile, runAiExtraction } from '../lib/importApi';

const AI_IMPORT_ENABLED = import.meta.env.VITE_AI_IMPORT_ENABLED === 'true';
import { AppStateContext } from './AppStateContext';
import {
  fetchOrders, fetchOrderById, insertOrder, updateOrder, nextOrderSeq, fetchAllSalesmen,
} from '../lib/ordersApi';
import {
  fetchPlakCatalog, addPlakNode, removePlakNode, updatePlakNode, updatePlakNodeOrder, updatePlakNodeStock,
  deductPlakStock, restorePlakStock,
} from '../lib/catalogAdminApi';
import { supabase } from '../lib/supabaseClient';

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

// A section imported into KLAS_MATRIX (from either excelImport.js or
// docxImport.js) rarely carries real Reference Sample text for TAHUN
// (slot '3') or SUBJEK/POSITION (slot '2b') — those two lines only exist
// on the plaque to show an EXAMPLE of this section's own class/subject
// breakdown, and the source document's own "TAHUN 1 UTHMAN" / "TEMPAT
// PERTAMA"-style text lives in the parsed class/subject data, not in a
// literal Reference Sample line anywhere. Filling them in from the
// section's own first class/subject — never overwriting real text a
// source document DID supply — turns the live preview from a wall of grey
// placeholder text into an actual worked example, matching what the
// teacher's own paper order already shows. YEAR ('1')/ACARA ('2') are
// hidden (not just left blank) whenever nothing filled them in either —
// otherwise every one of what can be a dozen+ imported sections would
// need the teacher to click ✕ on both, one by one. The visible order is
// also set to TAJUK BESAR / TAHUN / SUBJEK-POSITION — the order every one
// of these imported shapes' own paper sample actually uses — rather than
// the catalog's own YEAR/ACARA-first default order.
function deriveKlasMatrixSectionLines(section) {
  const lines = { ...section.lines };
  const firstClass = section.classes[0];
  if (firstClass) {
    if (!lines['3']) {
      const tahunText = [firstClass.tahunFrom, firstClass.namaKelas].filter(Boolean).join(' ').trim();
      if (tahunText) lines['3'] = tahunText;
    }
    if (!lines['2b']) {
      const firstSubject = firstClass.subjects.find((s) => s.name);
      if (firstSubject) lines['2b'] = firstSubject.name;
    }
  }
  const hidden = ['1', '2'].filter((slot) => !lines[slot]);
  if (hidden.length) lines.hiddenLines = hidden.join(',');
  lines.refOrder = '0,3,2b';
  return lines;
}

// Renders the file to text, uploads it for the audit trail (best-effort),
// calls the extract-order-file Edge Function, and maps a successful result
// into the same { klasMatrix: { sections } } shape the deterministic
// parsers return. Returns null on any failure — the caller then keeps the
// deterministic result. Never throws.
async function tryAiExtraction(file, buffer) {
  try {
    const sheetsText = await renderSheetsText(buffer, file.name);
    if (!sheetsText || !sheetsText.trim()) return null;
    let storagePath = null;
    try {
      ({ storagePath } = await uploadOrderFile(file, buffer));
    } catch (e) {
      console.warn('order-imports upload failed (continuing):', e);
    }
    const res = await runAiExtraction({ storagePath, fileName: file.name, sheetsText });
    if (res?.status === 'succeeded' && res.result) {
      return aiResultToParsed(res.result);
    }
    return null;
  } catch (e) {
    console.error('AI extraction failed:', e);
    return null;
  }
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
  const cat = CATEGORIES.find((c) => c.key === catKey);
  const lineValues = { ...st.lineValues };
  Object.keys(lineValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete lineValues[k]; });
  const matrixValues = { ...st.matrixValues };
  Object.keys(matrixValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete matrixValues[k]; });
  const rowsByBlock = { ...st.rowsByBlock };
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
    dueSelected: null,
    funcSelected: null,
    logoDataUrl: null,
    logoFileName: '',
    logoRemark: '',
    schoolType: null,
    stepError: '',

    category: 'TOKOH',
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

    plakCatalog: [],
    plakCatalogLoaded: false,

    draftRestoredToast: '',

    addOnOrderId: null,
    addOnCategory: 'TOKOH',
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
  };
}

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
            .select('role, sekolah, school_language, display_name, status')
            .eq('id', session.user.id)
            .single());
          if (profile || !profileError) break;
        }
        if (!cancelled && profile) {
          if (profile.status && profile.status !== 'active') {
            await supabase.auth.signOut();
            if (!cancelled) patch({ loginError: 'This account has been deactivated. Please contact your administrator.' });
          } else {
            patch({ role: profile.role, sekolah: profile.sekolah || '', schoolLanguage: profile.school_language || 'SK', userAuthId: session.user.id });
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
      .select('role, sekolah, school_language, display_name, status')
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
    patch({ role: profile.role, sekolah: profile.sekolah || '', schoolLanguage: profile.school_language || 'SK', userAuthId: data.user.id, loginError: '', userId: '', password: '' });
    return profile.role;
  }, [patch]);

  // A full reset, not a patch — logging out ends the session, so nothing
  // from the previous account (draft fields, cart, loaded orders) should
  // carry over to whoever logs in next on this browser tab. Also clears
  // the Supabase session itself (not just local state) — otherwise the
  // session-restore effect above would silently log the same account back
  // in on the next refresh.
  const logout = useCallback(() => {
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
      dueSelected: null, funcSelected: null,
      logoDataUrl: null, logoFileName: '', logoRemark: '', schoolType: null, stepError: '',

      category: 'TOKOH',
      lineValues: {}, matrixValues: {},
      rowsByBlock: buildInitialRowsByBlock(st.schoolLanguage), columnsByBlock: buildInitialColumnsByBlock(), plakRows: buildInitialPlakRows(),
      nextRowId: 1000, nextPlakRowId: 1000, nextColumnId: 1000, visibleBlocksByCategory: {},

      cart: [], cartToast: '',
    }));
  }, [patch]);

  const addToCart = useCallback(() => {
    setState((st) => {
      const { blocks, isMatrix, isDynamicMatrix } = computeBlocks(
        st.category, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.columnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage,
      );

      // Catches the two ways a category can be left half-finished — a
      // reference line (or the qty table / Jenis Plak) forgotten — before
      // it's silently either dropped or added without the info Production
      // needs. Checked across every block (OTHERS can have up to 6, one per
      // Tahun — see catalog.js's blocksCount), but only fires once a given
      // block has actually been touched (any line typed, any qty entered, or
      // a Jenis Plak chosen); an untouched block (every category but OTHERS
      // only ever has one) is just skipped, same as before.
      for (const blk of blocks) {
        const lineHasValue = (line) => Boolean(String(line.value).trim());
        // Line 1 (the event name) is always required; a category can mark
        // extra lines required too (`line.required` — see computeBlocks.js's
        // requiredLineIndices) — everything else (year, ACARA, position
        // CONTOH, etc.) is reference-sample context the teacher may not
        // always have yet, so it can stay blank.
        const hasQty = blk.blockTotalQty > 0;
        const hasJenisPlak = blk.plakRows.some((pr) => pr.jenisPlak);
        const engaged = hasQty || hasJenisPlak || blk.lines.some(lineHasValue);
        if (!engaged) continue;
        // hasNamaKelasList categories (OTHERS) can have several blocks
        // sharing the same qtyLabel — the Kuantiti TAHUN value, when set,
        // is included too so the toast actually says which Tahun part has
        // the problem instead of just repeating the category name.
        const blockLabel = blk.tahun?.value ? `${blk.qtyLabel} (${blk.tahun.value})` : blk.qtyLabel;
        const incompleteLine = blk.lines.find((line) => line.required && !lineHasValue(line));
        if (incompleteLine) {
          return { ...st, cartToast: `Please fill in line ${incompleteLine.num} for ${blockLabel} before adding to cart.` };
        }
        if (!hasQty) {
          return { ...st, cartToast: `Please enter a quantity for ${blockLabel} before adding to cart.` };
        }
        if (!hasJenisPlak) {
          return { ...st, cartToast: `Please choose a Jenis Plak for ${blockLabel} before adding to cart.` };
        }
        // A Tahun range spanning N years needs at least N medals per
        // subject (one per year) — a qty below that would silently lose
        // years when exportCsv.js splits it back out per-year.
        if (isDynamicMatrix) {
          const shortRow = blk.matrixRows.find((row) => row.cells.some((cell) => {
            const qty = Number(cell.value) || 0;
            return qty > 0 && qty < row.minQty;
          }));
          if (shortRow) {
            const rangeLabel = shortRow.tahunTo && shortRow.tahunTo !== shortRow.tahunFrom
              ? `${shortRow.tahunFrom} – ${shortRow.tahunTo}` : shortRow.tahunFrom;
            return { ...st, cartToast: `${rangeLabel} ${shortRow.namaKelas} covers ${shortRow.minQty} year(s) — enter at least ${shortRow.minQty} for any subject you fill in.` };
          }
        }
        // OTHERS (`hasNamaKelasList`): each Description row's QTY is meant to
        // equal how many Nama Kelas are filled in (one plaque per class) —
        // a mismatch usually means the teacher forgot to update one side
        // after editing the other.
        if (blk.hasNamaKelasList) {
          const mismatchRow = blk.rows.find((row) => row.qtyMismatch);
          if (mismatchRow) {
            return { ...st, cartToast: `${mismatchRow.desc || 'Description'} has QTY ${mismatchRow.qty}, but ${blk.namaKelasCount} Nama Kelas filled in for ${blockLabel} — please make them match.` };
          }
        }
      }

      const newItems = [];
      blocks.forEach((b) => {
        b.plakRows.forEach((pr) => {
          if (pr.jenisPlak && pr.qty) newItems.push({
            id: crypto.randomUUID(), jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice,
            categoryLabel: b.qtyLabel, categoryKey: st.category, blockIdx: b.idx,
            detail: snapshotDetail(st.category, b.idx, isMatrix, isDynamicMatrix, st.lineValues, st.matrixValues, st.rowsByBlock, st.columnsByBlock),
          });
        });
      });
      if (newItems.length === 0) {
        return { ...st, cartToast: 'No filled Jenis Plak rows to add.' };
      }
      // Only clears this category's fields once something was actually
      // added — bailing out above (validation error or nothing filled)
      // must never wipe out what the teacher already typed.
      return {
        ...st, cart: [...st.cart, ...newItems], cartToast: `Added ${newItems.length} item(s) to cart.`,
        ...resetCategoryFields(st.category, st, 'visibleBlocksByCategory'),
      };
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ cartToast: '' }), 2500);
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
  const importFormAnugerahExcel = useCallback(async (file, opts = {}) => {
    let parsed;
    let usedAi = false;
    try {
      const buffer = await file.arrayBuffer();
      parsed = /\.docx$/i.test(file.name) ? await parseWordingDocx(buffer) : parseFormAnugerahExcel(buffer);

      // AI fallback — only when it's switched on for this build and the
      // caller is an admin (the limited first rollout). Runs automatically
      // when the deterministic parser came back empty/thin, or on demand
      // (`opts.forceAi`) when the teacher judges the built-in read wrong.
      // A good template read is never silently overridden.
      if (AI_IMPORT_ENABLED && stateRef.current.role === 'admin' && (opts.forceAi || importLooksThin(parsed))) {
        const aiParsed = await tryAiExtraction(file, buffer);
        if (aiParsed && !aiParsed.error) {
          parsed = aiParsed;
          usedAi = true;
        } else if (opts.forceAi) {
          return { ok: false, message: 'The AI could not read this file. Keep the built-in result, or enter it by hand.' };
        }
      }
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

    if (parsed.klasMatrix) {
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
      let nextRowId = next.nextRowId;
      let nextColumnId = next.nextColumnId;
      let nextPlakRowId = next.nextPlakRowId;
      const newLineValues = { ...next.lineValues };
      const newMatrixValues = { ...next.matrixValues };
      const newRowsByBlock = { ...next.rowsByBlock };
      const newColumnsByBlock = { ...next.columnsByBlock };
      const newPlakRows = { ...next.plakRows };
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
        // synthetic stand-ins above) appended after.
        const presentNames = new Set();
        section.classes.forEach((cls) => cls.subjects.forEach(({ name }) => presentNames.add(name)));
        const subjectNameOrder = [
          ...defaultNames.filter((name) => presentNames.has(name)),
          ...[...presentNames].filter((name) => !defaultNames.includes(name)),
        ];
        const subjectRows = subjectNameOrder.map((name) => ({ id: nextRowId++, desc: name, custom: true }));
        const rowIdByName = new Map(subjectRows.map((r) => [r.desc, r.id]));
        const classColumns = section.classes.map((cls) => ({
          id: nextColumnId++, tahunFrom: cls.tahunFrom, tahunTo: cls.tahunTo, namaKelas: cls.namaKelas,
          // Secondary-school (SMK) class codes — see excelImport.js's
          // splitTingkatanCode — have no Tahun-dropdown equivalent to
          // begin with, so OrderCategoryBlock.jsx swaps in a plain
          // Tingkatan text box for this ONE class row instead, rather
          // than forcing "TINGKATAN 5" into a Tahun 1-6 dropdown it was
          // never meant to hold.
          tingkatan: cls.tingkatan || '', tingkatanMode: !!cls.tingkatanMode,
          // A named-recipient roster's own role/position per person — see
          // excelImport.js's scanSheetForRosters — kept as its own column
          // rather than folded into Nama Kelas/Nama Murid's own text.
          jawatan: cls.jawatan || '',
          // A recipient's OWN class, when the source had a real "NAMA
          // KELAS" column alongside its person-name column (rather than
          // Nama Kelas/Nama Murid itself BEING the class — see
          // excelImport.js's groupRosterHeaders).
          kelasName: cls.kelasName || '',
          // The engraved second detail line below the name, for a
          // pre-written / named-recipient roster import (aiImportMap.js's
          // "prebuilt" layout) — jawatan + unit, e.g.
          // "KETUA PENGAWAS\nLEMBAGA PENGAWAS SEKOLAH". Reaches the CSV's
          // 5th column via buildPbdMatrixRows; blank for every other shape.
          eline2: cls.eline2 || '',
        }));
        section.classes.forEach((cls, classIdx) => {
          const colId = classColumns[classIdx].id;
          cls.subjects.forEach(({ name, qty }) => {
            newMatrixValues[`${key}::${rowIdByName.get(name)}::${colId}`] = String(qty);
          });
        });
        // A PERASMI-style section (excelImport.js's findPerasmiSections)
        // already IS its own real Reference Sample content, in the right
        // order — there's no class/subject breakdown to derive a TAHUN/
        // SUBJEK-POSITION example from, or a "TAJUK BESAR / TAHUN /
        // SUBJEK-POSITION" order to reorder it into, so it opts out and
        // rides through with its own lines exactly as read.
        const sectionLines = section.skipLineDerivation ? section.lines : deriveKlasMatrixSectionLines(section);
        Object.entries(sectionLines).forEach(([slot, val]) => { newLineValues[`${key}::${slot}`] = val; });
        // A roster import's own column header text (NAMA MURID/NAMA GURU/
        // NAMA PELAJAR — see excelImport.js's scanSheetForRosters) rides
        // along the same way hiddenLines/refOrder do, read back by
        // computeBlocks.js to override the generic "Nama Kelas" header.
        if (section.namaKelasLabel) newLineValues[`${key}::namaKelasLabel`] = section.namaKelasLabel;
        newRowsByBlock[key] = subjectRows;
        newColumnsByBlock[key] = classColumns;
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
        const matchedPlak = matchJenisPlakPath(section.jenisPlak, next.plakCatalog);
        if (section.jenisPlak && !matchedPlak) {
          warnings.push({ type: 'plakMismatch', blockIdx: b, text: `Section ${b + 1}: couldn't match Jenis Plak "${section.jenisPlak}" to anything in the catalog — please choose it manually.` });
        }
        newPlakRows[key] = [{ id: nextPlakRowId++, jenisPlak: matchedPlak }];
        // A PERASMI section's own wording (findPerasmiSections) also goes
        // into the order's Remark, not just its own Reference Sample —
        // Sales/Invoicing/Production reading the order later never open
        // Step 2's block editor, so the ONLY place they'd otherwise see
        // this at all is the printed plaque preview itself.
        if (section.remarkNote) remarkNotes.push(section.remarkNote);
      }

      next = {
        ...next,
        lineValues: newLineValues, matrixValues: newMatrixValues,
        rowsByBlock: newRowsByBlock, columnsByBlock: newColumnsByBlock, plakRows: newPlakRows,
        visibleBlocksByCategory: { ...next.visibleBlocksByCategory, [catKey]: maxSections },
        nextRowId, nextColumnId, nextPlakRowId,
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

      // Questions the AI raised while reading (see aiImportMap.js) — same
      // "Confirm before continuing" panel as the deterministic checks. The
      // AI never carries an auto-fix instruction, so answering just
      // acknowledges and jumps the teacher to that section to adjust it.
      (parsed.questions || []).forEach((q) => {
        const opts = q.options.length ? q.options : ['OK, I have checked this'];
        warnings.push({
          type: 'choice',
          id: q.id,
          blockIdx: q.sectionIdx ?? 0,
          text: q.text,
          options: opts.map((label, i) => ({ key: `opt${i}`, label })),
          addPatches: [],
          jumpOnAnswer: true,
          // When one answer implies a mechanical edit (add the school name,
          // drop the class line), NewOrderStep2 applies it — keyed by
          // `opt<whenOption>`. See aiImportMap.js.
          aiApply: q.apply || null,
        });
      });
    }

    if (parsed.remarkNotes?.length) {
      parsed.remarkNotes.forEach((n) => remarkNotes.push(n));
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
    if (remarkNotes.length > 0) {
      next = { ...next, remark: next.remark ? `${next.remark}\n${remarkNotes.join('\n')}` : remarkNotes.join('\n') };
      messages.push(`${remarkNotes.length} note(s) added to Remark`);
    }

    setState({ ...next, category: landOn || next.category });

    const lead = usedAi ? 'Read by AI' : 'Imported';
    return { ok: true, message: `${lead} — ${messages.join('; ')}. Please review carefully before adding to cart.`, warnings };
  }, []);

  const removeFromCart = useCallback((id) => {
    patch((st) => ({ cart: st.cart.filter((c) => c.id !== id) }));
  }, [patch]);

  // "Edit" on a Cart row — reloads every cart item already added under this
  // ONE category back into the New Order draft for that category (every
  // block/section, not just whichever item the row itself represents,
  // since a category can be grouped across several — see Cart.jsx's own
  // groupedCartRows), switches Step 2 to that category tab, and pulls those
  // items back OUT of the cart so re-adding after edits doesn't duplicate
  // them. Reuses buildDraftFromOrder — same reconstruction reorderOrder
  // already relies on for a full order — just scoped to one category's own
  // cart items instead of a whole submitted order, and merged into the
  // EXISTING draft/cart rather than replacing it, so any other category
  // already in the cart is left untouched.
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
      return {
        category: categoryKey,
        lineValues: newLineValues,
        matrixValues: newMatrixValues,
        rowsByBlock: { ...st.rowsByBlock, ...restored.rowsByBlock },
        columnsByBlock: { ...st.columnsByBlock, ...restored.columnsByBlock },
        plakRows: { ...st.plakRows, ...restored.plakRows },
        nextRowId: Math.max(st.nextRowId, restored.nextId),
        nextColumnId: Math.max(st.nextColumnId, restored.nextId),
        visibleBlocksByCategory: { ...st.visibleBlocksByCategory, [categoryKey]: restored.visibleBlocksByCategory[categoryKey] },
        cart: st.cart.filter((ci) => ci.categoryKey !== categoryKey),
      };
    });
  }, [patch]);

  // The order id used to come from a nextOrderSeq counter that lived only
  // in this tab's in-memory state — it reset to 96 on every login *and*
  // every refresh, so two submissions from different sessions (or just a
  // refreshed tab) regularly generated the same "ORD-2026-096" id. That was
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
    const year = TODAY.getFullYear();
    const prefix = `ORD-${year}-`;
    let seq;
    try {
      seq = await nextOrderSeq(prefix, 96);
    } catch (err) {
      console.error('Failed to reserve the next order number:', err);
      patch({ cartToast: `Could not submit the order: ${err.message || 'unknown error'}. Please try again.` });
      return null;
    }
    const newId = `${prefix}${String(seq).padStart(3, '0')}`;

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
      dueDate: st.dueSelected, functionDate: st.funcSelected,
      logoDataUrl: st.logoDataUrl, logoFileName: st.logoFileName, logoRemark: st.logoRemark, schoolType: st.schoolType,
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
      dueSelected: ord.dueDate || null, funcSelected: ord.functionDate || null,
      logoDataUrl: ord.logoDataUrl || null, logoFileName: ord.logoFileName || '', logoRemark: ord.logoRemark || '', schoolType: ord.schoolType || null,
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
    const categoriesUsed = CATEGORIES.filter((cat) => (order.items || []).some((it) => it.categoryKey === cat.key));
    const newItems = [];
    categoriesUsed.forEach((cat) => {
      const { blocks, isMatrix, isDynamicMatrix } = computeBlocks(
        cat.key, st.amendLineValues, st.amendMatrixValues, st.amendRowsByBlock, st.amendPlakRows, st.amendColumnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage,
      );
      const visibleCount = st.amendVisibleBlocksByCategory[cat.key] || 1;
      blocks.slice(0, visibleCount).forEach((blk) => {
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
      addOnOrderId: ord.id, addOnCategory: 'TOKOH',
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
    // Every category (including PBD/ALIRAN, split into their own
    // top-level entries — see catalog.js) has exactly one block, so this
    // naturally picks up whichever categories/blocks actually have data
    // in the draft regardless of which category tab the teacher currently
    // has open — no per-variant block-index bookkeeping needed here.
    CATEGORIES.forEach((cat) => {
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

    const order = st.orders.find((o) => o.id === st.addOnOrderId);
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
  // `overrides` lets Sales adjust Due Date / Function Date (in addition to
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
    const fields = { items: itemsWithOriginalPrice, totalAmount, priceAdjusted, status: 'In Production', ...overrides };
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
    return { ok: true };
  }, [patch, flashToast]);

  // Invoicing Department: approves a still-"Submitted to Sales" order and
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
    const fields = {
      items: itemsWithOriginalPrice, totalAmount, priceAdjusted, status: 'In Production', invoiceId: normalized, ...overrides,
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
    return { ok: true };
  }, [patch, flashToast]);

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
      patch({ productionToast: 'Waiting for Invoicing Department to assign an Invoice Number before this can be marked done.' });
    } else {
      try {
        await updateOrder(orderId, { status: 'Waiting for Delivery' });
        patch((st) => ({
          orders: st.orders.map((o) => (o.id === orderId ? { ...o, status: 'Waiting for Delivery' } : o)),
          productionToast: 'Production completed. Order is now waiting for delivery.',
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

  // Sets a leaf's current stock count — also resets stock_baseline to the
  // same value (see updatePlakNodeStock), so every time Production/Admin
  // types a new number here (first count, restock, or correction) the
  // 15%/25% thresholds recalibrate against it rather than staying pinned
  // to whatever was entered before.
  const updateCatalogNodeStock = useCallback(async (id, stockQty) => {
    try {
      await updatePlakNodeStock(id, stockQty);
      await refreshPlakCatalog();
    } catch (err) {
      console.error('Failed to update Jenis Plak stock in Supabase:', err);
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
    resetCurrentCategory, startNewOrder, addToCart, removeFromCart, editCartCategory, submitOrder, reorderOrder,
    importFormAnugerahExcel,
    openAmend, updateAmend,
    openAddOn, submitPendingAddOn, cancelPendingAddOn, rejectAddOn, approveAddOn, approveOrder, setInvoiceId, approveAndSetInvoiceId,
    cancelOrder,
    recordPrint,
    ensureOrderLoaded,
    markProductionDone,
    addCatalogNode, removeCatalogNode, updateCatalogNodePrice, updateCatalogNodeStock, setCatalogNodeHidden, moveCatalogNode,
    reorderCatalogSiblings,
    refreshAssignedSalesman,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
