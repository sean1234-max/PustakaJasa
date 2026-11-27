import * as XLSX from 'xlsx';
import { buildDocxIr } from './docxIr';
import { buildPdfIr, extractPdfPages } from './pdfIr';

// The printed lines of a kertas kerja the salesman uploaded (Sean, 2026-11-26), read by the website — no AI:
// a Word file's paragraphs and table rows (docxIr.js), an Excel's rows on every visible sheet, a text PDF's
// printed lines (pdfIr.js). A scan or a photo has no text: null, and the order goes on without the check.
// -> ['cell | cell | …', …]
const MAX_LINES = 4000;

const rowsOfSegments = (segments) => {
  const rows = new Map();
  segments.forEach((s) => { const k = `${s.page}:${s.y}`; rows.set(k, [...(rows.get(k) || []), s.text]); });
  return [...rows.values()].map((cells) => cells.join(' | '));
};

function excelLines(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  return wb.SheetNames
    .filter((n, i) => !wb.Workbook?.Sheets?.[i]?.Hidden)
    .flatMap((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })
      .map((row) => row.map((c) => String(c ?? '').trim()).filter(Boolean).join(' | ')));
}

// `pdfjs`: pdf.js (pdfImport.js loadPdfjs in the browser, the legacy build in tests); `DOMParser` for Word in tests
export async function kertasKerjaLines(buffer, name, { DOMParser, pdfjs } = {}) {
  try {
    let lines = null;
    if (/\.xlsx$/i.test(name)) lines = excelLines(buffer);
    else if (/\.docx$/i.test(name)) {
      const ir = await buildDocxIr(buffer, DOMParser ? { DOMParser } : undefined);
      lines = ir ? rowsOfSegments(ir.segments) : null;
    } else if (/\.pdf$/i.test(name) && pdfjs) lines = rowsOfSegments(buildPdfIr(await extractPdfPages(buffer, pdfjs)).segments);
    const filled = (lines || []).map((l) => l.trim()).filter(Boolean);
    return filled.length ? filled.slice(0, MAX_LINES) : null;
  } catch (err) {
    console.error(`reading the kertas kerja "${name}" failed:`, err);
    return null;
  }
}
