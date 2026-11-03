import { useEffect, useMemo, useState } from 'react';
import { checkPlaqueWording, checkPlaqueCounts, checkAiReport, plaqueLines, a3Files } from '../utils/productionCheck';
import { fileText, compareWords } from '../utils/sourceCheck';
import { reviewOrder, merahChoices, checkExcel, rowWithout, aiPlaquesOf, aiIssuesToReview } from '../utils/reviewChecks';
import { reviewOrderAi } from '../lib/reviewAiApi';
import { PlakRowPreview } from './PlakPreview';
import { isCrystalCode, buildCsvRows, CSV_COLUMNS } from '../utils/exportCsv';
import { orderImportFiles } from '../utils/importFiles';
import { FORM_TEMPLATE_URL } from '../utils/formRoundTrip';
import { fetchOrderImportBlob } from '../lib/storageApi';
import { getAiFileHelperStatus, getAiFileTemplates } from '../lib/aiFileHelper';

const MAX_WORDS_SHOWN = 40;

// The automatic check above Generate AI File (Sean, 2026-10-22): the manager looks only at what's
// flagged here instead of comparing every plaque by hand. `groups`: the page's jenisPlakExport.
//   wording   — the same line / year twice on a plaque, a word typed twice (productionCheck.js)
//   count     — plaques per Jenis Plak in the AI file vs the order
//   template  — a Jenis Plak with no template .ai in the AI FILE folder: that file would be missing
//   file      — the teacher's own file vs the order, word by word (sourceCheck.js)
export default function ProductionChecks({ order, groups }) {
  const rows = useMemo(() => groups.flatMap((g) => g.csvData.rows), [groups]);
  const wording = useMemo(() => checkPlaqueWording(rows), [rows]);
  const counts = useMemo(() => checkPlaqueCounts(groups), [groups]);
  const plakCodes = useMemo(() => [...new Set(groups.filter((g) => !isCrystalCode(g.jenisPlak)).map((g) => g.jenisPlak))], [groups]);
  const [templates, setTemplates] = useState({ state: 'loading' });
  const [words, setWords] = useState({ state: 'loading' });

  useEffect(() => {
    let live = true;
    (async () => {
      const status = await getAiFileHelperStatus();
      if (!status) return { state: 'skip', note: 'The AI File helper is not running on this computer — templates not checked.' };
      if ((status.version || 0) < 4) return { state: 'skip', note: 'This computer’s AI File helper is an older version — install the new one to check templates.' };
      const found = await getAiFileTemplates(plakCodes);
      if (!found) return { state: 'skip', note: 'Could not ask the AI File helper about templates.' };
      return { state: 'done', missing: plakCodes.filter((c) => !found[c]) };
    })().then((r) => { if (live) setTemplates(r); });
    return () => { live = false; };
  }, [plakCodes]);

  // every plaque of the whole order — the page may show one invoice of a split order only, and the
  // teacher's file holds them all (ORD-0108)
  const plaqueText = useMemo(() => [
    ...buildCsvRows(order, null, order.items || []).rows.map((r) => plaqueLines(r).join('\n')),
    ...(order.items || []).flatMap((it) => (Array.isArray(it.detail?.rows) ? it.detail.rows : []).map((r) => r.acara || '')),
  ].join('\n'), [order]);

  useEffect(() => {
    let live = true;
    (async () => {
      const files = order.correctedImportFilePath
        ? [{ path: order.correctedImportFilePath, name: order.correctedImportFileName || 'corrected.xlsx' }]
        : orderImportFiles(order);
      if (!files.length) return { state: 'skip', note: 'No file was uploaded for this order.' };
      const texts = [];
      const skipped = [];
      for (const f of files) {
        const blob = await fetchOrderImportBlob(f.path);
        const text = blob ? await fileText(await blob.arrayBuffer(), f.path) : null;
        if (text == null) skipped.push(f.name); else texts.push(text);
      }
      if (!texts.length) return { state: 'skip', note: `Couldn’t read ${skipped.join(', ')} to compare (a PDF isn’t compared).` };
      const tpl = await fetch(FORM_TEMPLATE_URL).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      const templateText = tpl ? await fileText(tpl, 'form.xlsx') : '';
      // the order's details, its tab names and Jenis Plak codes aren't engraved wording
      const orderText = [order.sekolah, order.picName, order.ketuaPanitia, order.remark, order.sales, order.logoRemark,
        ...(order.items || []).flatMap((it) => [it.categoryLabel, it.jenisPlak])].join('\n');
      return { state: 'done', skipped, ...compareWords({ fileTexts: texts, templateText, plaqueText, orderText }) };
    })().catch((err) => {
      console.error('Production check could not compare the teacher’s file:', err);
      return { state: 'skip', note: 'Could not compare with the teacher’s file right now.' };
    }).then((r) => { if (live) setWords(r); });
    return () => { live = false; };
  }, [order, plaqueText]);

  const problems = wording.length + counts.length + (templates.missing?.length || 0) + (words.missing?.length || 0) + (words.extra?.length || 0);
  const loading = templates.state === 'loading' || words.state === 'loading';
  const list = (items) => items.slice(0, MAX_WORDS_SHOWN).join(', ') + (items.length > MAX_WORDS_SHOWN ? ` … (+${items.length - MAX_WORDS_SHOWN})` : '');

  return (
    <div style={{ margin: 'var(--space-3) 0', padding: 'var(--space-3)', border: `1px solid ${problems ? '#e0b252' : '#9ccc9c'}`, borderRadius: 6, background: problems ? '#fff8e6' : '#f1faf1' }}>
      <div style={{ fontWeight: 700 }}>
        {loading ? '⏳ Checking this order…' : problems ? `⚠ Check these ${problems} thing(s) before / after Generate AI File` : '✅ Automatic check: nothing found'}
      </div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {wording.map((w) => (
          <li key={`w-${w.text}`}>
            Wording: {w.text} — {w.count} plaque(s), e.g. <span className="dim">{w.sample}</span>
          </li>
        ))}
        {counts.map((c) => <li key={`c-${c.text}`}>Quantity: {c.text}</li>)}
        {templates.state === 'done' && templates.missing.map((code) => (
          <li key={`t-${code}`}>No AI FILE template for <strong>{code}</strong> — its AI file won’t be made (add it to product_mapping.csv, or make it by hand).</li>
        ))}
        {words.state === 'done' && words.missing.length > 0 && (
          <li>In the teacher’s file but on no plaque: <strong>{list(words.missing)}</strong></li>
        )}
        {words.state === 'done' && words.extra.length > 0 && (
          <li>On the plaques but not in the teacher’s file: <strong>{list(words.extra)}</strong></li>
        )}
      </ul>
      {[templates.note, words.note, words.skipped?.length ? `Not compared: ${words.skipped.join(', ')}.` : ''].filter(Boolean).map((n) => (
        <p key={n} className="hint-text" style={{ margin: '4px 0 0' }}>{n}</p>
      ))}
    </div>
  );
}

