import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT, standardUnitPrice } from '../data/catalog';

export default function SalesOrderSummary() {
  const { state, approveOrder } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  const editable = order?.status === 'Submitted to Sales';

  // Keyed by item.id — pre-filled from the item's current unit price (falls
  // back to the standard catalog rate for items that never had one, e.g.
  // hand-entered legacy orders) so editing never starts from a blank field.
  const [priceDrafts, setPriceDrafts] = useState(() => {
    const out = {};
    (order?.items || []).forEach((it) => {
      out[it.id] = it.unitPrice ?? standardUnitPrice(it.jenisPlak) ?? 0;
    });
    return out;
  });

  const rows = useMemo(() => (order?.items || []).map((it) => {
    const unitPrice = Number(priceDrafts[it.id] ?? it.unitPrice ?? 0);
    const harga = unitPrice * (Number(it.qty) || 0);
    return { ...it, unitPrice, harga };
  }), [order, priceDrafts]);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(order.status);
  const totalQty = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = rows.reduce((sum, it) => sum + it.harga, 0);

  const setPrice = (itemId, value) => setPriceDrafts((prev) => ({ ...prev, [itemId]: value }));

  const handleApprove = () => {
    const updatedItems = rows.map((r) => ({ ...r, unitPrice: r.unitPrice, harga: r.harga }));
    approveOrder(order.id, updatedItems);
    navigate('/sales/dashboard');
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/sales/dashboard')}>
        ← Back to Sales Orders
      </button>

      <div className="card elev-md">
        <div className="order-card-top" style={{ marginBottom: 'var(--space-3)' }}>
          <div>
            <div className="card-kicker">Order Summary</div>
            <div className="card-title">{order.id}</div>
          </div>
          <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{order.status}</span>
        </div>

        <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
          {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
          {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
        </div>

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
        <table className="table" style={{ margin: 'var(--space-3) 0 0' }}>
          <thead>
            <tr>
              <th>Category</th>
              <th>Jenis Plak</th>
              <th style={{ width: 130 }}>Price per Unit</th>
              <th style={{ width: 80 }}>QTY</th>
              <th style={{ width: 130 }}>Harga</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const adjusted = it.unitPrice !== standardUnitPrice(it.jenisPlak);
              return (
                <tr key={it.id}>
                  <td>{it.categoryLabel}</td>
                  <td>{it.jenisPlak}</td>
                  <td>
                    {editable ? (
                      <input
                        className={`input${adjusted ? ' amount-adjusted' : ''}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={priceDrafts[it.id]}
                        onChange={(e) => setPrice(it.id, e.target.value)}
                      />
                    ) : (
                      <span className={adjusted ? 'amount-adjusted' : undefined}>RM {it.unitPrice.toFixed(2)}</span>
                    )}
                  </td>
                  <td>{it.qty}</td>
                  <td><strong className={adjusted ? 'amount-adjusted' : undefined}>RM {it.harga.toFixed(2)}</strong></td>
                </tr>
              );
            })}
            <tr>
              <td /><td /><td /><td><strong>TOTAL</strong></td>
              <td><strong className={order.priceAdjusted || rows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak)) ? 'amount-adjusted' : undefined}>RM {totalHarga.toFixed(2)}</strong></td>
            </tr>
          </tbody>
        </table>
        <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>QTY total: {totalQty}</p>

        {editable && (
          <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
            <span />
            <button type="button" className="btn btn-primary" onClick={handleApprove}>Approve</button>
          </div>
        )}
      </div>
    </div>
  );
}
