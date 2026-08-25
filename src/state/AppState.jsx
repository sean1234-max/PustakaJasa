import { useState, useCallback, useRef, useEffect } from 'react';
import { CATEGORIES, formatDate, standardUnitPrice, getCategorySubjects } from '../data/catalog';
import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';
import {
  computeBlocks, snapshotDetail, noopUpdaters, buildDraftFromOrder,
} from '../utils/computeBlocks';
import { AppStateContext } from './AppStateContext';
import {
  fetchOrders, insertOrder, updateOrder, nextOrderSeq, fetchAllSalesmen,
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
      // LONJAKAN resets back to its fixed preset rows; TOKOH/OTHERS (no
      // `rows` preset — see catalog.js) reset to one blank teacher-typed
      // row instead, same as formDefaults.js's initial seed.
      rowsByBlock[key] = cat.rows && cat.rows.length > 0
        ? cat.rows.map((label, i) => ({ id: st.nextRowId + i, desc: label, qty: '' }))
        : [{ id: st.nextRowId, desc: '', qty: '', custom: true }];
      if (cat.hasNamaKelasList) {
        columnsByBlock[key] = [{ id: nextColumnId, name: '' }];
        nextColumnId += 1;
      }
    }
    if (cat.mode === 'dynamicMatrix') {
      rowsByBlock[key] = getCategorySubjects(cat, st.schoolLanguage).map((subject, i) => ({ id: st.nextRowId + i, desc: subject, custom: false }));
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
  const updateToastTimer = useRef(null);
  const productionToastTimer = useRef(null);
  const draftToastTimer = useRef(null);
  const draftSaveTimer = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((updater) => {
    setState((prev) => ({ ...prev, ...(typeof updater === 'function' ? updater(prev) : updater) }));
  }, []);

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

  const removeFromCart = useCallback((id) => {
    patch((st) => ({ cart: st.cart.filter((c) => c.id !== id) }));
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
  const updateAmend = useCallback(() => {
    setState((st) => {
      const order = st.orders.find((o) => o.id === st.amendOrderId);
      if (!order) return st;
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
      updateOrder(st.amendOrderId, { items: newItems, totalAmount: amendedTotal })
        .catch((err) => console.error('Failed to save amend to Supabase:', err));
      return {
        ...st,
        orders: st.orders.map((o) => (o.id === st.amendOrderId ? { ...o, items: newItems, totalAmount: amendedTotal } : o)),
        updateToast: 'Update successful.',
      };
    });
    clearTimeout(updateToastTimer.current);
    updateToastTimer.current = setTimeout(() => patch({ updateToast: '' }), 2500);
  }, [patch]);

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
    const flashToast = (msg) => {
      patch({ updateToast: msg });
      clearTimeout(updateToastTimer.current);
      updateToastTimer.current = setTimeout(() => patch({ updateToast: '' }), 2500);
    };
    if (newItems.length === 0) {
      flashToast('No add-on items to submit.');
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
      flashToast(describeStockError(err));
      return false;
    }

    try {
      await updateOrder(st.addOnOrderId, { pendingAddonItems: newItems, pendingAddonStatus: 'pending', pendingAddonRejectReason: null });
    } catch (err) {
      console.error('Failed to submit add-on to Supabase:', err);
      restorePlakStock(newItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })))
        .catch((restoreErr) => console.error('Failed to restore stock after a failed add-on submit:', restoreErr));
      flashToast(`Could not submit the add-on: ${err.message || 'unknown error'}. Please try again.`);
      return false;
    }

    patch((latest) => ({
      orders: latest.orders.map((o) => (
        o.id === st.addOnOrderId ? { ...o, pendingAddonItems: newItems, pendingAddonStatus: 'pending', pendingAddonRejectReason: null } : o
      )),
    }));
    flashToast('Add-on submitted — waiting for Sales approval.');
    return true;
  }, [patch]);

  // Teacher withdraws a pending or rejected add-on before/without Sales
  // acting on it further — clears it back to no-add-on-in-flight.
  const cancelPendingAddOn = useCallback((orderId) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    // A 'rejected' add-on already had its stock restored when it was
    // rejected (see rejectAddOn) — only a still-'pending' one (withdrawn
    // before Sales acted on it) still has its submission-time deduction
    // outstanding here.
    if (order?.pendingAddonStatus === 'pending' && order.pendingAddonItems?.length) {
      restorePlakStock(order.pendingAddonItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })))
        .catch((err) => console.error('Failed to restore stock for a cancelled add-on:', err));
    }
    updateOrder(orderId, { pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null })
      .catch((err) => console.error('Failed to cancel add-on in Supabase:', err));
    patch((st) => ({
      orders: st.orders.map((o) => (
        o.id === orderId ? { ...o, pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null } : o
      )),
    }));
  }, [patch]);

  // Sales sends a pending add-on back to the teacher with an optional
  // reason, instead of approving it — `pendingAddonItems` stays as-is so
  // the teacher can see what was submitted; only cancelPendingAddOn or a
  // fresh submitPendingAddOn (which overwrites it) clears it from here.
  const rejectAddOn = useCallback((orderId, reason) => {
    const order = stateRef.current.orders.find((o) => o.id === orderId);
    if (order?.pendingAddonItems?.length) {
      restorePlakStock(order.pendingAddonItems.map((it) => ({ full_path: it.jenisPlak, qty: it.qty })))
        .catch((err) => console.error('Failed to restore stock for a rejected add-on:', err));
    }
    updateOrder(orderId, { pendingAddonStatus: 'rejected', pendingAddonRejectReason: reason || '' })
      .catch((err) => console.error('Failed to reject add-on in Supabase:', err));
    patch((st) => ({
      orders: st.orders.map((o) => (o.id === orderId ? { ...o, pendingAddonStatus: 'rejected', pendingAddonRejectReason: reason || '' } : o)),
    }));
  }, [patch]);

  // Sales approves a pending add-on — `updatedItems` carries each item's
  // (possibly Sales-negotiated) unitPrice/harga, same as approveOrder
  // below. Stamps every item with the next batch number (1, 2, 3…) so it
  // stays visually distinct from the original order and any earlier
  // add-on rounds permanently, not just on this review screen — see
  // src/utils/orderBatches.js. Only ever adds to items/totalAmount; never
  // touches the order's main `status`, so an add-on can be approved
  // whether the order is already In Production or beyond.
  const approveAddOn = useCallback((orderId, updatedItems) => {
    patch((st) => {
      const order = st.orders.find((o) => o.id === orderId);
      if (!order) return {};
      // Stamps `originalUnitPrice` the first time Sales negotiates an
      // add-on item's price away from what the teacher's own pending
      // add-on had — compared against the item as it stood before THIS
      // approval, not the live catalog rate (that's the separate,
      // pre-existing priceAdjusted concept below). Never overwritten once
      // set, so a later edit can't erase the true original.
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
      const combinedTotal = order.totalAmount + batchedItems.reduce((sum, it) => sum + it.harga, 0);
      const priceAdjusted = order.priceAdjusted || batchedItems.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog));
      updateOrder(orderId, {
        items: combinedItems, totalAmount: combinedTotal, priceAdjusted,
        pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null,
      }).catch((err) => console.error('Failed to approve add-on in Supabase:', err));
      return {
        orders: st.orders.map((o) => (
          o.id === orderId ? {
            ...o, items: combinedItems, totalAmount: combinedTotal, priceAdjusted,
            pendingAddonItems: null, pendingAddonStatus: null, pendingAddonRejectReason: null,
          } : o
        )),
      };
    });
  }, [patch]);

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
  const approveOrder = useCallback((orderId, updatedItems, overrides = {}) => {
    patch((st) => {
      // Stamps `originalUnitPrice` the first time Sales changes an item's
      // price away from what the teacher's own cart had — compared
      // against the order as it stood before THIS approval, not the live
      // catalog rate (that's the separate, pre-existing priceAdjusted
      // concept below). Never overwritten once set, so a later edit can't
      // erase the true original. Pre-existing approved orders simply have
      // no originalUnitPrice on their items, so nothing extra shows for them.
      const priorOrder = st.orders.find((o) => o.id === orderId);
      const priorItems = priorOrder?.items || [];
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
      updateOrder(orderId, fields)
        .catch((err) => console.error('Failed to save approval to Supabase:', err));
      return {
        orders: st.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
      };
    });
  }, [patch]);

  // Production: records the invoice ID billing hands over on paper once an
  // approved order's hardcopy comes back invoiced. Guarded against orders
  // that aren't yet approved, blank input, and overwriting an existing
  // invoiceId — that paperwork is treated as immutable once recorded.
  const setInvoiceId = useCallback((orderId, invoiceId) => {
    // Strips every space (not just leading/trailing) before saving or
    // comparing, so "INV 2026 090" and "INV2026090" are treated as the
    // same invoice number for the duplicate check below.
    const normalized = (invoiceId || '').replace(/\s+/g, '');
    setState((st) => {
      const order = st.orders.find((o) => o.id === orderId);
      if (!order || order.status !== 'In Production') {
        return { ...st, productionToast: 'This order is not ready for invoice entry.' };
      }
      if (order.invoiceId) {
        return { ...st, productionToast: 'Invoice ID is already set for this order.' };
      }
      if (!normalized) {
        return { ...st, productionToast: 'Enter a valid Invoice ID.' };
      }
      const isDuplicate = st.orders.some((o) => (
        o.id !== orderId && o.invoiceId && o.invoiceId.replace(/\s+/g, '') === normalized
      ));
      if (isDuplicate) {
        return { ...st, productionToast: 'Invoice ID invalid because repeated, please try again.' };
      }
      updateOrder(orderId, { invoiceId: normalized })
        .catch((err) => console.error('Failed to save invoice ID to Supabase:', err));
      return {
        ...st,
        orders: st.orders.map((o) => (o.id === orderId ? { ...o, invoiceId: normalized } : o)),
        productionToast: 'Invoice ID saved — order is ready for export.',
      };
    });
    clearTimeout(productionToastTimer.current);
    productionToastTimer.current = setTimeout(() => patch({ productionToast: '' }), 2500);
  }, [patch]);

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
  const approveAndSetInvoiceId = useCallback((orderId, updatedItems, invoiceId, overrides = {}) => {
    const normalized = (invoiceId || '').replace(/\s+/g, '');
    setState((st) => {
      const order = st.orders.find((o) => o.id === orderId);
      if (!order || order.status !== 'Submitted to Sales') {
        return { ...st, productionToast: 'This order is not awaiting approval.' };
      }
      if (!normalized) {
        return { ...st, productionToast: 'Enter a valid Invoice ID.' };
      }
      const isDuplicate = st.orders.some((o) => (
        o.id !== orderId && o.invoiceId && o.invoiceId.replace(/\s+/g, '') === normalized
      ));
      if (isDuplicate) {
        return { ...st, productionToast: 'Invoice ID invalid because repeated, please try again.' };
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
      updateOrder(orderId, fields)
        .catch((err) => console.error('Failed to approve and save invoice ID to Supabase:', err));
      return {
        ...st,
        orders: st.orders.map((o) => (o.id === orderId ? { ...o, ...fields } : o)),
        productionToast: 'Order approved and Invoice Number saved.',
      };
    });
    clearTimeout(productionToastTimer.current);
    productionToastTimer.current = setTimeout(() => patch({ productionToast: '' }), 2500);
  }, [patch]);

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
    resetCurrentCategory, startNewOrder, addToCart, removeFromCart, submitOrder, reorderOrder,
    openAmend, updateAmend,
    openAddOn, submitPendingAddOn, cancelPendingAddOn, rejectAddOn, approveAddOn, approveOrder, setInvoiceId, approveAndSetInvoiceId,
    recordPrint,
    markProductionDone,
    addCatalogNode, removeCatalogNode, updateCatalogNodePrice, updateCatalogNodeStock, setCatalogNodeHidden, moveCatalogNode,
    reorderCatalogSiblings,
    refreshAssignedSalesman,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
