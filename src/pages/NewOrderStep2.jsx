import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import {
  ACTIVE_CATEGORIES, filterHiddenPlakCatalog, isDynamicCategoryKey, resolveCategory,
} from '../data/catalog';
import { computeBlocks, noopUpdaters } from '../utils/computeBlocks';
import { createDraftUpdaters } from '../utils/draftUpdaters';
import { checkEngravingText } from '../lib/grammarCheckApi';

const DRAFT_FIELDS = {
  lineValues: 'lineValues', matrixValues: 'matrixValues', rowsByBlock: 'rowsByBlock', plakRows: 'plakRows',
  nextRowId: 'nextRowId', nextPlakRowId: 'nextPlakRowId',
  columnsByBlock: 'columnsByBlock', nextColumnId: 'nextColumnId',
  visibleBlocksByCategory: 'visibleBlocksByCategory',
};

const EDITABLE = { lines: true, rowDesc: true, rowQty: true, addRemoveRows: true, matrix: true, jenisPlak: true };

export default function NewOrderStep2() {
  const { state, patch, addToCart, addAllToCart, importFormAnugerahExcel } = useAppState();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  // The last import's result ({ ok, message, warnings }) and the answers to
  // its questions live in AppState, not this page, so they're still here
  // after the teacher steps back to Function Details — every question must
  // be answered before Add to Cart (Sean, 2026-10-03).
  const importStatus = state.step2ImportStatus || null;
  const setImportStatus = (value) => patch({ step2ImportStatus: value });
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
  const choiceAnswers = state.step2ChoiceAnswers || {};
  const setChoiceAnswers = (next) => patch((st) => ({
    step2ChoiceAnswers: typeof next === 'function' ? next(st.step2ChoiceAnswers || {}) : next,
  }));
  // AI proofread of the engraving lines, run on Add to Cart. `checking` is
  // the spinner while it runs; `pendingCheck` = { issues, proceed } holds
  // the found issues + the add action to run once the teacher is done
  // reviewing them. Both are purely advisory — see grammarCheckApi.js.
  const [checking, setChecking] = useState(false);
  const [pendingCheck, setPendingCheck] = useState(null);
  const [checkOkToast, setCheckOkToast] = useState(false);

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
    // Said once, up front, right after the upload — those rows came in with
    // a blank Jenis Plak, and a teacher who only reads the order at Add to
    // Cart time wouldn't know which ones the file itself didn't resolve.
    const unmatched = [...new Set((result.warnings || []).filter((w) => w.type === 'plakMismatch').map((w) => w.raw))];
    if (result.ok && unmatched.length > 0) {
      window.alert(`Jenis Plak ini tidak dijumpai dalam katalog. Sila pilih sendiri sebelum tambah ke troli:\n\n${unmatched.map((raw) => `• ${raw}`).join('\n')}\n\nThese Jenis Plak couldn't be matched to the catalog — please choose them manually before adding to cart.`);
    }
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
  // was read. A "couldn't match Jenis Plak" entry is no longer shown here —
  // it's a "this category still needs a Jenis Plak" problem, and
  // `incompleteCategories` below already tracks that live for every
  // category in one place. What's left is `truncated` (this file had more
  // sections than fit): it describes the upload itself, not any one block,
  // so it just stays for the session.
  const liveImportWarnings = useMemo(
    () => (importStatus?.warnings || []).filter((w) => w.type !== 'plakMismatch' && w.type !== 'choice'),
    [importStatus],
  );

  // Clicking a warning switches to the category it's about (KLAS_MATRIX
  // unless the warning names its own — see AppState.jsx's `categorized`
  // import for PPKI/MP THP 1), then queues the scroll — both state updates
  // land in the SAME event handler, so React batches them into one
  // re-render, and `blocks` (below) is itself derived from state.category
  // via useMemo, so by the time the effect below actually runs (after that
  // render commits to the DOM), the target block is already there. A
  // `mode:'matrix'` category like PPKI/MP THP 1 only ever has one block and
  // no scroll target of its own — switching to its tab is already the
  // whole story, so there's nothing further to scroll to.
  const jumpToBlock = (blockIdx, catKey = 'KLAS_MATRIX') => {
    if (state.category !== catKey) patch({ category: catKey });
    if (catKey !== 'KLAS_MATRIX') return;
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
    if ((optionKey === 'add' || optionKey === 'fix') && w.addPatches?.length) {
      const mv = { ...state.matrixValues };
      w.addPatches.forEach((p) => { mv[p.mkey] = p.value; });
      patch({ matrixValues: mv });
    }
    // FRONT PG questions (AppState's importFormAnugerahExcelInto): the
    // chosen side's value goes into Function Details.
    const fieldPatch = w.options.find((o) => o.key === optionKey)?.fieldPatch;
    if (fieldPatch) patch(fieldPatch);
    setChoiceAnswers((a) => ({ ...a, [w.id]: optionKey }));
    if (optionKey === 'keep') jumpToBlock(w.blockIdx, w.catKey || 'KLAS_MATRIX');
  };

  const updaters = useMemo(() => createDraftUpdaters(patch, DRAFT_FIELDS), [patch]);

  const { blocks: allBlocks } = useMemo(() => computeBlocks(
    state.category, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.columnsByBlock, updaters, state.plakCatalog, state.schoolLanguage,
  ), [state.category, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.columnsByBlock, updaters, state.plakCatalog, state.schoolLanguage]);

  // Only OTHERS (see catalog.js's blocksCount: 6, one per Tahun) ever
  // computes more than one block — the rest stay revealed until the
  // teacher clicks "Duplicate" (see draftUpdaters.js's onDuplicateBlock).
  // No category is open until the teacher either uploads a FORM ANUGERAH
  // file (which auto-selects whichever categories it filled — see AppState's
  // importFormAnugerahExcel `landOn`) or clicks a tab. computeBlocks always
  // returns something (it falls back to the first category for an unknown
  // key), so the blocks are only actually shown once a real category is set.
  const visibleCount = state.visibleBlocksByCategory[state.category] || 1;
  const blocks = state.category ? allBlocks.slice(0, visibleCount) : [];

  // Every category that's been started (a qty typed, a line filled) but
  // isn't ready to add — no Jenis Plak picked, a total that doesn't add
  // up, etc. Same check Add to Cart runs (buildCategoryCartItems), just
  // surfaced up front for all categories at once instead of one toast at
  // a time. Blocks "Add All to Cart" while any remain. `draftForCheck` is
  // the exact slice of state that check reads — memoized so it only
  // rebuilds when a real field changes, not on every unrelated patch.
  const draftForCheck = useMemo(() => ({
    lineValues: state.lineValues, matrixValues: state.matrixValues, rowsByBlock: state.rowsByBlock,
    plakRows: state.plakRows, columnsByBlock: state.columnsByBlock,
    plakCatalog: state.plakCatalog, schoolLanguage: state.schoolLanguage,
  }), [
    state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows,
    state.columnsByBlock, state.plakCatalog, state.schoolLanguage,
  ]);
  // A renamed/duplicated template sheet (excelImport.js) has no standing
  // tab in ACTIVE_CATEGORIES — the only place it's discoverable is
  // visibleBlocksByCategory, which the import sets for it (see
  // AppState.jsx's `parsed.categorized` handling). Appended after the
  // static list so a fresh order (no import yet) behaves exactly as before.
  const allCategories = useMemo(() => {
    const dynamicCats = Object.keys(state.visibleBlocksByCategory || {})
      .filter(isDynamicCategoryKey)
      .map(resolveCategory)
      .filter(Boolean);
    return [...ACTIVE_CATEGORIES, ...dynamicCats];
  }, [state.visibleBlocksByCategory]);

  const incompleteCategories = useMemo(() => (
    allCategories
      .map((cat) => ({ cat, res: buildCategoryCartItems(draftForCheck, cat.key) }))
      .filter(({ res }) => res.engaged && res.error)
      .map(({ cat, res }) => ({ key: cat.key, label: cat.label, error: res.error }))
  ), [allCategories, draftForCheck]);

  // Codes Production has hidden (e.g. out of stock) never appear in the
  // teacher's picker — see filterHiddenPlakCatalog.
  const visiblePlakCatalog = useMemo(() => filterHiddenPlakCatalog(state.plakCatalog), [state.plakCatalog]);

  // Every filled engraving text across the given categories — the
  // Reference Sample lines plus each Kuantiti row's own text (its
  // description, UMUM's ①–④) — for the AI spelling check, each with
  // `target` (where a fix goes) and its block (confirmed words are kept per
  // block). `extras` = UMUM row lines the Reference Sample leaves blank,
  // which the teacher must confirm.
  const collectEngraving = (catKeys) => {
    const lines = [];
    const extras = [];
    catKeys.forEach((catKey) => {
      const catLabel = resolveCategory(catKey)?.label || catKey;
      const { blocks: catBlocks } = computeBlocks(
        catKey, state.lineValues, state.matrixValues, state.rowsByBlock, state.plakRows, state.columnsByBlock,
        noopUpdaters, state.plakCatalog, state.schoolLanguage,
      );
      catBlocks.forEach((blk) => {
        const blockKey = `${catKey}::${blk.idx}`;
        (blk.lines || []).forEach((ln) => {
          [ln, ln.secondLine].filter(Boolean).forEach((l) => {
            const text = String(l.value || '').trim();
            const label = (l.placeholder || 'Line').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
            if (text) lines.push({ id: l.key, label, text, blockKey, where: `${catLabel} — Reference Sample`, target: { lineKey: l.key } });
          });
        });
        if (blk.selempang) return;
        (blk.rows || []).forEach((row, ri) => {
          const fields = [
            ...(!blk.hideDescColumn ? [{ key: 'desc', label: blk.descColumnLabel || 'Description', value: row.desc }] : []),
            ...(row.tokohFields || []).filter((f) => f.contohSlot !== undefined),
          ];
          fields.forEach((f) => {
            const text = String(f.value || '').trim();
            if (!text || text === '-') return;
            const where = `${catLabel} — row ${ri + 1} ${f.label}`;
            lines.push({ id: `${blockKey}::row::${row.id}::${f.key}`, label: f.label, text, blockKey, where, target: { rowsKey: blockKey, rowId: row.id, field: f.key } });
            if (f.extraLine) extras.push({ type: 'extra', text, where });
          });
        });
      });
    });
    return { lines, extras };
  };

  // Add to cart, but first: UMUM lines missing from the Reference Sample
  // (confirm each) and the AI spelling check over every engraving text. A
  // flagged word must be fixed ("Use fix") or confirmed right ("This word
  // is correct" — kept on the order so Production sees it) before the add
  // goes through (Sean, 2026-10-03). If the AI is down nothing is flagged.
  const runAddWithCheck = async (catKeys, proceed) => {
    const { lines, extras } = collectEngraving(catKeys);
    let aiIssues = [];
    if (lines.length > 0) {
      setChecking(true);
      try {
        ({ issues: aiIssues } = await checkEngravingText(lines));
      } catch { aiIssues = []; }
      setChecking(false);
    }
    const byId = new Map(lines.map((l) => [l.id, l]));
    const okWords = (blockKey) => (state.lineValues[`${blockKey}::wordsOk`] || '').split(',');
    // One panel entry per (block, wrong word, fix), however many lines have it.
    const grouped = new Map();
    aiIssues.forEach((it) => {
      const line = byId.get(it.lineId);
      if (!line || okWords(line.blockKey).includes(it.original.toUpperCase())) return;
      const key = `${line.blockKey}|${it.original}|${it.suggestion}`;
      const prev = grouped.get(key);
      grouped.set(key, prev
        ? { ...prev, targets: [...prev.targets, line.target] }
        : { ...it, type: 'ai', blockKey: line.blockKey, where: line.where, targets: [line.target] });
    });
    const issues = [...extras, ...grouped.values()];
    if (issues.length > 0) {
      setPendingCheck({ issues, proceed });
    } else {
      proceed();
      if (lines.length > 0) {
        setCheckOkToast(true);
        setTimeout(() => setCheckOkToast(false), 2500);
      }
    }
  };

  const handleAddCategory = () => {
    if (checking) return;
    // A category that isn't ready to add at all — let addToCart surface its
    // own toast, don't spend a check on it.
    if (buildCategoryCartItems(draftForCheck, state.category).error) { addToCart(); return; }
    runAddWithCheck([state.category], addToCart);
  };

  const handleAddAll = () => {
    if (checking) return;
    const engagedKeys = allCategories
      .filter((c) => buildCategoryCartItems(draftForCheck, c.key).engaged)
      .map((c) => c.key);
    runAddWithCheck(engagedKeys, addAllToCart);
  };

  const resolveIssue = (issue) => setPendingCheck((p) => (p ? { ...p, issues: p.issues.filter((x) => x !== issue) } : p));
  // "Use fix" — replace the first occurrence of `original` in every line
  // that has it. If the text changed since the check, that line is skipped.
  const replaceFirst = (cur, issue) => {
    const idx = cur.indexOf(issue.original);
    return idx === -1 ? null : cur.slice(0, idx) + issue.suggestion + cur.slice(idx + issue.original.length);
  };
  const applyFix = (issue) => {
    issue.targets.forEach((t) => {
      if (t.lineKey) {
        const next = replaceFirst(state.lineValues[t.lineKey] || '', issue);
        if (next !== null) updaters.onLine(t.lineKey, next);
        return;
      }
      const row = (state.rowsByBlock[t.rowsKey] || []).find((r) => r.id === t.rowId);
      const next = replaceFirst(String(row?.[t.field] || ''), issue);
      if (next !== null) updaters.onRowField(t.rowsKey, t.rowId, t.field, next);
    });
    resolveIssue(issue);
  };
  // "This word is correct" — remembered on the block (wordsOk), so it isn't
  // asked again and Production sees it at review.
  const keepWord = (issue) => {
    const key = `${issue.blockKey}::wordsOk`;
    const words = (state.lineValues[key] || '').split(',').filter(Boolean);
    const word = issue.original.toUpperCase();
    if (!words.includes(word)) updaters.onLine(key, [...words, word].join(','));
    resolveIssue(issue);
  };
  const proceedFromPanel = () => {
    if (pendingCheck?.issues.length) return;
    const proceed = pendingCheck?.proceed;
    setPendingCheck(null);
    if (proceed) proceed();
  };

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

        {/* Import Order File — its own standalone part, one shared control
            for the whole order rather than something each category tab has
            its own copy of. Whatever it detects lands in that section's own
            category (see AppState.jsx's importFormAnugerahExcel); the
            "Jenis Anugerah (Category)" tabs below are purely for reviewing/
            editing the result afterward, not for choosing where to import. */}
        <div style={{ maxWidth: 560, margin: '0 auto var(--space-6)' }}>
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
          {/* Separate from the plain success/failure line above — flags a
              file that had more sections than could be imported (`truncated`),
              which the teacher must follow up on separately. Per-field
              problems (an un-matched Jenis Plak, an unfilled category) are
              in the red "can't be added to cart" panel below the tabs. */}
          {liveImportWarnings.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#b45309', fontWeight: 600, fontSize: '0.9em' }}>
              {liveImportWarnings.map((w) => (
                <li key={w.text}>⚠ {w.text}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-kicker">Jenis Anugerah (Category)</div>
        <div style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>
          <CategoryTabs categories={allCategories} active={state.category} onSelect={(key) => patch({ category: key })} />
        </div>
        <div style={{ marginBottom: 'var(--space-6)' }} />

        {incompleteCategories.length > 0 && (
          <div className="login-error" style={{ margin: '0 0 var(--space-4)', textAlign: 'left' }}>
            <strong>These categories can’t be added to cart yet:</strong>
            <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 18 }}>
              {incompleteCategories.map((c) => (
                <li key={c.key} style={{ marginBottom: 2 }}>
                  <button
                    type="button"
                    onClick={() => patch({ category: c.key })}
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {c.label}
                  </button>
                  {' — '}{c.error}
                </li>
              ))}
            </ul>
          </div>
        )}

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

        {!state.category && (
          <div className="hint-text" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', color: 'var(--text-muted, #6b7280)' }}>
            Muat naik fail FORM ANUGERAH di atas untuk isi automatik, atau pilih satu kategori di atas untuk isi sendiri.
          </div>
        )}

        {blocks.map((blk, i) => (
          <div key={blk.idx}>
            {/* Beyond a couple of hand-Duplicated blocks, an import can land a
                dozen+ independent sections in this one category — with no
                visual break between them a long review looks like one
                confusing wall of tables. Labeled by the actual sheet it came
                from (PPKI, MP THP 1, ...) when known — see computeBlocks.js's
                sourceSheet — falling back to a bare ordinal for a hand-added
                or hand-duplicated block that never came from a file. */}
            {blocks.length > 1 && (
              <div className="card-kicker" style={i > 0 ? { marginTop: 'var(--space-8)' } : undefined}>
                {blk.sourceSheet || `Section ${i + 1} of ${blocks.length}`}
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

        {pendingCheck && (
          <div className="confirm-panel" style={{ marginTop: 'var(--space-5)' }}>
            <div className="confirm-panel-title">
              Please check — {pendingCheck.issues.length === 0 ? 'all done' : `${pendingCheck.issues.length} thing(s) to answer`}
              <span className="confirm-panel-count">AI</span>
            </div>
            <p className="hint-text" style={{ margin: '0 0 var(--space-3)' }}>
              This text gets engraved on the plaque. Answer every item below before adding to cart.
            </p>
            {pendingCheck.issues.map((issue, k) => (
              <div key={k} className="confirm-item">
                <p className="hint-text" style={{ margin: 0 }}>{issue.where}</p>
                {issue.type === 'extra' ? (
                  <>
                    <p className="confirm-item-q" style={{ margin: 0 }}>
                      <strong>{issue.text}</strong> — not in the Reference Sample. Engrave it on this plaque?
                    </p>
                    <div className="confirm-item-opts">
                      <button type="button" className="btn btn-ghost" onClick={() => resolveIssue(issue)}>Yes, keep it</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="confirm-item-q" style={{ margin: 0 }}>
                      Which one is right?
                      <span className="hint-text" style={{ marginLeft: 8 }}>({issue.kind})</span>
                    </p>
                    {issue.note && <p className="hint-text" style={{ margin: '2px 0 6px' }}>{issue.note}</p>}
                    <div className="confirm-item-opts">
                      <button type="button" className="btn btn-ghost" onClick={() => keepWord(issue)}>1. {issue.original}</button>
                      <button type="button" className="btn btn-ghost" onClick={() => applyFix(issue)}>2. {issue.suggestion}</button>
                    </div>
                  </>
                )}
              </div>
            ))}
            <div className="row-actions" style={{ marginTop: 'var(--space-3)' }}>
              <button type="button" className="btn btn-primary" disabled={pendingCheck.issues.length > 0} onClick={proceedFromPanel}>
                Add to cart
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPendingCheck(null)}>Back to editing</button>
            </div>
          </div>
        )}

        <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/order/step1')}>← Back</button>
          {state.cartToast && <span className="toast-inline">{state.cartToast}</span>}
          {!state.cartToast && checkOkToast && <span className="toast-inline">✓ Spelling OK</span>}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {state.category && (
                <button type="button" className="btn btn-ghost" onClick={handleAddCategory} disabled={unansweredChoices.length > 0 || checking}>
                  {checking ? 'Checking…' : 'Add this category only'}
                </button>
              )}
              {/* One click adds every category that has filled data — the
                  common case after an import fills several at once. */}
              <button type="button" className="btn btn-primary" onClick={handleAddAll} disabled={unansweredChoices.length > 0 || incompleteCategories.length > 0 || checking}>
                {checking ? 'Checking…' : 'Add All to Cart'}
              </button>
            </div>
            {unansweredChoices.length > 0 && (
              <span className="hint-text" style={{ margin: 0 }}>Answer the {unansweredChoices.length} question(s) above first.</span>
            )}
            {unansweredChoices.length === 0 && incompleteCategories.length > 0 && (
              <span className="hint-text" style={{ margin: 0 }}>Fix the {incompleteCategories.length} category(s) flagged above first.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
