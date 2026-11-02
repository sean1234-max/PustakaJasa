// Plak Preview (Sean, 2026-11-02): one plaque of each Jenis Plak (and layout) in the block, drawn on its
// .ai's picture with the order's own words — the first CSV row of that Jenis Plak, the same rows Generate
// AI File makes, so a change in the Reference Sample (words, line order) shows at once. Layout rules:
// utils/plakPreview.js; templates: public/plak-preview (scripts/plak-preview). Crystals have their own.
import { useEffect, useMemo, useState } from 'react';
import { CSV_COLUMNS, buildCsvRows, getOrderJenisPlakGroups, isCrystalCode } from '../utils/exportCsv';
import { FONTS, fileForCode, layoutPlaque, pickTemplate, templateNameFor } from '../utils/plakPreview';
import { A4, jpegPagesToPdf } from '../utils/simplePdf';
import { downloadBinaryFile } from '../utils/downloadBlob';

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

// one sample laid out: its words (pt, y down) and the box around the anchor and picture
function sceneOf({ entry, template, row }) {
  const { fields } = layoutPlaque(row, template, { trofi: /TROFI/i.test(entry.file), measure });
  const [aw, ah] = template.anchor;
  const pic = entry.picture.box; // [l, t, r, b], y up
  const l = Math.min(pic[0], -aw / 2);
  const t = Math.max(pic[1], ah / 2);
  return {
    fields, pic, l, t, w: Math.max(pic[2], aw / 2) - l, h: t - Math.min(pic[3], -ah / 2),
    src: `${BASE}${encodeURIComponent(entry.picture.png)}`,
  };
}

