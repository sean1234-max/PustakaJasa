// Plak Preview (Sean, 2026-11-02): one plaque of each Jenis Plak (and layout) in the block, drawn on its
// .ai's picture with the order's own words — the first CSV row of that Jenis Plak, the same rows Generate
// AI File makes, so a change in the Reference Sample (words, line order) shows at once. Layout rules:
// utils/plakPreview.js; templates: public/plak-preview (scripts/plak-preview). Crystals have their own.
import { useEffect, useMemo, useState } from 'react';
import { CSV_COLUMNS, buildCsvRows, getOrderJenisPlakGroups, isCrystalCode } from '../utils/exportCsv';
import { FONTS, fileForCode, layoutPlaque, pickTemplate, templateNameFor } from '../utils/plakPreview';

const BASE = '/plak-preview/';
let manifestPromise = null;
const loadManifest = () => {
  manifestPromise = manifestPromise || fetch(`${BASE}templates.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return manifestPromise;
};

const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const measure = (text, size, font, tracking = 0) => {
  if (!ctx) return 0;
  ctx.font = `${font.weight} ${size}px ${font.family}`;
  return ctx.measureText(text).width + (tracking / 1000) * size * Math.max(0, [...text].length - 1);
};

// the fonts measured must be loaded first, or every line fits at the fallback's width
function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all(Object.values(FONTS).map((f) => document.fonts.load(`${f.weight} 12px ${f.family}`).catch(() => null)))
      .then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  return ready;
}

// one sample per Jenis Plak + layout: its first row
export function plakSamplesOf(order, manifest) {
  if (!order || !manifest) return { samples: [], missing: [] };
  const samples = [];
  const missing = [];
  getOrderJenisPlakGroups(order).filter((g) => !isCrystalCode(g.jenisPlak)).forEach((g) => {
    const file = fileForCode(g.jenisPlak, manifest);
    const entry = manifest.files.find((f) => f.file === file);
    if (!entry) { missing.push(g.jenisPlak); return; }
    const seen = new Set();
    buildCsvRows(order, null, g.items).rows
      .map((r) => Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, r[i] ?? ''])))
      .filter((row) => !row.invoice_gap && CSV_COLUMNS.slice(0, 5).some((c) => String(row[c]).trim()))
      .forEach((row) => {
        const name = pickTemplate(entry.templates, templateNameFor(row));
        if (!name || seen.has(name)) return;
        seen.add(name);
        samples.push({ key: `${g.jenisPlak}::${name}`, jenisPlak: g.jenisPlak, entry, template: entry.templates[name], row });
      });
  });
  return { samples, missing };
}

function PlakSvg({ entry, template, row }) {
  const trofi = /TROFI/i.test(entry.file);
  const { fields } = layoutPlaque(row, template, { trofi, measure });
  const [aw, ah] = template.anchor;
  const pic = entry.picture.box; // [l, t, r, b], y up
  const l = Math.min(pic[0], -aw / 2);
  const t = Math.max(pic[1], ah / 2);
  const w = Math.max(pic[2], aw / 2) - l;
  const h = t - Math.min(pic[3], -ah / 2);
  return (
    <svg viewBox={`${l} ${-t} ${w} ${h}`} style={{ width: '100%', display: 'block' }} role="img" aria-label={`${row.jenis_plak} preview`}>
      <image href={`${BASE}${encodeURIComponent(entry.picture.png)}`} x={pic[0]} y={-pic[1]} width={pic[2] - pic[0]} height={pic[1] - pic[3]} preserveAspectRatio="none" />
      {fields.map((f) => f.lines.map((line, i) => (
        <text
          key={`${f.field}-${i}`} x={f.x} y={f.baselines[i]}
          textAnchor={f.align === 'left' ? 'start' : f.align === 'right' ? 'end' : 'middle'}
          fill={f.color} fontFamily={f.font.family} fontWeight={f.font.weight} fontSize={f.size}
          letterSpacing={f.tracking ? (f.tracking / 1000) * f.size : undefined}
          stroke={f.stroke ? '#000' : undefined} strokeWidth={f.stroke || undefined}
        >
          {line}
        </text>
      )))}
    </svg>
  );
}

export default function PlakPreview({ order }) {
  const [manifest, setManifest] = useState(null);
  const fontsReady = useFontsReady();
  useEffect(() => { let live = true; loadManifest().then((m) => { if (live) setManifest(m); }); return () => { live = false; }; }, []);
  const { samples, missing } = useMemo(() => plakSamplesOf(order, manifest), [order, manifest]);
  if (!manifest || !fontsReady || (samples.length === 0 && missing.length === 0)) return null;
  return (
    <div className="no-print" style={{ marginTop: 'var(--space-6)' }}>
      <div className="card-kicker">Plak Preview</div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        One plaque of each Jenis Plak, with your first line of words — close to the real plaque; the AI file is final.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
        {samples.map((s) => (
          <figure key={s.key} style={{ margin: 0 }}>
            <figcaption className="hint-text" style={{ margin: '0 0 var(--space-1)', fontWeight: 600 }}>{s.jenisPlak}</figcaption>
            <PlakSvg entry={s.entry} template={s.template} row={s.row} />
          </figure>
        ))}
      </div>
      {missing.length > 0 && <p className="hint-text">No preview yet for: {missing.join(', ')}</p>}
    </div>
  );
}
