import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { ACTIVE_CATEGORIES, filterHiddenPlakCatalog, isDynamicCategoryKey, resolveCategory } from '../data/catalog';
import { computeBlocks } from '../utils/computeBlocks';
import { createDraftUpdaters } from '../utils/draftUpdaters';
import { getOrderImportUrl } from '../lib/storageApi';

// Production's own scratch draft (AppState's prodExcel* fields — the same
// ones the corrected-Excel parse fills).
const DRAFT_FIELDS = {
  lineValues: 'prodExcelLineValues', matrixValues: 'prodExcelMatrixValues', rowsByBlock: 'prodExcelRowsByBlock', plakRows: 'prodExcelPlakRows',
  nextRowId: 'prodExcelNextRowId', nextPlakRowId: 'prodExcelNextPlakRowId',
  columnsByBlock: 'prodExcelColumnsByBlock', nextColumnId: 'prodExcelNextColumnId',
  visibleBlocksByCategory: 'prodExcelVisibleBlocksByCategory',
};
const EDITABLE = { lines: true, rowDesc: true, rowQty: true, addRemoveRows: true, matrix: true, jenisPlak: true };

// Production fixes an order while reviewing it (status 'Reviewing Order'):
// the same form a teacher fills, every field editable — or filled from a
// corrected copy of the teacher's Excel. Save rebuilds the order's lines,
// quantities, prices, total and stock (AppState's saveProductionEdit).
export default function ProductionEditOrder() {
  const {
    state, patch, ensureOrderLoaded, openProductionEdit, loadExcelIntoProductionEdit, saveProductionEdit,
  } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);

  // Re-open the order as a draft once it's loaded (not on every realtime
  // update of the order — that would wipe unsaved edits).
  const openedFor = useRef(null);
  useEffect(() => {
    if (order && openedFor.current !== order.id) {
      openedFor.current = order.id;
      openProductionEdit(order);
    }
  }, [order, openProductionEdit]);

  const updaters = useMemo(() => createDraftUpdaters(patch, DRAFT_FIELDS), [patch]);
  const visiblePlakCatalog = useMemo(() => filterHiddenPlakCatalog(state.plakCatalog), [state.plakCatalog]);
  const categoryTabs = useMemo(() => {
    const dynamic = Object.keys(state.prodExcelVisibleBlocksByCategory || {})
      .filter(isDynamicCategoryKey).map(resolveCategory).filter(Boolean);
    return [...ACTIVE_CATEGORIES, ...dynamic];
  }, [state.prodExcelVisibleBlocksByCategory]);
  const category = state.prodExcelCategory;
  const { blocks: allBlocks } = useMemo(() => computeBlocks(
    category, state.prodExcelLineValues, state.prodExcelMatrixValues, state.prodExcelRowsByBlock, state.prodExcelPlakRows,
    state.prodExcelColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage,
  ), [category, state.prodExcelLineValues, state.prodExcelMatrixValues, state.prodExcelRowsByBlock, state.prodExcelPlakRows,
    state.prodExcelColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage]);
  const blocks = category ? allBlocks.slice(0, state.prodExcelVisibleBlocksByCategory[category] || 1) : [];

  if (!order) return null;
  const back = () => navigate(`/production/orders/${order.id}`);

  if (order.status !== 'Reviewing Order') {
    return (
      <div className="screen-wrap">
        <Nav />
        <div className="card elev-md">
          <p className="hint-text">{order.id} is no longer being reviewed ({order.status}) — it can’t be edited here.</p>
          <button type="button" className="btn btn-ghost" onClick={back}>← Back to the order</button>
        </div>
      </div>
    );
  }

  const handleExcel = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    const res = await loadExcelIntoProductionEdit(order, file);
    setBusy(false);
    const notes = (res.warnings || []).map((w) => w.text || String(w));
    setMessage(res.ok
      ? { ok: true, text: `Excel loaded — check every tab below, then Save. ${notes.join(' ')}`.trim() }
      : { ok: false, text: res.message || 'Could not read this file.' });
  };

  const handleDownload = async () => {
    const url = await getOrderImportUrl(order.importFilePath);
    if (!url) { setMessage({ ok: false, text: 'Could not download the teacher’s Excel right now. Please try again.' }); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = order.importFileName || 'order.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    const res = await saveProductionEdit(order.id);
    setBusy(false);
    if (res.ok) back();
    else setMessage({ ok: false, text: res.message });
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Edit Order — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>{order.sekolah || 'Fix this order'}</div>
        <p className="hint-text" style={{ margin: '0 0 var(--space-4)' }}>
          Change anything — wording, line order, quantities, Jenis Plak — then Save. Prices use the website price list;
          the total and stock follow automatically, and the teacher, salesman and Store Admin see the new version straight away.
          Edit it here, or download the teacher’s Excel, fix it and upload it again.
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          {order.importFilePath && (
            <button type="button" className="btn btn-secondary" onClick={handleDownload}>⬇ Download teacher’s Excel</button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>⬆ Upload corrected Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleExcel} />
        </div>
        {message && (
          <p className="hint-text" style={{ color: message.ok ? undefined : '#b0392e', fontWeight: 600 }}>{message.text}</p>
        )}

        <div className="card-kicker">Jenis Anugerah (Category)</div>
        <div style={{ margin: 'var(--space-3) 0 var(--space-8)' }}>
          <CategoryTabs categories={categoryTabs} active={category} onSelect={(key) => patch({ prodExcelCategory: key })} />
        </div>

        {blocks.map((blk, i) => (
          <OrderCategoryBlock key={blk.idx} blk={blk} editable={EDITABLE} plakOptions={visiblePlakCatalog} isLastBlock={i === blocks.length - 1} />
        ))}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={back}>← Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={handleSave}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