// While reviewing (Reviewing Order): the program half of the review rule book
// (reviewChecks.js, docs/ai-review-rules.md). Only flags — Production still fixes and clicks Done Review.
const LEVEL_LABEL = { fix: '🔴 Fix', ask: '🟡 Ask salesman' };
// B1: the same plaque red and black side by side — screenshot it to the salesman, then click the
// teacher's pick (saved as the sheet's MERAH). `onPick(key, value)`: null when MERAH can't be changed.
function MerahChoice({ order, issue, onPick }) {
  const choices = useMemo(() => merahChoices(order, issue.itemId, issue.word), [order, issue.itemId, issue.word]);
  const [busy, setBusy] = useState(false);
  if (!choices) return <p style={{ margin: '4px 0' }}>{issue.text}</p>;
  const pick = async (value) => {
    setBusy(true);
    try { await onPick(choices.key, value); } finally { setBusy(false); }
  };
  const jenisPlak = choices.black.row[CSV_COLUMNS.indexOf('jenis_plak')];
  const options = [
    { label: 'MERAH (red)', choice: choices.red, button: 'Use red' },
    { label: 'Black', choice: choices.black, button: 'Keep black' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-3)', margin: '6px 0 var(--space-2)' }}>
      {options.map(({ label, choice, button }) => (
        <div key={label} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6, padding: 'var(--space-2)' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
          {choice ? <PlakRowPreview jenisPlak={jenisPlak} row={choice.row} /> : <p className="hint-text">This line can’t be made red on this sheet.</p>}
          {choice && onPick && (
            <button type="button" className="btn btn-secondary" style={{ marginTop: 6 }} disabled={busy} onClick={() => pick(choice.value)}>{button}</button>
          )}
        </div>
      ))}
    </div>
  );
}

