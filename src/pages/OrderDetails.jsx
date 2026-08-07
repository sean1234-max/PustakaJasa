import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT, formatDate } from '../data/catalog';

export default function OrderDetails() {
  const { state } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(order.status);
  const invoiceIdLabel = idx >= 2 ? (order.invoiceId || `INV-${order.id.replace('ORD-', '')}`) : '-';
  const totalQty = order.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);

  return (
    <div className="screen-wrap">
      <Nav />

      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/dashboard')}>
        ← Back to My Orders
      </button>

      <div className="card elev-md">
        <div className="order-card-top" style={{ marginBottom: 'var(--space-3)' }}>
          <div>
            <div className="card-kicker">Order Details</div>
            <div className="card-title">{order.id}</div>
          </div>
          <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{order.status}</span>
        </div>

        <div className="order-dots" style={{ maxWidth: 260 }}>
          {STATUS_STAGES.map((_, i2) => (
            <div key={i2} className="order-dot" style={{ background: i2 <= idx ? 'var(--color-accent-700)' : 'var(--color-neutral-300)' }} />
          ))}
        </div>

        <div className="form-grid-2" style={{ marginTop: 'var(--space-6)' }}>
          <div><div className="dim">Invoice ID</div><div>{invoiceIdLabel}</div></div>
          <div><div className="dim">Date Placed</div><div>{order.datePlaced}</div></div>
          <div><div className="dim">Est. Delivery</div><div>{order.deliveryDate}</div></div>
          <div><div className="dim">Total Amount</div><div className={order.priceAdjusted ? 'amount-adjusted' : undefined}>RM {order.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
        </div>

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Function Details</div>
        <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
          {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
          {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
          {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}</div></div>}
          {order.phone && <div><div className="dim">Phone Number</div><div>{order.phone}</div></div>}
          {order.dueDate && <div><div className="dim">Due Date</div><div>{formatDate(new Date(order.dueDate))}</div></div>}
          {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
        </div>
        {order.logoDataUrl && (
          <div className="field" style={{ marginTop: 'var(--space-4)' }}>
            <label>School Logo</label>
            <img src={order.logoDataUrl} alt="" style={{ width: 52, height: 52, objectFit: 'contain', border: '1px solid var(--color-neutral-300)', background: '#fff' }} />
          </div>
        )}
        {order.remark && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div className="dim">Remark</div>
            <div>{order.remark}</div>
          </div>
        )}

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / QTY / Harga</div>
        <table className="table" style={{ margin: 'var(--space-3) 0 0' }}>
          <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th></tr></thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.id}>
                <td>{it.categoryLabel}</td>
                <td>{it.jenisPlak}</td>
                <td>{it.qty}</td>
                <td>RM {it.harga.toFixed(2)}</td>
              </tr>
            ))}
            <tr><td /><td><strong>TOTAL</strong></td><td><strong>{totalQty}</strong></td><td><strong className={order.priceAdjusted ? 'amount-adjusted' : undefined}>RM {order.totalAmount.toFixed(2)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
