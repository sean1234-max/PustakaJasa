import JSZip from 'jszip';
import { resolveSelempangWarna } from '../data/catalog';

// Selempang (sash) orders in a Word file (Sean, 2026-10-17). Schools write
// a heading such as "SELEMPANG TOKOH AKADEMIK TAHAP 1 (2 PCS)" and draw each
// sash under it as a coloured box with the wording inside. The text alone
// doesn't say the colour, so it is read from the box's own fill:
//   <wps:spPr><a:solidFill><a:srgbClr val="00B0F0"/>     (Word 2010+)
//   <v:rect fillcolor="#00b0f0">                         (older files)
// and matched to the nearest selempang colour (BIRU / HIJAU / KUNING /
// MERAH). A fill too pale, too dark or between two colours is left blank
// for the teacher to pick, never guessed. ACARA is the heading's own name,
// KUANTITI its "(2 PCS)", or the number of boxes when the heading has none.
// A note typed under a sash ("*selempang merah, nak font warna putih") is
// passed on as an import note.

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V_NS = 'urn:schemas-microsoft-com:vml';

const HEADING_RE = /^SELEMPANG\b\s*(.*?)\s*(?:\(\s*(\d+)\s*(?:PCS|PC|UNIT|HELAI|KEPING)?\s*\))?\s*$/i;

const elements = (node) => Array.from(node.childNodes).filter((c) => c.nodeType === 1);
const is = (el, ns, name) => el.namespaceURI === ns && el.localName === name;

// A body paragraph's own text (not the text inside its boxes).
function ownText(p) {
  let text = '';
  const walk = (node) => elements(node).forEach((el) => {
    if (el.namespaceURI === MC_NS && el.localName === 'Fallback') return;
    if (is(el, W_NS, 'txbxContent')) return;
    if (is(el, W_NS, 't')) text += el.textContent;
    else if (is(el, W_NS, 'tab')) text += ' ';
    else walk(el);
  });
  walk(p);
  return text.replace(/\s+/g, ' ').trim();
}

// The fill colour of every box drawn in this paragraph, as "RRGGBB". Word
// keeps an older VML copy of each box under mc:Fallback, which is skipped
// so a box isn't counted twice.
function boxFills(p) {
  const fills = [];
  const walk = (node) => elements(node).forEach((el) => {
    if (el.namespaceURI === MC_NS && el.localName === 'Fallback') return;
    if (is(el, WPS_NS, 'spPr')) {
      const solid = elements(el).find((c) => is(c, A_NS, 'solidFill'));
      const rgb = solid && elements(solid).find((c) => is(c, A_NS, 'srgbClr'));
      if (rgb) fills.push(String(rgb.getAttribute('val') || '').toUpperCase());
      return;
    }
    if (el.namespaceURI === V_NS && el.getAttribute('fillcolor')) {
      const m = /^#?([0-9a-f]{6})\b/i.exec(el.getAttribute('fillcolor'));
      if (m) fills.push(m[1].toUpperCase());
    }
    walk(el);
  });
  walk(p);
  return fills.filter((f) => /^[0-9A-F]{6}$/.test(f));
}

// "00B0F0" -> 'BIRU'; white, grey, black or an in-between hue -> ''.
export function selempangWarnaFromHex(hex) {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return '';
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (max < 0.25 || d / max < 0.35) return '';
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 330) return 'MERAH';
  if (h >= 30 && h < 70) return 'KUNING';
  if (h >= 80 && h < 165) return 'HIJAU';
  if (h >= 175 && h < 255) return 'BIRU';
  return '';
}

// Body paragraphs, top to bottom, including those inside table cells.
function bodyParagraphs(body) {
  const out = [];
  const walk = (node) => elements(node).forEach((el) => {
    if (is(el, W_NS, 'p')) out.push(el);
    else if (!is(el, W_NS, 'txbxContent')) walk(el);
  });
  walk(body);
  return out;
}