// The long word list / sample plaque, folded away — the pictures and one short line come first.
function Details({ summary, children }) {
  return (
    <details style={{ marginTop: 2 }}>
      <summary className="dim" style={{ cursor: 'pointer', fontSize: 13 }}>{summary}</summary>
      <div className="dim" style={{ fontSize: 13 }}>{children}</div>
    </details>
  );
}

function MerahIssue({ order, issue, onPick, onShow }) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{ fontWeight: 700 }}>🟡 {issue.sheet}: red or black?</div>
      <Where issue={{ ...issue, find: issue.word }} onShow={onShow} />
      <div className="hint-text" style={{ margin: '2px 0 0' }}>Screenshot this to the salesman, then click what the teacher picks.</div>
      <MerahChoice order={order} issue={issue} onPick={onPick} />
      <Details summary={`Lines on this sheet (${issue.wordList.length}) · ${issue.count} plaque(s)`}>{issue.wordList.join(' · ')}</Details>
    </div>
  );
}

// The order's Excel(s) — the Corrected Excel when there is one — read once for checkExcel.
function useExcelIssues(order) {
  const [excel, setExcel] = useState({ loading: true, issues: [] });
  const files = useMemo(() => (order.correctedImportFilePath
    ? [{ path: order.correctedImportFilePath, name: order.correctedImportFileName || 'corrected.xlsx' }]
    : orderImportFiles(order)), [order]);
  useEffect(() => {
    let live = true;
    (async () => {
      const found = [];
      for (const f of files) {
        const blob = await fetchOrderImportBlob(f.path);
        if (blob) found.push(...checkExcel(order, await blob.arrayBuffer(), f.path));
      }
      return found;
    })().catch((err) => {
      console.error('AI Review could not read the order’s Excel:', err);
      return [];
    }).then((found) => { if (live) setExcel({ loading: false, issues: found }); });
    return () => { live = false; };
  }, [order, files]);
  return excel;
}

// Where the issue is: the sheet (the Excel tab of the same name), and a button straight to it
function Where({ issue, onShow }) {
  if (!issue.sheet) return null;
  const fromExcel = issue.rule.startsWith('I') || issue.rule === 'A1';
  return (
    <div style={{ margin: '2px 0', fontSize: 14 }}>
      📍 {issue.rule === 'I4' ? 'Excel FRONT PG ↔ sheet' : fromExcel ? 'Excel sheet' : 'Sheet'} <strong>{issue.sheet}</strong>
      {!fromExcel && ` · ${issue.count} plaque(s)`}
      {issue.categoryKey && onShow && (
        <>
          {' '}
          <button type="button" className="btn btn-secondary" style={{ padding: '2px 10px', marginLeft: 6 }} onClick={() => onShow(issue.categoryKey, issue.find)}>Show me</button>
        </>
      )}
    </div>
  );
}

// The plaque it's on — and for D1 the same plaque with that line taken off
function IssuePictures({ issue }) {
  if (!issue.row) return null;
  const jenisPlak = issue.row[CSV_COLUMNS.indexOf('jenis_plak')];
  const pictures = issue.rule === 'D1'
    ? [{ label: 'Now', row: issue.row }, { label: `With "-" (no ${issue.find})`, row: rowWithout(issue.row, issue.find) }]
    : [{ label: 'The plaque', row: issue.row }];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 260px))', gap: 'var(--space-2)', margin: '4px 0' }}>
      {pictures.map((p) => (
        <div key={p.label} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 6, padding: 6 }}>
          <div className="dim" style={{ fontSize: 12, marginBottom: 2 }}>{p.label}</div>
          <PlakRowPreview jenisPlak={jenisPlak} row={p.row} />
        </div>
      ))}
    </div>
  );
}

