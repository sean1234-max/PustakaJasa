import { useState, useCallback, useRef, useEffect } from 'react';
import { CATEGORIES, formatDate, standardUnitPrice } from '../data/catalog';
import { ACCOUNTS } from '../data/accounts';
import { seedOrders, buildInitialRowsByBlock, buildInitialPlakRows } from '../data/seedOrders';
import { computeBlocks, snapshotDetail, noopUpdaters } from '../utils/computeBlocks';
import { loadDraft, saveDraft, clearDraft, draftHasContent } from '../utils/draftPersistence';
import { AppStateContext } from './AppStateContext';
import { seedOrdersIfEmpty, insertOrder, updateOrder } from '../lib/ordersApi';

const TODAY = new Date(2026, 7, 6); // matches the mockup's fixed "today"

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
  const draft = loadDraft();
  return {
    userId: '',
    password: '',
    loginError: '',
    role: null,

    sekolah: '',
    sales: '',
    picName: '',
    phone: '',
    remark: '',
    dueSelected: null,
    funcSelected: null,
    logoDataUrl: null,
    logoFileName: '',

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
    nextOrderSeq: 96,
    updateToast: '',
    productionToast: '',

    // A restored draft overwrites the blanks above with whatever was last
    // autosaved (e.g. after a crash or dead battery mid-order) — see
    // draftPersistence.js for exactly which fields are covered.
    ...(draft || {}),
    draftRestoredToast: draftHasContent(draft) ? 'Restored your unsaved order draft.' : '',

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
  useEffect(() => {
    if (state.role !== 'teacher') return undefined;
    clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => saveDraft(state), 1500);
    return () => clearTimeout(draftSaveTimer.current);
  }, [state]);

  useEffect(() => {
    const flush = () => { if (stateRef.current.role === 'teacher') saveDraft(stateRef.current); };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Orders now live in Supabase (see supabase/migrations/0001_orders.sql)
  // instead of only in memory. On first load, pull whatever's in the table;
  // if the project is brand new and the table is empty, seed it once with
  // the sample orders so the dashboard isn't blank.
  useEffect(() => {
    let cancelled = false;
    seedOrdersIfEmpty(seedOrders)
      .then((orders) => { if (!cancelled) patch({ orders, ordersLoaded: true }); })
      .catch((err) => {
        console.error('Failed to load orders from Supabase, falling back to local seed data:', err);
        if (!cancelled) patch({ orders: seedOrders(), ordersLoaded: true });
      });
    return () => { cancelled = true; };
  }, [patch]);

  const initialDraftToastRef = useRef(state.draftRestoredToast);
  useEffect(() => {
    if (!initialDraftToastRef.current) return undefined;
    draftToastTimer.current = setTimeout(() => patch({ draftRestoredToast: '' }), 4000);
    return () => clearTimeout(draftToastTimer.current);
  }, [patch]);

  // Returns the matched role on success (for the caller to route on), or
  // null on failure (and records the error for the Login screen to show).
  const login = useCallback((userId, password) => {
    const account = ACCOUNTS.find((a) => a.userId === userId && a.password === password);
    if (!account) {
      patch({ loginError: 'Invalid User ID or Password.' });
      return null;
    }
    patch({ role: account.role, loginError: '', userId: '', password: '' });
    return account.role;
  }, [patch]);

  const logout = useCallback(() => {
    clearDraft();
    patch({ role: null, userId: '', password: '', loginError: '' });
  }, [patch]);

  const resetCurrentCategory = useCallback((catKey) => {
    patch((st) => resetCategoryFields(catKey, st));
  }, [patch]);

  const addToCart = useCallback(() => {
    setState((st) => {
      const { blocks, isMatrix } = computeBlocks(
        st.category, st.pbdVariant, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.namaKelasRows, noopUpdaters,
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

  const submitOrder = useCallback(() => {
    setState((st) => {
      const totalAmt = st.cart.reduce((sum, ci) => sum + ci.harga, 0);
      const newId = `ORD-2026-${String(st.nextOrderSeq).padStart(3, '0')}`;
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
        sekolah: st.sekolah, sales: st.sales, picName: st.picName, phone: st.phone, remark: st.remark,
        dueDate: st.dueSelected, functionDate: st.funcSelected,
        logoDataUrl: st.logoDataUrl, logoFileName: st.logoFileName,
        snapshot, items: st.cart.map((ci) => ({ ...ci })),
      };
      insertOrder(newOrder).catch((err) => console.error('Failed to save order to Supabase:', err));
      return {
        ...st, lastOrderId: newId, orders: [newOrder, ...st.orders], nextOrderSeq: st.nextOrderSeq + 1, cart: [],
      };
    });
  }, []);

  const reorderOrder = useCallback((ord) => {
    const snap = ord.snapshot;
    patch({
      sekolah: ord.sekolah, sales: ord.sales, picName: ord.picName, phone: ord.phone, remark: ord.remark,
      dueSelected: ord.dueDate || null, funcSelected: ord.functionDate || null,
      logoDataUrl: ord.logoDataUrl || null, logoFileName: ord.logoFileName || '',
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
          catKey, pbdV, st.amendLineValues, st.amendMatrixValues, st.amendRowsByBlock, st.amendPlakRows, [], noopUpdaters,
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
          cat.key, pbdV, st.addOnLineValues, st.addOnMatrixValues, st.addOnRowsByBlock, st.addOnPlakRows, [], noopUpdaters,
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
      const priceAdjusted = updatedItems.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak));
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

  const value = {
    state, patch, today: TODAY, login, logout,
    resetCurrentCategory, addToCart, removeFromCart, submitOrder, reorderOrder,
    openAmend, updateAmend, openAddOn, commitAddOn, approveOrder, setInvoiceId,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
