import { useEffect, useMemo, useState } from 'react';
import { checkPlaqueWording, checkPlaqueCounts, checkAiReport, plaqueLines } from '../utils/productionCheck';
import { fileText, compareWords } from '../utils/sourceCheck';
import { isCrystalCode } from '../utils/exportCsv';
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

  const plaqueText = useMemo(() => [
    ...rows.map((r) => plaqueLines(r).join('\n')),
    ...(order.items || []).flatMap((it) => (it.detail?.rows || []).map((r) => r.acara || '')),
  ].join('\n'), [rows, order.items]);

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

// After Generate AI File: what SEAN.jsx actually laid out against the CSV that was sent
// (productionCheck.js checkAiReport). `report` comes with the finished helper job (v5 + the new SEAN.jsx).
export function AiFileReportCheck({ report, rows }) {
  if (!report) {
    return <p className="hint-text" style={{ margin: '4px 0 0' }}>No check of the finished AI file — this computer needs the new AI File helper and the NAS needs the new SEAN.jsx.</p>;
  }
  const issues = checkAiReport(report, rows);
  return (
    <div style={{ margin: 'var(--space-2) 0', padding: 'var(--space-3)', border: `1px solid ${issues.length ? '#e0b252' : '#9ccc9c'}`, borderRadius: 6, background: issues.length ? '#fff8e6' : '#f1faf1' }}>
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
