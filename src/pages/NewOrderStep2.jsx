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
  lineValues: 'lineValues', matrixValues: 'matrixValues', rowsByBlock: 'rowsByBlock', plakRows: 'plakRows',
  nextRowId: 'nextRowId', nextPlakRowId: 'nextPlakRowId',
  columnsByBlock: 'columnsByBlock', nextColumnId: 'nextColumnId',
  visibleBlocksByCategory: 'visibleBlocksByCategory',
};

const EDITABLE = { lines: true, rowDesc: true, rowQty: true, addRemoveRows: true, matrix: true, jenisPlak: true };

export default function NewOrderStep2() {
  const { state, patch, addToCart } = useAppState();
  const navigate = useNavigate();

  const updaters = useMemo(() => createDraftUpdaters(patch, DRAFT_FIELDS), [patch]);

  const { blocks: allBlocks } = useMemo(() => computeBlocks(
    state.category, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.columnsByBlock, updaters, state.plakCatalog, state.schoolLanguage,
  ), [state.category, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.columnsByBlock, updaters, state.plakCatalog, state.schoolLanguage]);

  // Only OTHERS (see catalog.js's blocksCount: 6, one per Tahun) ever
  // computes more than one block — the rest stay revealed until the
  // teacher clicks "Duplicate" (see draftUpdaters.js's onDuplicateBlock).
  const visibleCount = state.visibleBlocksByCategory[state.category] || 1;
  const blocks = allBlocks.slice(0, visibleCount);

  // Codes Production has hidden (e.g. out of stock) never appear in the
  // teacher's picker — see filterHiddenPlakCatalog.
  const visiblePlakCatalog = useMemo(() => filterHiddenPlakCatalog(state.plakCatalog), [state.plakCatalog]);

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="step-header">
        <div className="step step-done">
          <div className="step-dot">✓</div>
          <span>Function Details</span>
        </div>
        <div className="step-line" />
        <div className="step step-active">
          <div className="step-dot">2</div>
          <span>Order Details</span>
        </div>
      </div>

      <div className="card elev-md">
        <div className="card-kicker">New Order — Product</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Order Details</div>

        <div className="card-kicker">Jenis Anugerah (Category)</div>
        <div style={{ margin: 'var(--space-3) 0 var(--space-8)' }}>
          <CategoryTabs categories={ACTIVE_CATEGORIES} active={state.category} onSelect={(key) => patch({ category: key })} />
        </div>

        {blocks.map((blk, i) => (
          <OrderCategoryBlock
            key={blk.idx}
            blk={blk}
            editable={EDITABLE}
            plakOptions={visiblePlakCatalog}
            refImageUrl={state.refImages?.[blk.sampleSlotId]}
            isLastBlock={i === blocks.length - 1}
          />
        ))}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/order/step1')}>← Back</button>
          {state.cartToast && <span className="toast-inline">{state.cartToast}</span>}
          <button type="button" className="btn btn-primary" onClick={addToCart}>Add to Cart</button>
        </div>
      </div>
    </div>
  );
}
