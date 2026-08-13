import { useState, useCallback, useRef, useEffect } from 'react';
import { CATEGORIES, formatDate, standardUnitPrice } from '../data/catalog';
import { buildInitialRowsByBlock, buildInitialPlakRows } from '../data/formDefaults';
import { computeBlocks, snapshotDetail, noopUpdaters } from '../utils/computeBlocks';
import { AppStateContext } from './AppStateContext';
import { fetchOrders, insertOrder, updateOrder, nextOrderSeq } from '../lib/ordersApi';
import {
  fetchReferenceImages, saveReferenceImage,
  fetchPlakCatalog, addPlakNode, removePlakNode, updatePlakNode,
} from '../lib/catalogAdminApi';
import { supabase } from '../lib/supabaseClient';

// Real "today", normalized to midnight so it compares cleanly against the
// midnight-constructed dates the calendar cells and date-math use.
const now = new Date();
const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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
// the id-counter bookkeeping instead of drifting apart.
function resetCategoryFields(catKey, st) {
  const cat = CATEGORIES.find((c) => c.key === catKey);
  const lineValues = { ...st.lineValues };
  Object.keys(lineValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete lineValues[k]; });
  const matrixValues = { ...st.matrixValues };
  Object.keys(matrixValues).forEach((k) => { if (k.startsWith(`${catKey}::`)) delete matrixValues[k]; });
  const rowsByBlock = { ...st.rowsByBlock };
  const plakRows = { ...st.plakRows };
  for (let b = 0; b < (cat.blocksCount || 1); b++) {
    const key = `${catKey}::${b}`;
    if (cat.mode === 'list') rowsByBlock[key] = cat.rows.map((label, i) => ({ id: st.nextRowId + i, desc: label, qty: '' }));
    plakRows[key] = [{ id: st.nextPlakRowId + b, jenisPlak: '' }];
  }
  const namaKelasRows = catKey === 'PBD' ? [{ id: st.nextNamaKelasRowId, namaKelas: '', tahun: '' }] : st.namaKelasRows;
  return {
    lineValues, matrixValues, rowsByBlock, plakRows, namaKelasRows,
    nextRowId: st.nextRowId + 10, nextPlakRowId: st.nextPlakRowId + 10, nextNamaKelasRowId: st.nextNamaKelasRowId + 1,
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
    sales: '',
    picName: '',
    phone: '',
    remark: '',
    dueSelected: null,
    funcSelected: null,
    logoDataUrl: null,
    logoFileName: '',
    schoolType: null,
    stepError: '',

    category: 'MP1',
    pbdVariant: 0,
    lineValues: {},
    matrixValues: {},
    rowsByBlock: buildInitialRowsByBlock(),
    plakRows: buildInitialPlakRows(),
    namaKelasRows: [{ id: 1, namaKelas: '', tahun: '' }],
    nextRowId: 1000,
    nextPlakRowId: 1000,
    nextNamaKelasRowId: 2,

    cart: [],
    nextCartId: 1,
    cartToast: '',

    orders: [],
    ordersLoaded: false,
    lastOrderId: '',
    updateToast: '',
    productionToast: '',

    refImages: {},
    plakCatalog: [],
    plakCatalogLoaded: false,

    draftRestoredToast: '',
    amendOrderId: null,
    amendCategoriesUsed: [],
    amendCategory: '',
    amendPbdVariant: 0,
    amendLineValues: {},
    amendMatrixValues: {},
    amendRowsByBlock: {},
    amendPlakRows: {},

    addOnOrderId: null,
    addOnCategory: 'MP1',
    addOnPbdVariant: 0,
    addOnLineValues: {},
    addOnMatrixValues: {},
    addOnRowsByBlock: buildInitialRowsByBlock(),
    addOnPlakRows: buildInitialPlakRows(),
    addOnNamaKelasRows: [{ id: 1, namaKelas: '', tahun: '' }],
    addOnNextRowId: 1000,
    addOnNextPlakRowId: 1000,
    addOnNextNamaKelasRowId: 2,
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
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, sekolah, display_name, status')
          .eq('id', session.user.id)
          .single();
        if (!cancelled && profile) {
          if (profile.status && profile.status !== 'active') {
            await supabase.auth.signOut();
            if (!cancelled) patch({ loginError: 'This account has been deactivated. Please contact your administrator.' });
          } else {
            patch({ role: profile.role, sekolah: profile.sekolah || '', userAuthId: session.user.id });
          }
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

  // Reference sample images and the Jenis Plak catalog are global settings
  // Production manages (see catalogAdminApi.js) — fetched once per login so
  // logging out and into a different account still picks up the latest.
  useEffect(() => {
    if (!state.role) return undefined;
    let cancelled = false;
    Promise.all([fetchReferenceImages(), fetchPlakCatalog()])
      .then(([refImages, plakCatalog]) => { if (!cancelled) patch({ refImages, plakCatalog, plakCatalogLoaded: true }); })
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
      .select('role, sekolah, display_name, status')
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
    patch({ role: profile.role, sekolah: profile.sekolah || '', userAuthId: data.user.id, loginError: '', userId: '', password: '' });
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
    patch((st) => resetCategoryFields(catKey, st));
  }, [patch]);

  // Wipes the New Order draft (Function Details + Order Details + cart)
  // back to blank whenever the teacher (re)starts the flow via the "New
  // Order" nav link or "Place Another Order" — every field except Sekolah,
  // which stays pinned to the account's school from login.
  const startNewOrder = useCallback(() => {
    patch({
      sales: '', picName: '', phone: '', remark: '',
      dueSelected: null, funcSelected: null,
      logoDataUrl: null, logoFileName: '', schoolType: null, stepError: '',

      category: 'MP1', pbdVariant: 0,
      lineValues: {}, matrixValues: {},
      rowsByBlock: buildInitialRowsByBlock(), plakRows: buildInitialPlakRows(),
      namaKelasRows: [{ id: 1, namaKelas: '', tahun: '' }],
      nextRowId: 1000, nextPlakRowId: 1000, nextNamaKelasRowId: 2,

      cart: [], nextCartId: 1, cartToast: '',
    });
  }, [patch]);

  const addToCart = useCallback(() => {
    setState((st) => {
      const { blocks, isMatrix } = computeBlocks(
        st.category, st.pbdVariant, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.namaKelasRows, noopUpdaters, st.plakCatalog,
      );
      const newItems = [];
      blocks.forEach((b) => {
        b.plakRows.forEach((pr) => {
          if (pr.jenisPlak && pr.qty) newItems.push({
            id: st.nextCartId + newItems.length, jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice,
            categoryLabel: b.qtyLabel, categoryKey: st.category, blockIdx: b.idx,
            detail: snapshotDetail(st.category, b.idx, isMatrix, st.lineValues, st.matrixValues, st.rowsByBlock),
          });
        });
      });
      if (newItems.length === 0) {
        return { ...st, cartToast: 'No filled Jenis Plak rows to add.' };
      }
      return { ...st, cart: [...st.cart, ...newItems], nextCartId: st.nextCartId + newItems.length, cartToast: `Added ${newItems.length} item(s) to cart.` };
    });
    setState((st) => ({ ...st, ...resetCategoryFields(st.category, st) }));
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
    const year = TODAY.getFullYear();
    const prefix = `ORD-${year}-`;
    let seq;
    try {
      seq = await nextOrderSeq(prefix, 96);
    } catch (err) {
      console.error('Failed to reserve the next order number:', err);
      patch({ cartToast: 'Could not submit the order — please try again.' });
      return null;
    }
    const newId = `${prefix}${String(seq).padStart(3, '0')}`;

    const totalAmt = st.cart.reduce((sum, ci) => sum + ci.harga, 0);
    // Only the category-draft portion needs to survive here — sekolah,
    // dates, etc. now live as top-level order fields below, so Sales can
    // rely on every order carrying them regardless of how it was created.
    const snapshot = {
      category: st.category, pbdVariant: st.pbdVariant,
      lineValues: { ...st.lineValues }, matrixValues: { ...st.matrixValues },
      rowsByBlock: JSON.parse(JSON.stringify(st.rowsByBlock)),
      plakRows: JSON.parse(JSON.stringify(st.plakRows)),
      namaKelasRows: JSON.parse(JSON.stringify(st.namaKelasRows)),
    };
    const newOrder = {
      id: newId, invoiceId: null, datePlaced: formatDate(TODAY), deliveryDate: 'TBD',
      totalAmount: totalAmt, status: 'Submitted to Sales', priceAdjusted: false,
      createdBy: st.userAuthId,
      sekolah: st.sekolah, sales: st.sales, picName: st.picName, phone: st.phone, remark: st.remark,
      dueDate: st.dueSelected, functionDate: st.funcSelected,
      logoDataUrl: st.logoDataUrl, logoFileName: st.logoFileName, schoolType: st.schoolType,
      snapshot, items: st.cart.map((ci) => ({ ...ci })),
    };

    try {
      await insertOrder(newOrder);
    } catch (err) {
      console.error('Failed to save order to Supabase:', err);
      patch({ cartToast: 'Could not submit the order — please try again.' });
      return null;
    }
    patch((latest) => ({ lastOrderId: newId, orders: [newOrder, ...latest.orders], cart: [], cartToast: '' }));
    return newId;
  }, [patch]);

  const reorderOrder = useCallback((ord) => {
    const snap = ord.snapshot;
    patch({
      sekolah: ord.sekolah, sales: ord.sales, picName: ord.picName, phone: ord.phone, remark: ord.remark,
      dueSelected: ord.dueDate || null, funcSelected: ord.functionDate || null,
      logoDataUrl: ord.logoDataUrl || null, logoFileName: ord.logoFileName || '', schoolType: ord.schoolType || null,
      // The category-draft (which award category + its filled-in fields)
      // is only available for orders placed through this app's New Order
      // flow — older/imported orders just prefill the school info above.
      ...(snap ? {
        category: snap.category, pbdVariant: snap.pbdVariant,
        lineValues: { ...snap.lineValues }, matrixValues: { ...snap.matrixValues },
        rowsByBlock: JSON.parse(JSON.stringify(snap.rowsByBlock)),
        plakRows: JSON.parse(JSON.stringify(snap.plakRows)),
        namaKelasRows: JSON.parse(JSON.stringify(snap.namaKelasRows)),
      } : {}),
    });
  }, [patch]);

  const openAmend = useCallback((ord) => {
    const categoriesUsed = [];
    const lineValues = {}, matrixValues = {}, rowsByBlock = {}, plakRows = {};
    let pbdVariant = 0;
    (ord.items || []).forEach((it) => {
      if (!it.categoryKey) return;
      if (!categoriesUsed.includes(it.categoryKey)) categoriesUsed.push(it.categoryKey);
      if (it.categoryKey === 'PBD') pbdVariant = it.blockIdx;
      const key = `${it.categoryKey}::${it.blockIdx}`;
      if (it.detail) {
        Object.assign(lineValues, it.detail.lines || {});
        if (it.detail.matrix) Object.assign(matrixValues, it.detail.matrix);
        if (it.detail.rows) rowsByBlock[key] = JSON.parse(JSON.stringify(it.detail.rows));
      }
      plakRows[key] = [{ id: it.id, jenisPlak: it.jenisPlak }];
    });
    patch({
      amendOrderId: ord.id, amendCategoriesUsed: categoriesUsed, amendCategory: categoriesUsed[0] || '',
      amendPbdVariant: pbdVariant, amendLineValues: lineValues, amendMatrixValues: matrixValues,
      amendRowsByBlock: rowsByBlock, amendPlakRows: plakRows,
    });
  }, [patch]);

  const updateAmend = useCallback(() => {
    setState((st) => {
      const newItems = [];
      st.amendCategoriesUsed.forEach((catKey) => {
        const pbdV = catKey === 'PBD' ? st.amendPbdVariant : 0;
        const { blocks: catBlocks, isMatrix: catIsMatrix } = computeBlocks(
          catKey, pbdV, st.amendLineValues, st.amendMatrixValues, st.amendRowsByBlock, st.amendPlakRows, [], noopUpdaters, st.plakCatalog,
        );
        catBlocks.forEach((blk) => {
          blk.plakRows.forEach((pr) => {
            if (pr.jenisPlak) newItems.push({
              id: pr.id, jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice, categoryLabel: blk.qtyLabel,
              categoryKey: catKey, blockIdx: blk.idx,
              detail: snapshotDetail(catKey, blk.idx, catIsMatrix, st.amendLineValues, st.amendMatrixValues, st.amendRowsByBlock),
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
    patch({
      addOnOrderId: ord.id, addOnCategory: 'MP1', addOnPbdVariant: 0,
      addOnLineValues: {}, addOnMatrixValues: {},
      addOnRowsByBlock: buildInitialRowsByBlock(), addOnPlakRows: buildInitialPlakRows(),
      addOnNamaKelasRows: [{ id: 1, namaKelas: '', tahun: '' }],
      addOnNextRowId: 1000, addOnNextPlakRowId: 1000, addOnNextNamaKelasRowId: 2,
    });
  }, [patch]);

  const commitAddOn = useCallback(() => {
    setState((st) => {
      const newItems = [];
      CATEGORIES.forEach((cat) => {
        const pbdV = cat.key === 'PBD' ? st.addOnPbdVariant : 0;
        const { blocks: catBlocks, isMatrix: catIsMatrix } = computeBlocks(
          cat.key, pbdV, st.addOnLineValues, st.addOnMatrixValues, st.addOnRowsByBlock, st.addOnPlakRows, [], noopUpdaters, st.plakCatalog,
        );
        catBlocks.forEach((blk) => {
          blk.plakRows.forEach((pr) => {
            if (pr.jenisPlak && pr.qty) newItems.push({
              id: st.nextCartId + newItems.length, jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, unitPrice: pr.unitPrice, categoryLabel: blk.qtyLabel,
              categoryKey: cat.key, blockIdx: blk.idx,
              detail: snapshotDetail(cat.key, blk.idx, catIsMatrix, st.addOnLineValues, st.addOnMatrixValues, st.addOnRowsByBlock),
            });
          });
        });
      });
      const targetOrder = st.orders.find((o) => o.id === st.addOnOrderId);
      const combinedItems = targetOrder ? [...targetOrder.items, ...newItems] : newItems;
      const combinedTotal = (targetOrder?.totalAmount || 0) + newItems.reduce((sum, it) => sum + it.harga, 0);
      updateOrder(st.addOnOrderId, { items: combinedItems, totalAmount: combinedTotal })
        .catch((err) => console.error('Failed to save add-on to Supabase:', err));
      return {
        ...st,
        orders: st.orders.map((o) => (o.id === st.addOnOrderId ? { ...o, items: combinedItems, totalAmount: combinedTotal } : o)),
        nextCartId: st.nextCartId + newItems.length,
        updateToast: 'Update successful.',
      };
    });
    clearTimeout(updateToastTimer.current);
    updateToastTimer.current = setTimeout(() => patch({ updateToast: '' }), 2500);
  }, [patch]);

  // Sales approval: `updatedItems` carries each item's (possibly
  // Sales-negotiated) unitPrice and recalculated harga. priceAdjusted is
  // true whenever any item's unit price no longer matches the standard
  // catalog rate — that's the flag that turns the order's total red
  // downstream, so production knows to double-check it against the catalog.
  // Approving sends the order straight into production — there's no
  // separate "approved but not yet in production" holding stage.
  const approveOrder = useCallback((orderId, updatedItems) => {
    patch((st) => {
      const totalAmount = updatedItems.reduce((sum, it) => sum + it.harga, 0);
      const priceAdjusted = updatedItems.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, st.plakCatalog));
      updateOrder(orderId, { items: updatedItems, totalAmount, priceAdjusted, status: 'In Production' })
        .catch((err) => console.error('Failed to save approval to Supabase:', err));
      return {
        orders: st.orders.map((o) => (
          o.id === orderId ? { ...o, items: updatedItems, totalAmount, priceAdjusted, status: 'In Production' } : o
        )),
      };
    });
  }, [patch]);

  // Production: records the invoice ID billing hands over on paper once an
  // approved order's hardcopy comes back invoiced. Guarded against orders
  // that aren't yet approved, blank input, and overwriting an existing
  // invoiceId — that paperwork is treated as immutable once recorded.
  const setInvoiceId = useCallback((orderId, invoiceId) => {
    const trimmed = (invoiceId || '').trim();
    setState((st) => {
      const order = st.orders.find((o) => o.id === orderId);
      if (!order || order.status !== 'In Production') {
        return { ...st, productionToast: 'This order is not ready for invoice entry.' };
      }
      if (order.invoiceId) {
        return { ...st, productionToast: 'Invoice ID is already set for this order.' };
      }
      if (!trimmed) {
        return { ...st, productionToast: 'Enter a valid Invoice ID.' };
      }
      updateOrder(orderId, { invoiceId: trimmed })
        .catch((err) => console.error('Failed to save invoice ID to Supabase:', err));
      return {
        ...st,
        orders: st.orders.map((o) => (o.id === orderId ? { ...o, invoiceId: trimmed } : o)),
        productionToast: 'Invoice ID saved — order is ready for export.',
      };
    });
    clearTimeout(productionToastTimer.current);
    productionToastTimer.current = setTimeout(() => patch({ productionToast: '' }), 2500);
  }, [patch]);

  // Production: replaces one category's reference sample image. Updates
  // local state immediately (every teacher's picker reads from it) and
  // persists to Supabase in the background.
  const updateReferenceImage = useCallback((slotId, dataUrl) => {
    patch((st) => ({ refImages: { ...st.refImages, [slotId]: dataUrl } }));
    saveReferenceImage(slotId, dataUrl).catch((err) => console.error('Failed to save reference image to Supabase:', err));
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

  const value = {
    state, patch, today: TODAY, login, logout,
    resetCurrentCategory, startNewOrder, addToCart, removeFromCart, submitOrder, reorderOrder,
    openAmend, updateAmend, openAddOn, commitAddOn, approveOrder, setInvoiceId,
    updateReferenceImage, addCatalogNode, removeCatalogNode, updateCatalogNodePrice, setCatalogNodeHidden, moveCatalogNode,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
