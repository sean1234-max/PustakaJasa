import { buildPdfIr, extractPdfPages, renderPdfIrText } from './pdfIr';
import { buildDocxIr } from './docxIr';
import { applyPdfReading } from './pdfMapping';
import { readPdfWithAi } from '../lib/fileReadApi';

// PDF orders (universal file-reader plan, phase 2: text PDFs only). The
// browser pulls the PDF's text and positions out with pdf.js (pdfIr.js),
// the AI reader says which text makes up each plaque (read-order-file,
// kind "pdf"), and pdfMapping.js checks and builds the order from the
// PDF's own text. A Word order the rule reader (docxImport.js) can't
// place goes the same way, from its own structure map (docxIr.js). Same
// return shape as parseWordingDocx: `{ categorized, notes } | { error }`.
// Never throws.

let pdfjsPromise = null;
// pdf.js is large, so it is only loaded the first time a PDF is uploaded.
// The legacy build runs on older browsers (school PCs, older iPads).
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.min.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    }).catch((err) => { pdfjsPromise = null; throw err; });
  }
  return pdfjsPromise;
}

export async function parsePdfOrder(arrayBuffer, fileName) {
  let ir;
  try {
    const pdfjs = await loadPdfjs();
    ir = buildPdfIr(await extractPdfPages(arrayBuffer, pdfjs));
  } catch (err) {
    console.error('Could not read PDF:', err);
    return { error: 'Could not read this PDF — please make sure it is a valid, unlocked .pdf file.' };
  }
  if (ir.segments.length === 0) {
    return { error: 'This PDF has no text in it (it looks like a scan or a photo). Scans and photos are not supported yet — please add the order by hand.' };
  }
  return readWithAi(ir, fileName, 'PDF');
}

// Only called after parseWordingDocx found no order table it knows.
export async function parseDocxOrderWithAi(arrayBuffer, fileName, ruleError) {
  const ir = await buildDocxIr(arrayBuffer);
  if (!ir || ir.segments.length === 0) return { error: ruleError };
  return readWithAi(ir, fileName, 'Word file');
}

async function readWithAi(ir, fileName, what) {
  const res = await readPdfWithAi({ fileName, irText: renderPdfIrText(ir) });
  if (!res.ok) return { error: res.message };
  const { categorized, notes, count } = applyPdfReading(ir, res.reading);
  if (count === 0) return { error: `The AI found no plaques in this ${what}.${notes.length ? ` ${notes.join(' ')}` : ''}` };
  notes.unshift(`This order was read from a ${what} by the AI reader — please check every tab carefully against the ${what} before adding to cart.`);
  return { categorized, notes, klasMatrix: null };
}
