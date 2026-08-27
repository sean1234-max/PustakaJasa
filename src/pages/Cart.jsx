import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { formatDate, getStockStatus } from '../data/catalog';

export default function Cart() {
  const { state, patch, today, removeFromCart, editCartCategory, submitOrder } = useAppState();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const cartTotalQty = state.cart.reduce((sum, ci) => sum + (Number(ci.qty) || 0), 0);
  const cartTotalHarga = state.cart.reduce((sum, ci) => sum + ci.harga, 0);

  // A category that spans several cart items (OTHERS' duplicated Tahun
  // blocks each become their own item — see AppState.jsx's addToCart) is
  // still just one "order details" from the teacher's point of view, so
  // this table shows one combined row per (category, Jenis Plak) instead
  // of one row per underlying item — a different category landing on the
  // same Jenis Plak code stays its own row, since it's a separate order
  // details even if the code coincides. Removing a merged row removes
  // every item folded into it.
  const groupedCartRows = useMemo(() => {
    const rows = [];
    const byKey = new Map();
    state.cart.forEach((ci) => {
      const key = `${ci.categoryKey}::${ci.jenisPlak}`;
      let row = byKey.get(key);
      if (!row) {
        // hasPrice stays false for a code with no resolvable catalog price
        // (Production's OTHER catch-all — see PlakPicker.jsx) — RM 0.00
        // would otherwise read as a free item instead of "price not set".
        row = { key, jenisPlak: ci.jenisPlak, categoryKey: ci.categoryKey, qty: 0, harga: 0, hasPrice: false, ids: [] };
        byKey.set(key, row);
        rows.push(row);
      }
      row.qty += Number(ci.qty) || 0;
      row.harga += ci.harga;
      if (ci.unitPrice != null) row.hasPrice = true;
      row.ids.push(ci.id);
    });
    return rows;
  }, [state.cart]);

  // Re-checked here (not just on the picker in OrderCategoryBlock) since a
  // cart item can sit for a while — another school may have bought into
  // the same low-stock code since it was added. This is still only a
  // preview against the last-fetched catalog; plak_stock_deduct is the
  // real, race-safe enforcement at submit time. Checked against each
  // group's combined qty, not each underlying item's own qty, so a stock
  // cap breached only once several duplicated blocks are added together
  // still gets caught here.
  const stockViolation = useMemo(() => groupedCartRows
    .map((row) => {
      const status = getStockStatus(row.jenisPlak, state.plakCatalog);
      return status && Number(row.qty) > status.maxOrderable ? { ...row, maxOrderable: status.maxOrderable } : null;
    })
    .find(Boolean), [groupedCartRows, state.plakCatalog]);

  const handleSubmit = async () => {
    if (state.cart.length === 0 || submitting || stockViolation) return;
    setSubmitting(true);
    const id = await submitOrder();
    setSubmitting(false);
    if (id) navigate('/success');
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Review Order</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Order Summary</div>

        <div className="form-grid-2 cart-summary-grid">
          <div className="summary-col">
            <div><span className="dim">SALES :</span> {state.sales}</div>
            <div><span className="dim">SEKOLAH :</span> {state.sekolah}</div>
            <div><span className="dim">LOGO TYPE :</span> {state.schoolType === 'SK' ? 'SK' : 'Others'}</div>
            {state.schoolType === 'NOT_SK' && (
              <>
                <div className="row-inline">
                  <span className="dim">LOGO :</span>
                  {state.logoDataUrl
                    ? <img src={state.logoDataUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain', border: '1px solid var(--color-neutral-300)', background: '#fff' }} />
                    : <span className="dim">— not uploaded —</span>}
                </div>
                <div><span className="dim">LOGO REMARK :</span> {state.logoRemark}</div>
              </>
            )}
            <div><span className="dim">CIKGU / NO TEL :</span> {state.picName}{state.phone ? ` / ${state.phone}` : ''}</div>
            <div><span className="dim">KETUA PANITIA :</span> {state.ketuaPanitia}</div>
          </div>
          <div className="summary-col">
            <div><span className="dim">TARIKH ORDER :</span> {formatDate(today)}</div>
            <div><span className="dim">TARIKH FUNCTION :</span> {formatDate(state.funcSelected)}</div>
            <div><span className="dim">TERMS :</span> {state.terms}</div>
          </div>
        </div>

        <div className="card-kicker">Jenis Plak / QTY / Harga</div>
        <table className="table" style={{ margin: 'var(--space-3) 0 var(--space-8)' }}>
          <thead><tr><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th><th style={{ width: 48 }} /><th style={{ width: 44 }} /></tr></thead>
          <tbody>
            {groupedCartRows.map((row) => {
              const status = getStockStatus(row.jenisPlak, state.plakCatalog);
              const overStock = !!status && Number(row.qty) > status.maxOrderable;
              return (
                <tr key={row.key}>
                  <td>{row.jenisPlak}</td>
                  <td style={overStock ? { color: '#c0392b', fontWeight: 700 } : undefined}>{row.qty}</td>
                  <td>{row.hasPrice ? `RM ${row.harga.toFixed(2)}` : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      aria-label="Edit"
                      title="Edit this order's details"
                      onClick={() => { editCartCategory(row.categoryKey); navigate('/order/step2'); }}
                    >
                      ✎
                    </button>
                  </td>
                  <td><button type="button" className="btn btn-ghost btn-icon" aria-label="Remove" onClick={() => row.ids.forEach(removeFromCart)}>✕</button></td>
                </tr>
              );
            })}
            {groupedCartRows.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', opacity: 0.5, padding: 'var(--space-4)' }}>No items yet — add categories from New Order → Order Details.</td></tr>
            )}
            <tr><td><strong>TOTAL</strong></td><td><strong>{cartTotalQty}</strong></td><td><strong>RM {cartTotalHarga.toFixed(2)}</strong></td><td /><td /></tr>
          </tbody>
        </table>

        <div className="field" style={{ margin: 'var(--space-6) 0 var(--space-8)' }}>
          <label htmlFor="cartRemark">Remark</label>
          <textarea className="input" id="cartRemark" rows={3} placeholder="Any additional notes" value={state.remark} onChange={(e) => patch({ remark: e.target.value })} />
        </div>

        {stockViolation && (
          <p className="hint-text" style={{ color: '#c0392b', fontWeight: 600 }}>
            Stock tidak cukup untuk &quot;{stockViolation.jenisPlak}&quot; — baki {stockViolation.maxOrderable} sahaja boleh ditempah. Sila kurangkan kuantiti atau hubungi Salesman sebelum submit.
          </p>
        )}
        <div className="row-split">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/order/step1')}>← Back to Order</button>
          {state.cartToast && <span className="toast-inline">{state.cartToast}</span>}
          <button type="button" className="btn btn-primary" disabled={state.cart.length === 0 || submitting || !!stockViolation} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
