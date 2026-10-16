import JSZip from 'jszip';

// The "file structure map" for a Word order the rule reader
// (docxImport.js) can't place: a sample label in a text box followed by a
// name list, a table without a WORDING column, and so on. Built in the
// browser from the .docx itself, in the same shape as pdfIr.js's map, so
// the AI reader and pdfMapping.js treat it exactly like a text PDF: every
// piece of text is a numbered segment ("p1s12"), and the AI can only point
// at segments, never type a line.
//
// Layout (no real page geometry in a .docx): each paragraph is one printed
// line; a table row is one line with each cell at its own x (one column =
// 100); a cell with several lines carries on below at the same x. Text in a
// text box (a sample label drawn as a shape) is read once — Word also
// stores a fallback copy of every shape, which is skipped.

export const DOCX_IR_VERSION = 1;
const MAX_SEGMENTS = 4000;
const LINE = 14;
const COL = 100;
const BOX_INDENT = 50;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const CONTAINERS = new Set(['sdt', 'sdtContent', 'customXml', 'smartTag']);

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const elements = (node) => Array.from(node.childNodes).filter((c) => c.nodeType === 1);
const isW = (el, name) => el.namespaceURI === W_NS && el.localName === name;

// A paragraph's own text (w:br/w:cr = new line, w:tab = space), and the text
// boxes inside it, read separately.
function paragraphParts(p) {
  let text = '';
  const boxes = [];
  const walk = (node) => elements(node).forEach((el) => {
    if (el.namespaceURI === MC_NS && el.localName === 'Fallback') return;
    if (isW(el, 'txbxContent')) boxes.push(el);
    else if (isW(el, 't')) text += el.textContent;
    else if (isW(el, 'br') || isW(el, 'cr')) text += '\n';
    else if (isW(el, 'tab')) text += ' ';
    else walk(el);
  });
  walk(p);
  return { text, boxes };
}

function gridSpan(tc) {
  const pr = elements(tc).find((el) => isW(el, 'tcPr'));
  const span = pr && elements(pr).find((el) => isW(el, 'gridSpan'));
  const n = Number(span?.getAttributeNS(W_NS, 'val') || span?.getAttribute('w:val'));
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export function buildDocxIrFromDocument(doc) {
  const raw = [];
  let y = 0;
  const push = (x, text, at) => { const t = clean(text); if (t) raw.push({ x, y: at, text: t }); };

  // Paragraphs and tables of a body, cell or text box -> lines from `y` on.
  const block = (container, x) => elements(container).forEach((el) => {
    if (isW(el, 'p')) paragraph(el, x);
    else if (isW(el, 'tbl')) table(el, x);
    else if (el.namespaceURI === W_NS && CONTAINERS.has(el.localName)) block(el, x);
  });
  const paragraph = (p, x) => {
    const { text, boxes } = paragraphParts(p);
    text.split('\n').forEach((line) => { if (line.trim()) { push(x, line, y); y += LINE; } });
    boxes.forEach((box) => block(box, x + BOX_INDENT));
  };
  const table = (tbl, x) => elements(tbl).filter((el) => isW(el, 'tr')).forEach((tr) => {
    const top = y;
    let bottom = y + LINE;
    let col = 0;
    elements(tr).filter((el) => isW(el, 'tc')).forEach((tc) => {
      y = top;
      block(tc, x + col * COL);
      bottom = Math.max(bottom, y);
      col += gridSpan(tc);
    });
    y = bottom;
  });

  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (body) block(body, 0);
  // Reading order (top to bottom, then left to right), like a PDF page.
  raw.sort((a, b) => a.y - b.y || a.x - b.x);
  const segments = raw.slice(0, MAX_SEGMENTS).map((s, i) => ({ id: `p1s${i + 1}`, page: 1, ...s }));
  return { irVersion: DOCX_IR_VERSION, segments, pageCount: 1, truncated: raw.length > MAX_SEGMENTS };
}

// null when the file isn't a readable .docx. `DOMParser` is injectable for
// tests (node has none).
export async function buildDocxIr(arrayBuffer, { DOMParser: DP = globalThis.DOMParser } = {}) {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file('word/document.xml')?.async('text');
    if (!xml) return null;
    const doc = new DP().parseFromString(xml, 'application/xml');
    if (!doc?.documentElement || doc.getElementsByTagName('parsererror').length > 0) return null;
    return buildDocxIrFromDocument(doc);
  } catch {
    return null;
  }
}
