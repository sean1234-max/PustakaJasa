// The "file structure map" for a PDF order (universal file-reader plan,
// phase 2: text PDFs). Built in the browser with pdf.js from the PDF's own
// text layer — no OCR, so a scan or photo has no text here and is refused.
//
// Every piece of text becomes a numbered SEGMENT ("p1s12") with its page
// and position. A segment is a run of text on one line with no wide gap in
// it, so a 5-across grid of finished labels splits into 5 segments per
// line instead of one long jumbled line. The AI (read-order-file, kind
// "pdf") answers with segment ids plus the exact text it took from each;
// pdfMapping.js checks every quoted text really is inside that segment
// before anything reaches an order.

export const PDF_IR_VERSION = 1;
const MAX_SEGMENTS = 4000;

// pdf.js is passed in (browser: the normal build with its worker; tests:
// the legacy build) so this file has no bundler-specific import.
export async function extractPdfPages(data, pdfjs) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => typeof it.str === 'string' && it.str.trim())
      .map((it) => {
        const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
        return { str: it.str, x: it.transform[4], y: height - it.transform[5], w: it.width, size };
      });
    pages.push({ page: n, width, height, items });
  }
  await task.destroy();
  return pages;
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

// Items -> lines (same baseline, within half a font size) -> segments (a
// horizontal gap wider than ~1.2 font sizes starts a new segment).
export function buildPdfIr(pages) {
  const segments = [];
  let truncated = false;
  pages.forEach(({ page, items }) => {
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    sorted.forEach((it) => {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.size, it.size) * 0.5));
      if (line) line.items.push(it);
      else lines.push({ y: it.y, size: it.size, items: [it] });
    });
    lines.sort((a, b) => a.y - b.y);
    let n = 0;
    lines.forEach((line) => {
      const its = line.items.sort((a, b) => a.x - b.x);
      let cur = null;
      its.forEach((it) => {
        const gap = cur ? it.x - cur.end : Infinity;
        if (cur && gap <= Math.max(it.size, cur.size) * 1.2) {
          cur.text += (gap > it.size * 0.15 && !cur.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
          cur.end = Math.max(cur.end, it.x + it.w);
        } else {
          if (cur) segments.push(cur);
          cur = { page, x: it.x, y: line.y, end: it.x + it.w, text: it.str };
        }
      });
      if (cur) segments.push(cur);
    });
    // ids are per page, in reading order
    segments.filter((s) => s.page === page && !s.id).forEach((s) => { s.id = `p${page}s${++n}`; });
  });
  const out = segments
    .map((s) => ({ id: s.id, page: s.page, x: Math.round(s.x), y: Math.round(s.y), text: clean(s.text) }))
    .filter((s) => s.text);
  if (out.length > MAX_SEGMENTS) truncated = true;
  return { irVersion: PDF_IR_VERSION, segments: out.slice(0, MAX_SEGMENTS), pageCount: pages.length, truncated };
}

// Plain text the model reads: one row per printed line, every segment
// tagged with its id and x position. Deterministic, so the same PDF always
// renders the same text (the cache key).
export function renderPdfIrText(ir) {
  const out = [];
  let page = 0;
  let rowY = null;
  let row = [];
  const flush = () => { if (row.length) out.push(`y=${rowY}: ${row.join('  ')}`); row = []; };
  ir.segments.forEach((s) => {
    if (s.page !== page) { flush(); page = s.page; rowY = null; out.push(`=== PAGE ${page} ===`); }
    if (rowY !== s.y) { flush(); rowY = s.y; }
    row.push(`[${s.id} x=${s.x}] ${s.text}`);
  });
  flush();
  return out.join('\n');
}
