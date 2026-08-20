import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { filterHiddenPlakCatalog, buildCategoryTabs, categoryTabKey, resolveCategoryTab } from '../data/catalog';
import { computeBlocks } from '../utils/computeBlocks';
import { createDraftUpdaters } from '../utils/draftUpdaters';

const DRAFT_FIELDS = {
  lineValues: 'lineValues', matrixValues: 'matrixValues', rowsByBlock: 'rowsByBlock', plakRows: 'plakRows',
  nextRowId: 'nextRowId', nextPlakRowId: 'nextPlakRowId',
  columnsByBlock: 'columnsByBlock', nextColumnId: 'nextColumnId',
};

const EDITABLE = { lines: true, rowDesc: true, rowQty: true, addRemoveRows: true, matrix: true, jenisPlak: true };

export default function NewOrderStep2() {
  const { state, patch, addToCart } = useAppState();
  const navigate = useNavigate();

  const updaters = useMemo(() => createDraftUpdaters(patch, DRAFT_FIELDS), [patch]);

  const { blocks, isPbdCategory } = useMemo(() => computeBlocks(
    state.category, state.pbdVariant, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.namaKelasRows, updaters, state.plakCatalog, state.schoolLanguage,
  ), [state.category, state.pbdVariant, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.namaKelasRows, updaters, state.plakCatalog, state.schoolLanguage]);

  // Codes Production has hidden (e.g. out of stock) never appear in the
  // teacher's picker — see filterHiddenPlakCatalog.
  const visiblePlakCatalog = useMemo(() => filterHiddenPlakCatalog(state.plakCatalog), [state.plakCatalog]);

  const pbdCat = CATEGORIES.find((c) => c.key === 'PBD');

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
          <CategoryTabs
            categories={categoryTabs}
            active={categoryTabKey(state.category, state.pbdVariant)}
            onSelect={(key) => patch(resolveCategoryTab(key))}
          />
        </div>

        {blocks.map((blk) => (
          <OrderCategoryBlock
            key={blk.idx}
            blk={blk}
            editable={EDITABLE}
            plakOptions={visiblePlakCatalog}
            refImageUrl={state.refImages?.[blk.sampleSlotId]}
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
