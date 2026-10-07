import { useState } from 'react';
import { saveOrderImportAs } from '../lib/storageApi';
import { buildOrderImportFilename } from '../utils/exportCsv';
import { orderImportFiles } from '../utils/importFiles';

// One download button per Excel the teacher uploaded for this order (most
// orders have one; a draft that imported a second file keeps both — 0083).
// Each is saved as "<order id>-<school>(<salesman>)[-2].xlsx".
export default function ImportFileButtons({ order, buttonClassName, errorClassName }) {
  const [error, setError] = useState('');
  const files = orderImportFiles(order);
  const download = async (file, i) => {
    setError('');
    if (!(await saveOrderImportAs(file.path, buildOrderImportFilename(order, file, i)))) {
      setError('Could not download the file right now. Please try again.');
    }
  };
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 4 }}>
        {files.map((file, i) => (
          <button key={file.path} type="button" className={buttonClassName} onClick={() => download(file, i)}>
            ⬇ {buildOrderImportFilename(order, file, i)}
          </button>
        ))}
      </div>
      {error && <div className={errorClassName} style={{ marginTop: 4 }}>{error}</div>}
    </>
  );
}
