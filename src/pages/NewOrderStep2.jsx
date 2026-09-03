import { useEffect, useMemo, useRef, useState } from 'react';
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
  const { state, patch, addToCart, importFormAnugerahExcel } = useAppState();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [importStatus, setImportStatus] = useState(null); // { ok, message } | null
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Clicking a "couldn't match Jenis Plak" warning jumps straight to that
  // one field — see jumpToBlock/the effect below. `pendingScrollBlockIdx`
  // is only a request ("scroll to this block once it's actually on
  // screen"); a category switch re-renders the whole block list first, so
  // the target element may not exist yet at click time. `flashBlockIdx` is
  // the block currently mid-flash (OrderCategoryBlock's flashJenisPlak
  // prop) — cleared after the animation finishes so clicking the SAME
  // warning again still re-triggers it.
  const [pendingScrollBlockIdx, setPendingScrollBlockIdx] = useState(null);
  const [flashBlockIdx, setFlashBlockIdx] = useState(null);
  // Answers to the import's `type:'choice'` cross-check questions (see
  // AppState's importFormAnugerahExcel / the "Confirm before continuing"
  // panel below), keyed by warning id → chosen option key. An unanswered
  // choice question blocks Add to Cart.
  const [choiceAnswers, setChoiceAnswers] = useState({});

  // "Import from Excel" — lets a teacher upload (by click OR drag-and-drop
  // from Explorer) their own past order instead of typing every
  // class/subject/qty by hand — either a filled-in copy of the FORM
  // ANUGERAH Excel template (see src/utils/excelImport.js) or a Word
  // "WORDING/KUANTITI/KOD HADIAH" order table (see src/utils/docxImport.js),
  // a completely different shape some schools use instead. Loads into
  // Mata Pelajaran/Klas (Matrix) for review here on Step 2 — never adds
  // straight to cart, so a parsing mistake never reaches an order
  // un-reviewed.
  const handleImportFile = async (file) => {
    if (!file || importing) return;
    if (!/\.(xlsx|docx)$/i.test(file.name)) {
      setImportStatus({ ok: false, message: 'Please upload an .xlsx or .docx file.' });
      return;
    }
    setImporting(true);
    setImportStatus(null);
    setChoiceAnswers({});
    let result;
    try {
      result = await importFormAnugerahExcel(file);
    } catch (err) {
      console.error('Import failed:', err);
      result = { ok: false, message: 'Could not read this file. Please try again.' };
    } finally {
      setImporting(false);
    }
    setImportStatus(result);
  };

  // The import's cross-check questions (matrix column vs its own TOTAL row,
  // etc.) — shown in their own panel, and every one must be answered before
  // Add to Cart. Answering "fill it back in" applies the exact draft edits
  // AppState resolved at import time (addPatches); the other answers just
  // acknowledge (the draft already holds the real figures).
  const choiceWarnings = useMemo(
    () => (importStatus?.warnings || []).filter((w) => w.type === 'choice'),
    [importStatus],
  );
  const unansweredChoices = choiceWarnings.filter((w) => !choiceAnswers[w.id]);

  // The import's own warning list is a snapshot from the moment the file
  // was read — a "couldn't match Jenis Plak" entry stays true only until
  // the teacher actually picks one for that block, at which point still
  // showing it would read as the site being broken rather than helpful.
  // Re-checks each `plakMismatch` entry's OWN block against the CURRENT
  // plakRows on every render, so it disappears the moment that block gets
  // a real Jenis Plak — however that happened (typed here, or the block
  // reloaded via Cart's "Edit"). `truncated` (this file had more sections
  // than fit) describes the upload itself, not any one block, so it has
  // nothing to live-check against and just stays for the session.
  const liveImportWarnings = useMemo(() => {
    if (!importStatus?.warnings?.length) return [];
    return importStatus.warnings.filter((w) => {
      if (w.type !== 'plakMismatch') return true;
      const rows = state.plakRows[`KLAS_MATRIX::${w.blockIdx}`] || [];
      return !rows.some((pr) => pr.jenisPlak);
    });
  }, [importStatus, state.plakRows]);

  // Clicking a warning switches to Mata Pelajaran/Klas (Matrix) if the
  // teacher was on a different tab, then queues the scroll — both state
  // updates land in the SAME event handler, so React batches them into one
  // re-render, and `blocks` (below) is itself derived from state.category
  // via useMemo, so by the time the effect below actually runs (after that
  // render commits to the DOM), the target block is already there.
  const jumpToBlock = (blockIdx) => {
    if (state.category !== 'KLAS_MATRIX') patch({ category: 'KLAS_MATRIX' });
    setPendingScrollBlockIdx(blockIdx);
  };
  useEffect(() => {
    if (pendingScrollBlockIdx == null || state.category !== 'KLAS_MATRIX') return undefined;
    const el = document.getElementById(`klas-matrix-plak-${pendingScrollBlockIdx}`);
    setPendingScrollBlockIdx(null);
    if (!el) return undefined; // block isn't currently revealed — nothing to scroll to
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashBlockIdx(pendingScrollBlockIdx);
    // Two 0.6s pulses (see index.css's flash-highlight) — cleared afterward
    // so the SAME warning clicked again still re-triggers the animation
    // instead of the class already being on and doing nothing.
    const timer = setTimeout(() => setFlashBlockIdx(null), 1300);
    return () => clearTimeout(timer);
  }, [pendingScrollBlockIdx, state.category]);

  const answerChoice = (w, optionKey) => {
    if (optionKey === 'add' && w.addPatches?.length) {
      const mv = { ...state.matrixValues };
      w.addPatches.forEach((p) => { mv[p.mkey] = p.value; });
      patch({ matrixValues: mv });
    }
    setChoiceAnswers((a) => ({ ...a, [w.id]: optionKey }));
    if (optionKey === 'keep') jumpToBlock(w.blockIdx);
  };

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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div>
            <div className="card-kicker">Jenis Anugerah (Category)</div>
            <div style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>
              <CategoryTabs categories={ACTIVE_CATEGORIES} active={state.category} onSelect={(key) => patch({ category: key })} />
            </div>
          </div>
          <div style={{ width: 280 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.docx"
              style={{ display: 'none' }}
              onChange={(e) => {
                handleImportFile(e.target.files && e.target.files[0]);
                e.target.value = ''; // allow re-selecting the same file after a failed import
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
                if (!importing) handleImportFile(e.dataTransfer.files && e.dataTransfer.files[0]);
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div>
                <div className="image-drop-title">{importing ? 'Reading…' : 'Import Order File'}</div>
                <div className="image-drop-sub">Drag & drop your filled-in FORM ANUGERAH .xlsx or WORDING .docx here, or click to browse</div>
              </div>
            </div>
            {importStatus && (
              <p className="hint-text" style={{ margin: '4px 0 0', color: importStatus.ok ? '#1f8a3b' : '#c0392b', fontWeight: 600 }}>
                {importStatus.message}
              </p>
            )}
            {/* Separate from the plain success/failure line above — these
                flag a SPECIFIC field the import couldn't fill in correctly
                (an un-matched Jenis Plak, a file too big to fit) even though
                the import as a whole still succeeded, so they need their own
                more attention-grabbing treatment or a teacher skimming past
                the green "Imported" line would never notice one field still
                needs manual attention before Add to Cart. Live-filtered
                (see liveImportWarnings above) — fixing the one field a
                warning is about makes that warning disappear on its own.
                A plakMismatch entry is also clickable — see jumpToBlock —
                so the teacher doesn't have to hunt through what can be a
                dozen+ sections to find the one field a warning is about;
                `truncated` isn't about any one block, so it's plain text. */}
            {liveImportWarnings.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#b45309', fontWeight: 600, fontSize: '0.9em' }}>
                {liveImportWarnings.map((w) => (
                  <li key={w.text}>
                    {w.type === 'plakMismatch' ? (
                      <button
                        type="button"
                        onClick={() => jumpToBlock(w.blockIdx)}
                        style={{
                          background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit',
                          color: 'inherit', textAlign: 'left', textDecoration: 'underline', cursor: 'pointer',
                        }}
                      >
                        ⚠ {w.text}
                      </button>
                    ) : (
                      <>⚠ {w.text}</>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 'var(--space-6)' }} />

        {choiceWarnings.length > 0 && (
          <div className="confirm-panel">
            <div className="confirm-panel-title">
              Confirm before continuing
              {unansweredChoices.length > 0 && <span className="confirm-panel-count">{unansweredChoices.length} left</span>}
            </div>
            {choiceWarnings.map((w) => {
              const answered = choiceAnswers[w.id];
              return (
                <div key={w.id} className={`confirm-item${answered ? ' confirm-item-done' : ''}`}>
                  <p className="confirm-item-q">{w.text}</p>
                  {answered ? (
                    <p className="confirm-item-a">
                      ✓ {w.options.find((o) => o.key === answered)?.label}
                      <button type="button" className="confirm-undo" onClick={() => setChoiceAnswers((a) => { const n = { ...a }; delete n[w.id]; return n; })}>change</button>
                    </p>
                  ) : (
                    <div className="confirm-item-opts">
                      {w.options.map((o) => (
                        <button key={o.key} type="button" className="btn btn-ghost" onClick={() => answerChoice(w, o.key)}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {blocks.map((blk, i) => (
          <div key={blk.idx}>
            {/* Beyond a couple of hand-Duplicated blocks, an import can land a
                dozen+ independent sections in this one category — with no
                visual break between them a long review looks like one
                confusing wall of tables. This numbering is the cheapest way
                to keep each section legible: "which one am I looking at, and
                how many are there left to check". */}
            {blocks.length > 1 && (
              <div className="card-kicker" style={i > 0 ? { marginTop: 'var(--space-8)' } : undefined}>
                Section {i + 1} of {blocks.length}
              </div>
            )}
            <OrderCategoryBlock
              blk={blk}
              editable={EDITABLE}
              plakOptions={visiblePlakCatalog}
              isLastBlock={i === blocks.length - 1}
              flashJenisPlak={flashBlockIdx === blk.idx}
            />
          </div>
        ))}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/order/step1')}>← Back</button>
          {state.cartToast && <span className="toast-inline">{state.cartToast}</span>}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <button type="button" className="btn btn-primary" onClick={addToCart} disabled={unansweredChoices.length > 0}>Add to Cart</button>
            {unansweredChoices.length > 0 && (
              <span className="hint-text" style={{ margin: 0 }}>Answer the {unansweredChoices.length} question(s) above first.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
