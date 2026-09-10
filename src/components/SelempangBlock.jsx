import { SELEMPANG_WARNA } from '../data/catalog';

const WARNA_HINT = SELEMPANG_WARNA.map((w) => `${w.warna} (${w.code})`).join(' · ');

// SELEMPANG (sash) block — ACARA / WARNA / KUANTITI rows, priced at a flat
// RM per unit (blk.selempangUnitPrice). No Reference Sample, no Jenis Plak
// picker: all four colours share one catalog code + one stock pool, and the
// colour a teacher types is only recorded on the line. Rendered by
// OrderCategoryBlock when `blk.selempang` is set, so every screen that
// already shows a category block (New Order, Add On, Amend, all the
// read-only order views) gets it for free.
export default function SelempangBlock({ blk, editable, hideEmptyRows }) {
  const rows = hideEmptyRows ? blk.rows.filter((r) => Number(r.qty) > 0) : blk.rows;
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalHarga = rows.reduce((s, r) => s + (r.rawHarga || 0), 0);
  // Whole-order preview of the shared SELEMPANG pool (computeBlocks looked
  // it up from the full catalog — null when stock tracking isn't enabled);
  // the server RPC is the real guard at submit.
  const stock = blk.selempangStock;
  const overStock = !!stock && totalQty > stock.maxOrderable;
  const canEditText = editable.rowDesc;
  const canEditQty = editable.rowQty;
  const canAddRemove = editable.addRemoveRows;

  return (
    <div>
      <div className="card-kicker">Selempang</div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Acara</th>
              <th style={{ width: 200 }}>Warna</th>
              <th style={{ width: 110 }}>Kuantiti</th>
              <th style={{ width: 130 }}>Harga</th>
              {canAddRemove && <th style={{ width: 44 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const badWarna = !!row.warna && !row.warnaResolved;
              return (
                <tr key={row.id}>
                  <td>
                    {canEditText
                      ? <input className="input" placeholder="e.g. HARI SUKAN 2026" value={row.acara} onChange={(e) => row.setAcara(e.target.value)} />
                      : (row.acara || '—')}
                  </td>
                  <td>
                    {canEditText ? (
                      <>
                        <input
                          className={`input${badWarna ? ' input-red' : ''}`}
                          placeholder="BIRU / HIJAU / KUNING / MERAH"
                          value={row.warna}
                          onChange={(e) => row.setWarna(e.target.value)}
                          list="selempang-warna-list"
                        />
                        {badWarna && (
                          <div className="hint-text" style={{ color: '#c0392b', margin: '2px 0 0' }}>
                            Warna tak dikenali — guna {WARNA_HINT}
                          </div>
                        )}
                      </>
                    ) : (
                      row.warnaResolved
                        ? `${row.warnaResolved.warna} (${row.warnaResolved.code})`
                        : (row.warna || '—')
                    )}
                  </td>
                  <td>
                    {canEditQty
                      ? <input className="input" type="number" min="0" placeholder="0" value={row.qty} onChange={(e) => row.setQty(e.target.value)} />
                      : (row.qty || 0)}
                  </td>
                  <td><div className="input input-readonly input-price">{row.hargaLabel}</div></td>
                  {canAddRemove && (
                    <td>
                      <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove row" onClick={row.remove}>✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={canAddRemove ? 5 : 4} style={{ textAlign: 'center', opacity: 0.5, padding: 'var(--space-4)' }}>Tiada selempang.</td></tr>
            )}
            <tr>
              <td><strong>TOTAL</strong></td>
              <td />
              <td><strong style={overStock ? { color: '#c0392b' } : undefined}>{totalQty}</strong></td>
              <td><strong>RM {totalHarga.toFixed(2)}</strong></td>
              {canAddRemove && <td />}
            </tr>
          </tbody>
        </table>
      </div>

      {canEditText && (
        <datalist id="selempang-warna-list">
          {SELEMPANG_WARNA.map((w) => <option key={w.code} value={w.warna} />)}
        </datalist>
      )}

      {overStock && (
        <p className="hint-text" style={{ color: '#c0392b', fontWeight: 600 }}>
          Stock selempang tidak cukup — baki {stock.maxOrderable} sahaja boleh ditempah. Sila hubungi Salesman.
        </p>
      )}

      {canAddRemove && (
        <div className="row-actions">
          <button type="button" className="btn btn-secondary" onClick={blk.addSelempangRow}>+ Tambah Baris</button>
        </div>
      )}

      <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>
        RM {Number(blk.selempangUnitPrice).toFixed(2)} setiap satu. Production tidak perlu buat apa-apa untuk selempang.
      </p>
    </div>
  );
}
