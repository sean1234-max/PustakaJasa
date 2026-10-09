import { useMemo, useRef, useState } from 'react';
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

// Only for the Tambahan upload's own importFormAnugerahExcelInto call — the
// manual-editing DRAFT_FIELDS above doesn't need `category` (createDraftUpdaters
// never touches it), but the import function does (see AppState.jsx).
// `remark`/`importFilePath`/`importFileName` are left undefined — no
// addOnRemark/addOnImportFilePath field exists.
const ADDON_IMPORT_FIELDS = { ...DRAFT_FIELDS, category: 'addOnCategory' };

const EDITABLE = { lines: true, rowDesc: true, rowQty: true, addRemoveRows: true, matrix: true, jenisPlak: true };

export default function AddOn() {
  const { state, patch, importFormAnugerahExcelInto } = useAppState();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === state.addOnOrderId);

  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { ok, message, warnings }
  const [dragOver, setDragOver] = useState(false);

  // Same as New Order (Sean, 2026-10-09): the uploaded Tambahan Excel holds
  // only the add-on, so everything in it goes straight into the add-on
  // draft and shows below for checking/editing.
  const handleUploadFile = async (file) => {
    if (!file || importing) return;
    if (!/\.(xlsx|docx)$/i.test(file.name)) {
      setImportResult({ ok: false, message: 'Please upload an .xlsx or .docx file.' });
      return;
    }
    setImporting(true);
    setImportResult(null);
    let result;
    try {
      result = await importFormAnugerahExcelInto(file, ADDON_IMPORT_FIELDS);
    } catch (err) {
      console.error('Add On import failed:', err);
      result = { ok: false, message: 'Could not read this file. Please try again.' };
    } finally {
      setImporting(false);
    }
    setImportResult(result);
  };

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

        {/* Upload the Tambahan FORM ANUGERAH / WORDING file — imported
            whole into the add-on draft, like New Order. */}
        <div style={{ maxWidth: 560, margin: '0 auto var(--space-6)' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.docx"
            style={{ display: 'none' }}
            onChange={(e) => {
              handleUploadFile(e.target.files && e.target.files[0]);
              e.target.value = ''; // allow re-selecting the same file after a failed diff
            }}
          />
          <div
            className={`image-drop image-drop-stacked${dragOver ? ' image-drop-over' : ''}`}
            style={{ cursor: importing ? 'wait' : 'pointer' }}
            onClick={() => !importing && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!importing) handleUploadFile(e.dataTransfer.files && e.dataTransfer.files[0]);
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div>
              <div className="image-drop-title">{importing ? 'Reading…' : 'Import Order File (Tambahan)'}</div>
              <div className="image-drop-sub">Drag &amp; drop an updated FORM ANUGERAH .xlsx or WORDING .docx here, or click to browse — everything in it is added as the Tambahan</div>
            </div>
          </div>
          {importResult && (
            <p className="hint-text" style={{ margin: '4px 0 0', color: importResult.ok ? '#1f8a3b' : '#c0392b', fontWeight: 600 }}>
              {importResult.message}
            </p>
          )}
          {(importResult?.warnings || []).map((w, i) => (
            <p key={i} className="hint-text" style={{ margin: '4px 0 0', color: '#b45309' }}>{w.text}</p>
          ))}
        </div>

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
          <button type="button" className="btn btn-ghost" onClick={() => navigate(state.role === 'salesman' ? `/sales/orders/${order.id}` : '/dashboard')}>← Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/addon/${order.id}/summary`)} disabled={!state.addOnCategory}>Next</button>
        </div>
      </div>
    </div>
  );
}
