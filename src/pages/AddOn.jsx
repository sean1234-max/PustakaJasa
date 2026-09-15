import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { ACTIVE_CATEGORIES, filterHiddenPlakCatalog, categoriesUsedByItems } from '../data/catalog';
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
  const blocks = state.addOnCategory ? allBlocks.slice(0, visibleCount) : [];

  const visiblePlakCatalog = useMemo(() => filterHiddenPlakCatalog(state.plakCatalog), [state.plakCatalog]);

  // A renamed/duplicated template sheet from the original order's own
  // import (excelImport.js) has no standing ACTIVE_CATEGORIES tab — appear
  // it here too so a later Add-On can add more to that SAME category
  // instead of only ever being able to target the fixed ones.
  const allCategories = useMemo(() => {
    if (!order) return ACTIVE_CATEGORIES;
    const dynamicCats = categoriesUsedByItems(order.items)
      .filter((c) => !ACTIVE_CATEGORIES.some((ac) => ac.key === c.key));
    return [...ACTIVE_CATEGORIES, ...dynamicCats];
  }, [order]);

  if (!order) return null;

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Add On — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Order Details</div>

        <div className="card-kicker">Jenis Anugerah (Category)</div>
        <div style={{ margin: 'var(--space-3) 0 var(--space-8)' }}>
          <CategoryTabs categories={allCategories} active={state.addOnCategory} onSelect={(key) => patch({ addOnCategory: key })} />
        </div>

        {!state.addOnCategory && (
          <div className="hint-text" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', color: 'var(--text-muted, #6b7280)' }}>
            Pilih satu kategori di atas untuk mula.
          </div>
        )}

        {blocks.map((blk, i) => (
          <OrderCategoryBlock key={blk.idx} blk={blk} editable={EDITABLE} plakOptions={visiblePlakCatalog} isLastBlock={i === blocks.length - 1} />
        ))}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/dashboard')}>← Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/addon/${order.id}/summary`)} disabled={!state.addOnCategory}>Next</button>
        </div>
      </div>
    </div>
  );
}