// -> { section, notes } where section is the SELEMPANG section
// excelImport.js's parseSelempangSheet returns, or null.
export function readSelempangFromDocument(doc) {
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return { section: null, notes: [] };
  const found = [];
  let cur = null;
  bodyParagraphs(body).forEach((p) => {
    const text = ownText(p);
    const m = text && HEADING_RE.exec(text);
    if (m && m[1]) {
      cur = { acara: m[1].trim(), qty: m[2] ? Number(m[2]) : null, fills: [], notes: [] };
      found.push(cur);
      return;
    }
    if (!cur) return;
    cur.fills.push(...boxFills(p));
    if (text.startsWith('*')) cur.notes.push(text.replace(/^\*\s*/, ''));
  });
  const notes = [];
  const rows = found.map((s) => {
    const colours = [...new Set(s.fills.map(selempangWarnaFromHex))];
    const warna = colours.length === 1 ? colours[0] : '';
    if (!warna) {
      notes.push(colours.length > 1
        ? `Selempang "${s.acara}": the boxes in the file are in different colours — please pick the WARNA by hand.`
        : `Selempang "${s.acara}": couldn't tell the colour from the file — please pick the WARNA by hand.`);
    }
    s.notes.forEach((n) => notes.push(`Selempang "${s.acara}": ${n}`));
    const resolved = resolveSelempangWarna(warna);
    return {
      acara: s.acara,
      warna: resolved?.warna || '',
      warnaCode: resolved?.code || '',
      qty: s.qty ?? s.fills.length,
    };
  }).filter((r) => r.qty > 0);
  if (!rows.length) return { section: null, notes: [] };
  return {
    section: { lines: {}, selempangRows: rows, isSelempangList: true, skipLineDerivation: true, classes: [] },
    notes,
  };
}

// The lines of every text box drawn in this paragraph (Word's older VML copy under mc:Fallback
// skipped), one array per box.
function boxTexts(p) {
  const boxes = [];
  const lineOf = (para) => {
    let t = '';
    const walk = (node) => elements(node).forEach((el) => { if (is(el, W_NS, 't')) t += el.textContent; else if (is(el, W_NS, 'tab')) t += ' '; else walk(el); });
    walk(para);
    return t.replace(/\s+/g, ' ').trim();
  };
  const walk = (node) => elements(node).forEach((el) => {
    if (el.namespaceURI === MC_NS && el.localName === 'Fallback') return;
    if (is(el, W_NS, 'txbxContent')) { boxes.push(elements(el).filter((c) => is(c, W_NS, 'p')).map(lineOf).filter(Boolean)); return; }
    walk(el);
  });
  walk(p);
  return boxes;
}

// Plaques drawn as text boxes (Sean, 2026-10-22: SK LEFTENAN ADNAN prasekolah) — a line
// "WOODEN PLAQUE (PKC 246) – 2 PCS" above, then a box per plaque with its wording and small
// "2 PCS" boxes beside them. Each heading's PCS is shared evenly by the wording boxes under it.
// -> { items: [{ lines, qty, kod }], notes } (items empty when the file isn't drawn this way).
const BOX_HEADING_RE = /\(\s*([^()]+?)\s*\)\s*[–—-]?\s*(\d+)\s*(?:PCS|PC|UNIT|KEPING)\b/i;
const PCS_BOX_RE = /^\d+\s*(?:PCS|PC|UNIT|KEPING)\.?$/i;
export function readPlaqueBoxes(doc) {
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return { items: [], notes: [] };
  const groups = [];
  let cur = null;
  bodyParagraphs(body).forEach((p) => {
    const text = ownText(p);
    const m = text && !HEADING_RE.test(text) ? BOX_HEADING_RE.exec(text) : null;
    if (m) { cur = { kod: m[1].trim(), total: Number(m[2]), boxes: [] }; groups.push(cur); }
    if (!cur) return;
    boxTexts(p).forEach((lines) => { if (lines.length && !(lines.length === 1 && PCS_BOX_RE.test(lines[0]))) cur.boxes.push(lines); });
  });
  const notes = [];
  const items = groups.flatMap((g) => {
    if (!g.boxes.length) return [];
    const even = g.total % g.boxes.length === 0;
    if (!even) notes.push(`"${g.kod}": ${g.total} PCS can't be shared evenly by its ${g.boxes.length} plaques — each is read as 1, please check the quantities.`);
    return g.boxes.map((lines) => ({ lines, qty: even ? g.total / g.boxes.length : 1, kod: g.kod }));
  });
  return { items, notes };
}

// Same, from the .docx file itself (for the AI reader's path). Never throws.
export async function readDocxSelempang(arrayBuffer, { DOMParser: DP = globalThis.DOMParser } = {}) {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file('word/document.xml')?.async('text');
    if (!xml) return { section: null, notes: [] };
    return readSelempangFromDocument(new DP().parseFromString(xml, 'application/xml'));
  } catch {
    return { section: null, notes: [] };
  }
}
