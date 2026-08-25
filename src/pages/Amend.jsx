import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { computeBlocks } from '../utils/computeBlocks';
import { createDraftUpdaters } from '../utils/draftUpdaters';
import { getOrderCategories } from '../utils/exportCsv';

const DRAFT_FIELDS = {
  lineValues: 'amendLineValues', matrixValues: 'amendMatrixValues', rowsByBlock: 'amendRowsByBlock', plakRows: 'amendPlakRows',
  nextRowId: 'amendNextRowId', nextPlakRowId: 'amendNextPlakRowId',
  columnsByBlock: 'amendColumnsByBlock', nextColumnId: 'amendNextColumnId',
  visibleBlocksByCategory: 'amendVisibleBlocksByCategory',
};

// Only quantities and reference-sample text can be adjusted pre-approval —
// row descriptions and Jenis Plak selection stay locked to what was
// originally ordered (matches the feature's pre-removal behavior, restored
// per the user's explicit request — see AppState.jsx's openAmend/updateAmend).
const EDITABLE = { lines: true, rowDesc: false, rowQty: true, addRemoveRows: false, matrix: true, jenisPlak: false, namaKelas: false };

export default function Amend() {
  const { state, patch } = useAppState();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === state.amendOrderId);

  const updaters = useMemo(() => createDraftUpdaters(patch, DRAFT_FIELDS), [patch]);

  // Only the categories actually in this order are offered — same
  // restriction the old Amend had, and there is nothing to add/remove here
  // regardless (addRemoveRows is off), so no "start a fresh category" path
  // makes sense on this screen.
  const categoryTabs = useMemo(() => (order ? getOrderCategories(order) : []), [order]);

  const { blocks: allBlocks } = useMemo(() => computeBlocks(
    state.amendCategory, state.amendLineValues, state.amendMatrixValues, state.amendRowsByBlock, state.amendPlakRows, state.amendColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage,
  ), [state.amendCategory, state.amendLineValues, state.amendMatrixValues, state.amendRowsByBlock, state.amendPlakRows, state.amendColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage]);

  const visibleCount = state.amendVisibleBlocksByCategory[state.amendCategory] || 1;
  const blocks = allBlocks.slice(0, visibleCount);

  if (!order) return null;

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Update Details — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Adjust Order Details</div>
        <p className="hint-text" style={{ margin: '0 0 var(--space-6)' }}>
          Only the categories included in this order are shown. Quantities and reference sample text can be adjusted while this order is still Submitted to Sales — Jenis Plak / Harga recalculate automatically.
        </p>

        <div className="card-kicker">Jenis Anugerah (Category)</div>
        <div style={{ margin: 'var(--space-3) 0 var(--space-8)' }}>
          <CategoryTabs categories={categoryTabs} active={state.amendCategory} onSelect={(key) => patch({ amendCategory: key })} />
        </div>

        {blocks.map((blk, i) => (
          <OrderCategoryBlock key={blk.idx} blk={blk} editable={EDITABLE} isLastBlock={i === blocks.length - 1} />
        ))}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/dashboard')}>← Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/amend/${order.id}/summary`)}>Next</button>
        </div>
      </div>
    </div>
  );
}
