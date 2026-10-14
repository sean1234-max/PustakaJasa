// How each crystal in an order will look, drawn by Crystal Studio (public/crystal/, served by this
// website, so it uses the same login). This frames Crystal Studio's preview page and posts it the
// order's crystal rows — the rows a Combined CSV would have, but only the "CRYSTAL / …" Jenis Plak,
// which the Combined CSV itself leaves out (Sean, 2026-10-14). The preview draws each row on its
// design and shows this order's own changes ("Save for this order only").
//
// role: 'production' (everything), 'teacher' (✎ Edit: change look and place for this order),
// 'view' (Sales: look only). The database still decides what each account may save.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CSV_COLUMNS, getOrderJenisPlakGroups, buildCsvRows, isCrystalCode } from '../utils/exportCsv';

const STUDIO_PATH = '/crystal';
const READY_TIMEOUT_MS = 20000; // reads the designs from the database first

const crystalGroupsOf = (order) => (order ? getOrderJenisPlakGroups(order).filter((g) => isCrystalCode(g.jenisPlak)) : []);

// the order's crystal rows as { event_header, position, …, jenis_plak }
export function crystalRowsOf(order) {
  return crystalGroupsOf(order)
    .flatMap((g) => buildCsvRows(order, null, g.items).rows)
    .map((r) => Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, r[i] ?? ''])));
}

// crystals still "Reserved" (no name yet): left out of the preview, like the CSV — "SA4 / DESIGN C (1)"
export function reservedCrystalsOf(order) {
  return crystalGroupsOf(order)
    .map((g) => ({ jenisPlak: g.jenisPlak, count: buildCsvRows(order, null, g.items).reservedCount }))
    .filter((g) => g.count > 0)
    .map((g) => `${g.jenisPlak.replace(/^CRYSTAL \/\s*/i, '')} (${g.count})`);
}

export default function CrystalPreview({ order, role = 'view', selected = null }) {
  const frame = useRef(null);
  const box = useRef(null);
  const [status, setStatus] = useState('waiting'); // waiting | ready | missing
  const [height, setHeight] = useState(0);
  const rows = useMemo(() => crystalRowsOf(order), [order]);
  const reserved = useMemo(() => reservedCrystalsOf(order), [order]);
  const src = `${STUDIO_PATH}/preview.html?theme=light&role=${encodeURIComponent(role)}`;

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || !frame.current || e.source !== frame.current.contentWindow) return;
      if (e.data?.type === 'crystal-studio-ready') setStatus('ready');
      if (e.data?.type === 'crystal-studio-height') setHeight(e.data.height);
    };
    window.addEventListener('message', onMessage);
    const t = setTimeout(() => setStatus((s) => (s === 'waiting' ? 'missing' : s)), READY_TIMEOUT_MS);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t); };
  }, []);

  // (re)send the rows whenever the preview is ready or the order changes
  useEffect(() => {
    if (status !== 'ready' || !order) return;
    frame.current?.contentWindow?.postMessage({ type: 'crystal-rows', rows, order: order.id, school: order.sekolah || '' }, window.location.origin);
  }, [status, rows, order]);

  // a crystal row picked in the price table: show that design and scroll to it
  useEffect(() => {
    if (status !== 'ready' || !selected) return;
    frame.current?.contentWindow?.postMessage({ type: 'crystal-select', jenis: selected }, window.location.origin);
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [status, selected]);

  if (rows.length === 0 && reserved.length === 0) return null;
  return (
    <div className="no-print" ref={box} style={{ marginTop: 'var(--space-6)' }}>
      <div className="card-kicker">Crystal Preview</div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        Each crystal in this order, drawn on its design with the words filled in.
        {role === 'teacher' && ' To change the font, size or place of a crystal\'s words, pick it and click ✎ Edit, then Save for this order only. To change the words, use Edit Order.'}
      </p>
      {reserved.length > 0 && (
        <p className="hint-text" style={{ color: '#8a6d00', fontWeight: 600 }}>
          Still RESERVED (no name yet) — not shown until the names are in: {reserved.join(', ')}.
        </p>
      )}
      {status === 'missing' && (
        <p className="hint-text" style={{ color: '#b45309' }}>
          The crystal preview couldn&apos;t load. Refresh the page to try again.
        </p>
      )}
      <iframe
        ref={frame} src={src} title="Crystal preview"
        // lets Production's "Open in Illustrator" reach Crystal Studio's program on this computer
        allow="local-network-access; local-network; loopback-network"
        style={{ width: '100%', border: 0, height: status === 'ready' ? height : 0, display: status === 'missing' ? 'none' : 'block' }}
      />
    </div>
  );
}
