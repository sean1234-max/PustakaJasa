import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { ACTIVE_CATEGORIES, filterHiddenPlakCatalog } from '../data/catalog';
import { computeBlocks } from '../utils/computeBlocks';
import { createDraftUpdaters } from '../utils/draftUpdaters';

const DRAFT_FIELDS = {
  lineValues: 'addOnLineValues', matrixValues: 'addOnMatrixValues', rowsByBlock: 'addOnRowsByBlock', plakRows: 'addOnPlakRows',
  nextRowId: 'addOnNextRowId', nextPlakRowId: 'addOnNextPlakRowId',
  columnsByBlock: 'addOnColumnsByBlock', nextColumnId: 'addOnNextColumnId',
  visibleBlocksByCategory: 'addOnVisibleBlocksByCategory',
};

const EDITABLE = { lines: true, rowDesc: true, rowQty: true, addRemoveRows: true, matrix: true, jenisPlak: true };

export default function AddOn() {
  const { state, patch } = useAppState();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === state.addOnOrderId);

  const updaters = useMemo(() => createDraftUpdaters(patch, DRAFT_FIELDS), [patch]);

  const { blocks: allBlocks } = useMemo(() => computeBlocks(
    state.addOnCategory, state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, state.addOnColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage,
  ), [state.addOnCategory, state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, state.addOnColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage]);

  const visibleCount = state.addOnVisibleBlocksByCategory[state.addOnCategory] || 1;
  const blocks = allBlocks.slice(0, visibleCount);

  const visiblePlakCatalog = useMemo(() => filterHiddenPlakCatalog(state.plakCatalog), [state.plakCatalog]);

  if (!order) return null;

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Add On — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Order Details</div>

        <div className="card-kicker">Jenis Anugerah (Category)</div>
        <div style={{ margin: 'var(--space-3) 0 var(--space-8)' }}>
          <CategoryTabs categories={ACTIVE_CATEGORIES} active={state.addOnCategory} onSelect={(key) => patch({ addOnCategory: key })} />
        </div>

        {blocks.map((blk, i) => (
          <OrderCategoryBlock key={blk.idx} blk={blk} editable={EDITABLE} plakOptions={visiblePlakCatalog} isLastBlock={i === blocks.length - 1} />
        ))}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/dashboard')}>← Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/addon/${order.id}/summary`)}>Next</button>
        </div>
      </div>
    </div>
  );
}
