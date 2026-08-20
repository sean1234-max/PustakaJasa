import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { CATEGORIES } from '../data/catalog';
import { computeBlocks } from '../utils/computeBlocks';
import { createDraftUpdaters } from '../utils/draftUpdaters';

const DRAFT_FIELDS = {
  lineValues: 'amendLineValues', matrixValues: 'amendMatrixValues', rowsByBlock: 'amendRowsByBlock', plakRows: 'amendPlakRows',
  nextRowId: 'nextRowId', nextPlakRowId: 'nextPlakRowId',
  columnsByBlock: 'amendColumnsByBlock', nextColumnId: 'nextColumnId',
};

// Only quantities and reference text can be adjusted pre-production —
// row/column descriptions and Jenis Plak selection are locked to what was
// ordered.
const EDITABLE = { lines: true, rowDesc: false, rowQty: true, addRemoveRows: false, matrix: true, jenisPlak: false };

export default function Amend() {
  const { state, patch } = useAppState();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === state.amendOrderId);

  const updaters = useMemo(() => createDraftUpdaters(patch, DRAFT_FIELDS), [patch]);

  const categoryTabs = state.amendCategoriesUsed.map((key) => {
    const cat = CATEGORIES.find((c) => c.key === key);
    return { key, label: cat ? cat.label : key };
  });

  const { blocks } = useMemo(() => (
    state.amendCategory
      ? computeBlocks(state.amendCategory, state.amendLineValues, state.amendMatrixValues, state.amendRowsByBlock, state.amendPlakRows, state.amendColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage)
      : { blocks: [] }
  ), [state.amendCategory, state.amendLineValues, state.amendMatrixValues, state.amendRowsByBlock, state.amendPlakRows, state.amendColumnsByBlock, updaters, state.plakCatalog, state.schoolLanguage]);

  if (!order) return null;

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Amend Order — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Adjust Quantities</div>
        <p className="hint-text" style={{ margin: '0 0 var(--space-6)' }}>
          Only the categories included in this order are shown. Quantities can be adjusted before this order goes into production — Jenis Plak / Harga recalculate automatically.
        </p>

        <div className="card-kicker">Jenis Anugerah (Category)</div>
        <div style={{ margin: 'var(--space-3) 0 var(--space-8)' }}>
          <CategoryTabs categories={categoryTabs} active={state.amendCategory} onSelect={(key) => patch({ amendCategory: key })} />
        </div>

        {blocks.map((blk) => (
          <OrderCategoryBlock key={blk.idx} blk={blk} editable={EDITABLE} refImageUrl={state.refImages?.[blk.sampleSlotId]} />
        ))}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/dashboard')}>← Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/amend/${order.id}/summary`)}>Next</button>
        </div>
      </div>
    </div>
  );
}
