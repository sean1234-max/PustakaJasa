import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { CATEGORIES, PLAK_CATALOG } from '../data/catalog';
import { computeBlocks } from '../utils/computeBlocks';
import { createDraftUpdaters } from '../utils/draftUpdaters';

const DRAFT_FIELDS = {
  lineValues: 'lineValues', matrixValues: 'matrixValues', rowsByBlock: 'rowsByBlock', plakRows: 'plakRows',
  nextRowId: 'nextRowId', nextPlakRowId: 'nextPlakRowId',
  namaKelasRows: 'namaKelasRows', nextNamaKelasRowId: 'nextNamaKelasRowId',
};

const EDITABLE = { lines: true, rowDesc: true, rowQty: true, addRemoveRows: true, matrix: true, jenisPlak: true, namaKelas: true };

export default function NewOrderStep2() {
  const { state, patch, addToCart } = useAppState();
  const navigate = useNavigate();
  const [refImages, setRefImages] = useState({});

  const updaters = useMemo(() => {
    const u = createDraftUpdaters(patch, DRAFT_FIELDS, true);
    u.onAddNamaKelas = () => patch((st) => ({
      namaKelasRows: [...st.namaKelasRows, { id: st.nextNamaKelasRowId, namaKelas: '', tahun: '' }],
      nextNamaKelasRowId: st.nextNamaKelasRowId + 1,
    }));
    return u;
  }, [patch]);

  const { blocks, isPbdCategory } = useMemo(() => computeBlocks(
    state.category, state.pbdVariant, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.namaKelasRows, updaters,
  ), [state.category, state.pbdVariant, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.namaKelasRows, updaters]);

  const pbdCat = CATEGORIES.find((c) => c.key === 'PBD');
  const onRefImageChange = (slotId, url, fileName) => setRefImages((prev) => ({ ...prev, [slotId]: { url, fileName } }));

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
          <CategoryTabs categories={CATEGORIES} active={state.category} onSelect={(key) => patch({ category: key })} />
        </div>

        {isPbdCategory && (
          <div className="field" style={{ maxWidth: 340, marginBottom: 'var(--space-6)' }}>
            <label htmlFor="pbdVariant">PBD Item</label>
            <select className="input" id="pbdVariant" value={state.pbdVariant} onChange={(e) => patch({ pbdVariant: Number(e.target.value) })}>
              {pbdCat.variantLabels.map((label, i) => <option key={i} value={i}>{label}</option>)}
            </select>
          </div>
        )}

        {blocks.map((blk) => (
          <OrderCategoryBlock
            key={blk.idx}
            blk={blk}
            editable={EDITABLE}
            plakOptions={PLAK_CATALOG}
            refImage={refImages[blk.sampleSlotId]}
            onRefImageChange={onRefImageChange}
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
