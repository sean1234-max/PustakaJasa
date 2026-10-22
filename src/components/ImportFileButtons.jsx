import { useState } from 'react';
import { saveOrderImportAs, fetchOrderImportBlob } from '../lib/storageApi';
import { buildOrderImportFilename, sanitizeFilenamePart } from '../utils/exportCsv';
import { orderImportFiles } from '../utils/importFiles';
import { buildDraftFromOrder } from '../utils/computeBlocks';
import { draftPlaques } from '../utils/draftForm';
import { FORM_TEMPLATE_URL } from '../utils/formRoundTrip';
import { downloadBinaryFile } from '../utils/downloadBlob';
import { useAppState } from '../state/useAppState';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// One download button per file the teacher uploaded for this order — Excel,
// Word or PDF, as uploaded (most orders have one; a draft that imported a
// second file keeps both — 0083). Each is saved as
// "<order id>-<school>(<salesman>)[-2].<ext>".
// `websiteExcel` (Production, Sean 2026-10-20): one more button, the order as
// the website has it now written into the FORM ANUGERAH form (the same form
// New Order's "Download Excel (FORM ANUGERAH)" makes). Production (`websiteExcel`) gets the
// uploads as one "Download All Files" zip instead of a button each (Sean, 2026-10-22: a kertas
// kerja in several files).
export default function ImportFileButtons({ order, buttonClassName, errorClassName, websiteExcel = false }) {
  const { state } = useAppState();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const files = orderImportFiles(order);
  const download = async (file, i) => {
    setError('');
    if (!(await saveOrderImportAs(file.path, buildOrderImportFilename(order, file, i)))) {
      setError('Could not download the file right now. Please try again.');
    }
  };
  const downloadAll = async () => {
    setError('');
    setBusy(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const names = new Set();
      for (const [i, file] of files.entries()) {
        const blob = await fetchOrderImportBlob(file.path);
        if (!blob) { setError(`Could not download "${file.name}" right now. Please try again.`); return; }
        // the teacher's own file names; a repeated name gets the order file's number in front
        const name = names.has(file.name) ? `${i + 1}-${file.name}` : file.name;
        names.add(name);
        zip.file(name, blob);
      }
      const zipName = buildOrderImportFilename(order, { path: '' }, 0).replace(/\.xlsx$/, '.zip');
      downloadBinaryFile(zipName, await zip.generateAsync({ type: 'blob' }), 'application/zip');
    } catch (err) {
      console.error('Could not zip the order files:', err);
      setError('Could not download the files right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const downloadWebsiteExcel = async () => {
    setError('');
    setBusy(true);
    try {
      const draft = { ...order, ...buildDraftFromOrder(order), plakCatalog: state.plakCatalog };
      const { plaques, selempang, front, priceOf } = draftPlaques(draft);
      if (!plaques.length && !selempang.length) { setError('This order has no plaques to put in the form.'); return; }
      const res = await fetch(FORM_TEMPLATE_URL);
      if (!res.ok) { setError('The blank FORM ANUGERAH template is not on the site yet — please ask an administrator.'); return; }
      const { fillOrderTemplate } = await import('../utils/templateExport');
      const out = await fillOrderTemplate(await res.arrayBuffer(), { plaques, selempang, front, priceOf });
      const name = `${sanitizeFilenamePart(order.id || '')}-${sanitizeFilenamePart(order.sekolah || 'Order')} (WEBSITE FORM ANUGERAH).xlsx`;
      downloadBinaryFile(name, out.buffer, XLSX_MIME);
    } catch (err) {
      console.error('Could not fill the FORM ANUGERAH for the order:', err);
      setError('Could not make the Excel form. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 4 }}>
        {websiteExcel && files.length > 1 && (
          <button type="button" className={buttonClassName} disabled={busy} onClick={downloadAll}>
            {busy ? 'Working…' : `⬇ Download All Files (${files.length})`}
          </button>
        )}
        {!(websiteExcel && files.length > 1) && files.map((file, i) => (
          <button key={file.path} type="button" className={buttonClassName} onClick={() => download(file, i)}>
            ⬇ {buildOrderImportFilename(order, file, i)}
          </button>
        ))}
        {websiteExcel && (
          <button type="button" className={buttonClassName} disabled={busy} onClick={downloadWebsiteExcel}>
            {busy ? 'Filling the form…' : '⬇ Website Excel (FORM ANUGERAH)'}
          </button>
        )}
      </div>
      {error && <div className={errorClassName} style={{ marginTop: 4 }}>{error}</div>}
    </>
  );
}
