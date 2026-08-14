import { standardUnitPrice } from '../data/catalog';
import { groupItemsByBatch } from '../utils/orderBatches';

// Shared by SalesOrderSummary (editable, for the pre-approval price
// review) and OrderDetails (always read-only, the teacher's own printable
// copy) — same table, same batch-grouping. `priceDrafts`/`setPrice` are
// only ever read when `editable` is true; pass {} / a no-op when not.
//
// Groups rows by which batch they came from (see src/utils/orderBatches.js)
// — the original order plus any approved add-on rounds — so once at least
// one add-on has been approved, the split stays visible everywhere this
// table is shown (not just on AddOnSummary's one-time draft-review screen).
// With a single group (the common case, no add-ons yet) this renders
// identically to a single flat table: one TOTAL row, no extra heading.
export default function PriceTable({ rows, editable, priceDrafts, setPrice, plakCatalog, totalQty, totalHarga, priceAdjusted }) {
  const groups = groupItemsByBatch(rows);
  const multiGroup = groups.length > 1;

  return (
    <>
      {groups.map((group, gi) => {
        const groupHarga = group.items.reduce((sum, it) => sum + it.harga, 0);
        return (
          <div key={group.batch}>
            {multiGroup && <div className="card-kicker" style={{ marginTop: gi === 0 ? 0 : 'var(--space-6)' }}>{group.label}</div>}
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
                {group.items.map((it) => {
                  const adjusted = it.unitPrice !== standardUnitPrice(it.jenisPlak, plakCatalog);
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
                  <td /><td /><td /><td><strong>{multiGroup ? 'SUBTOTAL' : 'TOTAL'}</strong></td>
                  <td>
                    <strong className={!multiGroup && priceAdjusted ? 'amount-adjusted' : undefined}>
                      RM {(multiGroup ? groupHarga : totalHarga).toFixed(2)}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      {multiGroup && (
        <div className="combined-total" style={{ marginTop: 'var(--space-4)' }}>
          <span className="dim">Grand Total:</span> <strong className={priceAdjusted ? 'amount-adjusted' : undefined}>RM {totalHarga.toFixed(2)}</strong>
        </div>
      )}
      <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>QTY total: {totalQty}</p>
    </>
  );
}