const anchorOf = (align) => (align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle');

function PlakSvg({ sample }) {
  const { fields, pic, l, t, w, h, src } = sceneOf(sample);
  return (
    <svg viewBox={`${l} ${-t} ${w} ${h}`} style={{ width: '100%', display: 'block' }} role="img" aria-label={`${sample.jenisPlak} preview`}>
      <image href={src} x={pic[0]} y={-pic[1]} width={pic[2] - pic[0]} height={pic[1] - pic[3]} preserveAspectRatio="none" />
      {fields.map((f) => f.lines.map((line, i) => (
        <text
          key={`${f.field}-${i}`} x={f.x} y={f.baselines[i]} textAnchor={anchorOf(f.align)}
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

// ------------------------------------------------------------------ Download PDF
const PX_PER_PT = 3;
const MARGIN = 36;
const GAP = 18;
const CAPTION = 14;
const COLUMNS = 2;

const loadImage = (src) => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error(`Couldn't load ${src}`));
  img.src = src;
});

// the sample drawn on the page canvas at (x, y) pt, `width` pt wide; returns its height in pt
function drawSample(ctx, sample, img, x, y, width) {
  const { fields, pic, l, t, w, h } = sceneOf(sample);
  const s = width / w;
  ctx.fillStyle = '#333';
  ctx.font = `600 9px ${FONTS.line.family}`;
  ctx.textAlign = 'left';
  ctx.fillText(sample.jenisPlak, x, y + 9);
  const top = y + CAPTION;
  ctx.drawImage(img, x + (pic[0] - l) * s, top + (t - pic[1]) * s, (pic[2] - pic[0]) * s, (pic[1] - pic[3]) * s);
  fields.forEach((f) => f.lines.forEach((line, i) => {
    ctx.font = `${f.font.weight} ${f.size * s}px ${f.font.family}`;
    ctx.textAlign = f.align === 'left' ? 'left' : f.align === 'right' ? 'right' : 'center';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${f.tracking ? (f.tracking / 1000) * f.size * s : 0}px`;
    const px = x + (f.x - l) * s;
    const py = top + (f.baselines[i] + t) * s;
    ctx.fillStyle = f.color;
    ctx.fillText(line, px, py);
    if (f.stroke) { ctx.strokeStyle = '#000'; ctx.lineWidth = f.stroke * s; ctx.strokeText(line, px, py); }
  }));
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return CAPTION + h * s;
}

// A4 pages, two plaques a row, the order named at the top of each page
async function plakPdf(samples, title) {
  const images = await Promise.all(samples.map((smp) => loadImage(sceneOf(smp).src)));
  const colW = (A4.width - 2 * MARGIN - (COLUMNS - 1) * GAP) / COLUMNS;
  const pages = [];
  let ctx = null;
  let canvas = null;
  let y = 0;
  const finishPage = async () => {
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  };
  const newPage = async () => {
    if (canvas) await finishPage();
    canvas = document.createElement('canvas');
    canvas.width = Math.round(A4.width * PX_PER_PT);
    canvas.height = Math.round(A4.height * PX_PER_PT);
    ctx = canvas.getContext('2d');
    ctx.scale(PX_PER_PT, PX_PER_PT);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, A4.width, A4.height);
    ctx.fillStyle = '#000';
    ctx.font = `700 12px ${FONTS.line.family}`;
    ctx.textAlign = 'left';
    ctx.fillText(title, MARGIN, MARGIN);
    y = MARGIN + GAP;
  };
  await newPage();
  for (let i = 0; i < samples.length; i += COLUMNS) {
    const row = samples.slice(i, i + COLUMNS);
    const rowH = Math.max(...row.map((smp) => CAPTION + sceneOf(smp).h * (colW / sceneOf(smp).w)));
    if (y + rowH > A4.height - MARGIN && y > MARGIN + GAP) await newPage();
    row.forEach((smp, k) => drawSample(ctx, smp, images[i + k], MARGIN + k * (colW + GAP), y, colW));
    y += rowH + GAP;
  }
  await finishPage();
  return jpegPagesToPdf(pages);
}

export default function PlakPreview({ order }) {
  const [manifest, setManifest] = useState(null);
  const [pdf, setPdf] = useState({ busy: false, error: '' });
  const fontsReady = useFontsReady();
  useEffect(() => { let live = true; loadManifest().then((m) => { if (live) setManifest(m); }); return () => { live = false; }; }, []);
  const { samples, missing } = useMemo(() => plakSamplesOf(order, manifest), [order, manifest]);
  if (!manifest || !fontsReady || (samples.length === 0 && missing.length === 0)) return null;
  const name = [order.id, order.sekolah].filter(Boolean).join(' ');
  const download = async () => {
    setPdf({ busy: true, error: '' });
    try {
      const bytes = await plakPdf(samples, `Plak Preview${name ? ` — ${name}` : ''}`);
      downloadBinaryFile(`${name || 'Order'} - Plak Preview.pdf`.replace(/[\\/:*?"<>|]+/g, ' '), bytes, 'application/pdf');
      setPdf({ busy: false, error: '' });
    } catch (err) {
      console.error('Plak Preview PDF failed:', err);
      setPdf({ busy: false, error: "Couldn't make the PDF — please try again." });
    }
  };
  return (
    <div className="no-print" style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="card-kicker">Plak Preview</div>
        {samples.length > 0 && (
          <button type="button" className="btn btn-secondary" disabled={pdf.busy} onClick={download}>
            {pdf.busy ? 'Making PDF…' : 'Download PDF'}
          </button>
        )}
      </div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        One plaque of each Jenis Plak, with its first line of words — close to the real plaque; the AI file is final.
      </p>
      {pdf.error && <p className="hint-text" style={{ color: '#c0392b', fontWeight: 600 }}>{pdf.error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
        {samples.map((s) => (
          <figure key={s.key} style={{ margin: 0 }}>
            <figcaption className="hint-text" style={{ margin: '0 0 var(--space-1)', fontWeight: 600 }}>{s.jenisPlak}</figcaption>
            <PlakSvg sample={s} />
          </figure>
        ))}
      </div>
      {missing.length > 0 && <p className="hint-text">No preview yet for: {missing.join(', ')}</p>}
    </div>
  );
}
