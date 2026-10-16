// How each crystal in an order will look, drawn by Crystal Studio (public/crystal/, served by this
// website, so it uses the same login). This frames Crystal Studio's preview page and posts it the
// order's crystal rows — the rows a Combined CSV would have, but only the "CRYSTAL / …" Jenis Plak,
// which the Combined CSV itself leaves out (Sean, 2026-10-14). The preview draws each row on its
// design and shows this order's own changes ("Save for this order only").
//
// role: 'production' (everything), 'teacher' (✎ Edit: change look and place for this order),
// 'view' (Sales: look only). The database still decides what each account may save.
//
// Artwork confirmation (Sean, 2026-10-14): shown above the preview. Until it is confirmed,
// Production only looks (no download / Illustrator); onConfirmArtwork (Sales) adds the
// Confirm Artwork button. showArtwork=false for an order not placed yet (the Cart).
import { useEffect, useMemo, useRef, useState } from 'react';
import ConfirmButton from './ConfirmButton';
import { CSV_COLUMNS, getOrderJenisPlakGroups, buildCsvRows, isCrystalCode } from '../utils/exportCsv';
import { formatDate, toMalaysiaDay } from '../data/catalog';

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

function ArtworkStatus({ order, onConfirmArtwork }) {
  const [error, setError] = useState('');
  if (order.artworkConfirmedAt) {
    const by = order.artworkConfirmedByName === 'Existing order' ? 'existing order'
      : [order.artworkConfirmedByName, order.artworkConfirmedByRole].filter(Boolean).join(', ');
    return (
      <p className="hint-text" style={{ color: '#2f6b4f', fontWeight: 600 }}>
        ✓ Artwork confirmed{by ? ` (${by})` : ''} · {formatDate(toMalaysiaDay(order.artworkConfirmedAt))}
      </p>
    );
  }
  return (
    <div style={{ margin: 'var(--space-2) 0' }}>
      <p className="hint-text" style={{ color: '#b45309', fontWeight: 600, margin: 0 }}>
        Artwork not confirmed yet — the crystals can&apos;t be made until it is.
      </p>
      {onConfirmArtwork && (
        <ConfirmButton
          label="Confirm Artwork" style={{ marginTop: 'var(--space-2)' }}
          question="Is the crystal artwork in the preview below correct (design, words, logo)?"
          confirmLabel="Yes, confirm" cancelLabel="Not yet"
          onConfirm={async () => setError((await onConfirmArtwork()) || '')}
        />
      )}
      {error && <p className="hint-text" style={{ color: '#b91c1c' }}>{error}</p>}
    </div>
  );
}

// makeAi: bump it to have the preview open every crystal in Illustrator (Production's Generate AI
// File), saved in makeAiFolder (the plaques' OUTPUT folder) when given.
// onMakeAiSent: called once the crystals of a makeAi are handed to the helper (or couldn't be).
export default function CrystalPreview({ order, role = 'view', selected = null, onConfirmArtwork = null, showArtwork = true, makeAi = 0, makeAiFolder = '', onMakeAiSent = null }) {
  const frame = useRef(null);
  const sentRef = useRef(onMakeAiSent);
  sentRef.current = onMakeAiSent;
  const box = useRef(null);
  const [status, setStatus] = useState('waiting'); // waiting | ready | missing
  const [height, setHeight] = useState(0);
  const [readyTick, setReadyTick] = useState(0); // counts "ready"s: a reloaded preview needs the rows again
  const rows = useMemo(() => crystalRowsOf(order), [order]);
  const reserved = useMemo(() => reservedCrystalsOf(order), [order]);
  // Production makes the crystals only once the artwork is confirmed (it can still ✎ Edit them)
  const locked = role === 'production' && showArtwork && !order?.artworkConfirmedAt;
  const src = `${STUDIO_PATH}/preview.html?theme=light&role=${encodeURIComponent(role)}${locked ? '&locked=1' : ''}`;

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || !frame.current || e.source !== frame.current.contentWindow) return;
      if (e.data?.type === 'crystal-studio-ready') { setStatus('ready'); setReadyTick((n) => n + 1); }
      if (e.data?.type === 'crystal-studio-height') setHeight(e.data.height);
      if (e.data?.type === 'crystal-make-ai-sent') sentRef.current?.();
    };
    window.addEventListener('message', onMessage);
    const t = setTimeout(() => setStatus((s) => (s === 'waiting' ? 'missing' : s)), READY_TIMEOUT_MS);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t); };
  }, []);

  // (re)send the rows whenever the preview is ready or the order changes
  useEffect(() => {
    if (status !== 'ready' || !order) return;
    frame.current?.contentWindow?.postMessage({ type: 'crystal-rows', rows, order: order.id, school: order.sekolah || '', logo: order.logoDataUrl || null }, window.location.origin);
  }, [status, readyTick, rows, order]);

  useEffect(() => {
    if (status !== 'ready' || !makeAi) return;
    frame.current?.contentWindow?.postMessage({ type: 'crystal-make-ai', folder: makeAiFolder }, window.location.origin);
  }, [status, makeAi]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new click sends

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
      {showArtwork && <ArtworkStatus order={order} onConfirmArtwork={onConfirmArtwork} />}
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