// The model's judgment (review-order-ai): asked once per order + wording, cached in this browser
function useAiIssues(order) {
  const plaques = useMemo(() => aiPlaquesOf(order), [order]);
  const [ai, setAi] = useState({ loading: true, issues: [] });
  useEffect(() => {
    let live = true;
    setAi({ loading: true, issues: [] });
    reviewOrderAi(order.id, plaques).then((r) => { if (live) setAi({ loading: false, issues: aiIssuesToReview(r.issues, plaques) }); });
    return () => { live = false; };
  }, [order.id, plaques]);
  return ai;
}

// `onShow(categoryKey, words)`: open that sheet in Order Details and flash the row with those words
export function AiReviewCheck({ order, onPickMerah, onShow }) {
  const excel = useExcelIssues(order);
  const ai = useAiIssues(order);
  const issues = useMemo(() => [...reviewOrder(order), ...excel.issues, ...ai.issues], [order, excel.issues, ai.issues]);
  const merah = issues.filter((i) => i.itemId);
  const others = issues.filter((i) => !i.itemId);
  const reading = excel.loading || ai.loading;
  const title = issues.length ? `AI Review — ${issues.length} thing(s) to check${reading ? ' (still reading…)' : ''}`
    : reading ? '⏳ AI Review: reading the order…' : '🟢 AI Review: nothing found';
  return (
    <div style={{ margin: '0 0 var(--space-3)', padding: 'var(--space-3)', border: `1px solid ${issues.length ? '#e0b252' : '#9ccc9c'}`, borderRadius: 6, background: issues.length ? '#fff8e6' : '#f1faf1' }}>
      <div style={{ fontWeight: 700, marginBottom: issues.length ? 'var(--space-2)' : 0 }}>{title}</div>
      {merah.map((i) => <MerahIssue key={i.itemId} order={order} issue={i} onPick={onPickMerah} onShow={onShow} />)}
      {others.map((i) => (
        <div key={`${i.rule}-${i.text}-${i.categoryKey || ''}`} style={{ marginBottom: 'var(--space-3)' }}>
          <strong>{LEVEL_LABEL[i.level]}</strong>{i.ai && ' 🤖'} {i.text}
          <Where issue={i} onShow={onShow} />
          <IssuePictures issue={i} />
          <Details summary={`rule ${i.rule}`}>{i.sample}</Details>
        </div>
      ))}
    </div>
  );
}

// After Generate AI File: what SEAN.jsx actually laid out against the CSV that was sent
// (productionCheck.js checkAiReport). `report` comes with the finished helper job (v5 + the new SEAN.jsx).
export function AiFileReportCheck({ report, rows }) {
  if (!report) {
    return <p className="hint-text" style={{ margin: '4px 0 0' }}>No check of the finished AI file — this computer needs the new AI File helper and the NAS needs the new SEAN.jsx.</p>;
  }
  const issues = checkAiReport(report, rows);
  const a3 = a3Files(report);
  return (
    <div style={{ margin: 'var(--space-2) 0', padding: 'var(--space-3)', border: `1px solid ${issues.length ? '#e0b252' : '#9ccc9c'}`, borderRadius: 6, background: issues.length ? '#fff8e6' : '#f1faf1' }}>
      {a3.map((f) => (
        <p key={f.file} style={{ margin: '0 0 6px', fontWeight: 600 }}>
          A3: {f.count} plaque(s) ({f.codes}) are on <strong>{f.file}</strong> — in MEDAL/A3 on the NAS, not in this order's folder.
        </p>
      ))}
      <div style={{ fontWeight: 700 }}>
        {issues.length ? `⚠ The finished AI file — check these ${issues.length} thing(s)` : '✅ The finished AI file matches the order (every file made, every plaque, no line broken or cut off)'}
      </div>
      {issues.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {issues.map((i) => <li key={`${i.kind}-${i.text}`}>{i.text}{i.count > 1 && i.kind !== 'file' && i.kind !== 'count' ? ` — ${i.count} plaque(s)` : ''} <span className="dim">({i.sample})</span></li>)}
        </ul>
      )}
    </div>
  );
}
