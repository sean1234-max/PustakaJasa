import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppState } from '../state/useAppState';
import { uploadKertasKerjaFile } from '../lib/storageApi';
import { linesOfKertasKerja, readUploadedKertasKerja } from '../lib/kertasKerjaLinesApi';

export const KERTAS_KERJA_ANCHOR = 'kertas-kerja';

// why Add to Cart can't check against this file (kertasKerjaText.js reads .docx / .xlsx / text .pdf)
const unreadableWhy = (name) => (/\.(jpe?g|png|heic|webp)$/i.test(name) ? 'A photo: the website can\'t read its words'
  : /\.pdf$/i.test(name) ? 'A scanned PDF (or it couldn\'t be opened): no words to read'
  : /\.(docx|xlsx)$/i.test(name) ? 'The website couldn\'t read this file'
  : 'This file type can\'t be read (save it as .docx, .xlsx or .pdf)');

// The teacher's kertas kerja (Sean, 2026-11-05): any file, several at once, uploaded under the
// Import Order File box on New Order (stateKey 'kertasKerjaFiles') and Add On ('addOnKertasKerja').
// Not read by the website — Production downloads it to compare with the order.
export default function KertasKerjaUpload({ stateKey }) {
  const { state, patch } = useAppState();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const files = state[stateKey] || [];
  // which files Add to Cart can check the order against (a scan or a photo has no text to read)
  const [readable, setReadable] = useState({});
  useEffect(() => {
    let live = true;
    files.filter((f) => !f.path.startsWith('form-bot/') && !(f.path in readable)).forEach((f) => {
      linesOfKertasKerja(f).then((lines) => { if (live) setReadable((r) => ({ ...r, [f.path]: !!lines })); });
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);
  // Cart / Add On's "Yes, I have it" lands here (navigate(…, { state: { scrollTo: KERTAS_KERJA_ANCHOR } }))
  const scrollHere = useLocation().state?.scrollTo === KERTAS_KERJA_ANCHOR;
  const boxRef = useRef(null);
  useEffect(() => {
    if (scrollHere) boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollHere]);

  const add = async (list) => {
    const picked = [...(list || [])];
    if (!picked.length) return;
    setBusy(true);
    setError('');
    const failed = [];
    for (const file of picked) {
      try {
        const res = await uploadKertasKerjaFile(file);
        readUploadedKertasKerja(res.path, file);
        patch((st) => ({ [stateKey]: [...(st[stateKey] || []), res] }));
      } catch (err) {
        failed.push(err.message);
      }
    }
    setBusy(false);
    if (failed.length) setError(failed.join('\n'));
  };
  const remove = (path) => patch((st) => ({ [stateKey]: (st[stateKey] || []).filter((f) => f.path !== path) }));

  return (
    <div ref={boxRef} id={KERTAS_KERJA_ANCHOR} style={{ maxWidth: 560, margin: '0 auto var(--space-6)', scrollMarginTop: 80 }}>
      <input
        ref={inputRef} type="file" multiple style={{ display: 'none' }}
        onChange={(e) => { add(e.target.files); e.target.value = ''; }}
      />
      <div
        className={`image-drop image-drop-stacked${dragOver ? ' image-drop-over' : ''}`}
        style={{ cursor: busy ? 'wait' : 'pointer' }}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) add(e.dataTransfer.files); }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        <div>
          <div className="image-drop-title">{busy ? 'Uploading…' : 'Kertas Kerja Guru'}</div>
          <div className="image-drop-sub">The teacher&apos;s own kertas kerja softcopy (Word, Excel, PDF, photo …) for Production to compare — drag & drop or click, one file or several</div>
        </div>
      </div>
      {files.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
          {files.map((f) => (
            <li key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9em', fontWeight: 600, color: '#1f8a3b' }}>
              <span style={{ flex: 1, overflowWrap: 'anywhere' }}>
                ✓ {f.name}
                {readable[f.path] === false && (
                  <span className="hint-text" style={{ display: 'block', fontWeight: 400, color: '#8a6d1f' }}>
                    {unreadableWhy(f.name)} — so the order isn&apos;t checked against it. Production still sees it.
                  </span>
                )}
              </span>
              <button type="button" className="btn btn-ghost" style={{ padding: '0 8px' }} aria-label={`Remove ${f.name}`} onClick={() => remove(f.path)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="hint-text" style={{ margin: '4px 0 0', color: '#c0392b', fontWeight: 600, whiteSpace: 'pre-line' }}>{error}</p>}
    </div>
  );
}
