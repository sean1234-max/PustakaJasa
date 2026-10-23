import { useRef, useState } from 'react';
import { useAppState } from '../state/useAppState';
import { getOrderImportUrl } from '../lib/storageApi';
import { formatDateTime } from '../data/catalog';

// For when Production spots a qty/wording problem in the teacher's
// original FORM ANUGERAH file — lets them upload a corrected copy, kept
// separate from the teacher's own import_file_path so both stay on record.
// The corrected file becomes the order itself (Sean, 2026-10-23): its items,
// QTY and total are saved over the order and stock follows (AppState.jsx
// uploadCorrectedExcel). When the total changes, Production is told to let
// Store Admin update an invoice already issued.
export default function CorrectedExcelControl({ order, onUploaded }) {
  const { uploadCorrectedExcel } = useAppState();
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloadErr, setDownloadErr] = useState('');
  const [totalNote, setTotalNote] = useState('');

  const downloadCorrected = async () => {
    setDownloadErr('');
    const url = await getOrderImportUrl(order.correctedImportFilePath);
    if (!url) { setDownloadErr('Could not download the file right now. Please try again.'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = order.correctedImportFileName || 'corrected.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setTotalNote('');
    const res = await uploadCorrectedExcel(order.id, file);
    setBusy(false);
    if (res.ok && Math.abs(res.totalAmount - res.oldTotal) > 0.005) {
      setTotalNote(`The order's total changed from RM ${res.oldTotal.toFixed(2)} to RM ${res.totalAmount.toFixed(2)}`
        + (order.invoiceId ? ` — tell Store Admin to update invoice ${order.invoiceId}.` : '.'));
    }
    if (res.ok) onUploaded?.(res.items, res.warnings);
    else setError(res.message || 'Could not upload this file.');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div className="dim">Corrected Excel</div>
      {order.correctedImportFilePath ? (
        <>
          <p className="hint-text" style={{ margin: '4px 0' }}>
            Uploaded {formatDateTime(order.correctedImportUploadedAt)} — the order (QTY, prices, total) and every export below now follow this file, not the teacher's original.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={downloadCorrected}>
              ⬇ {order.correctedImportFileName || 'Download corrected file'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              {busy ? 'Uploading…' : 'Upload a Newer Correction'}
            </button>
          </div>
          {downloadErr && <div className="login-error" style={{ marginTop: 4 }}>{downloadErr}</div>}
        </>
      ) : (
        <>
          <p className="hint-text" style={{ margin: '4px 0' }}>
            Spotted a qty or wording problem in the teacher's file? Upload the corrected copy here — the order's QTY, total and every export below switch to it.
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {busy ? 'Uploading…' : '⬆ Upload Corrected Excel'}
          </button>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.docx"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {totalNote && <p className="hint-text" style={{ marginTop: 4, color: '#8a6d00', fontWeight: 600 }}>{totalNote}</p>}
      {error && <div className="login-error" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}
