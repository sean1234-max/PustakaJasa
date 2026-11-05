import { useState } from 'react';
import { saveOrderImportAs } from '../lib/storageApi';
import { isAddonInFlight } from '../data/catalog';

// The teacher's kertas kerja behind an order (0110) — one download per file, under its own name,
// for Production to compare with the website. An add-on still waiting has its own, listed apart.
export default function KertasKerjaButtons({ order }) {
  const [error, setError] = useState('');
  const groups = [
    { label: 'Kertas kerja guru', files: order.kertasKerjaFiles || [] },
    { label: 'Kertas kerja guru (Add On)', files: isAddonInFlight(order) ? order.pendingAddonKertasKerja || [] : [] },
  ].filter((g) => g.files.length);
  if (!groups.length) return null;

  const download = async (file) => {
    setError('');
    if (!(await saveOrderImportAs(file.path, file.name))) setError(`Could not download "${file.name}" right now. Please try again.`);
  };
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} style={{ marginTop: 'var(--space-4)' }}>
          <div className="dim">{g.label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 4 }}>
            {g.files.map((f) => (
              <button key={f.path} type="button" className="btn btn-primary" onClick={() => download(f)}>⬇ {f.name}</button>
            ))}
          </div>
        </div>
      ))}
      {error && <div className="login-error" style={{ marginTop: 4 }}>{error}</div>}
    </>
  );
}
