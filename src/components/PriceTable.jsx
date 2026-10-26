import { Fragment } from 'react';
import { standardUnitPrice, SELEMPANG_CODE } from '../data/catalog';
import { groupItemsByBatch, combineByJenisPlak, sortMedalColours, withNamaLines } from '../utils/orderBatches';

// Shared by SalesOrderSummary (editable, for the pre-approval price
// review) and OrderDetails (always read-only, the teacher's own printable
// copy) — same table, same batch-grouping. `priceDrafts`/`setPrice` are
// only ever read when `editable` is true; pass {} / a no-op when not.
// `setPrice` is called with an array of item ids (every id a combined row
// stands in for — just one when `combineJenisPlak` is off) so it always
// applies the edited price to all of them.
//
// Groups rows by which batch they came from (see src/utils/orderBatches.js)
// — the original order plus any approved add-on rounds — so once at least
// one add-on has been approved, the split stays visible everywhere this
// table is shown (not just on AddOnSummary's one-time draft-review screen).
// With a single group (the common case, no add-ons yet) this renders
// identically to a single flat table: one TOTAL row, no extra heading.
//
// `hideCategory` and `combineJenisPlak` are both off by default — the
// teacher's own OrderDetails view keeps the per-category breakdown, only
// Sales' approve/print view (SalesOrderSummary) turns them on, since a
// school buying the same Jenis Plak for two categories only cares about
// one combined line and one price.
export default function PriceTable({
  rows, editable, priceDrafts, setPrice, plakCatalog, totalQty, totalHarga, priceAdjusted,
  hideCategory = false, combineJenisPlak = false, showSelempangLines = false,
  // optional: rows whose Jenis Plak passes canPick can be clicked (onPick(jenisPlak)) — the crystal
  // rows, to show that crystal in the Crystal Preview below; the `picked` row is highlighted
  canPick = null, onPick = null, picked = null,
}) {
  const columnCount = (hideCategory ? 0 : 1) + 1 + 3;
  const groups = groupItemsByBatch(rows);
  const multiGroup = groups.length > 1;
  // Sets a combined line's price on all its items; the named ones keep their +RM1 on top.
  const setLinePrice = (it, value) => {
    if (!it.namaPerUnit || value === '') { setPrice(it.ids, value); return; }
    const plain = it.ids.filter((id) => !it.namaIds.includes(id));
    if (plain.length) setPrice(plain, value);
    setPrice(it.namaIds, String(Number(value) + it.namaPerUnit));
  };

  return (
    <>
      {groups.map((group, gi) => {
        const groupHarga = group.items.reduce((sum, it) => sum + it.harga, 0);
        const displayItems = combineJenisPlak
          ? withNamaLines(sortMedalColours(combineByJenisPlak(group.items, { splitByPrice: true })))
          : sortMedalColours(group.items.map((it) => ({ ...it, key: it.id, ids: [it.id] })));
        return (
          <div key={group.batch}>
            {multiGroup && <div className="card-kicker" style={{ marginTop: gi === 0 ? 0 : 'var(--space-6)' }}>{group.label}</div>}
            <table className="table" style={{ margin: 'var(--space-3) 0 0' }}>
              <thead>
                <tr>
                  {!hideCategory && <th>Category</th>}
                  <th>Jenis Plak</th>
                  <th style={{ width: 130 }}>Price per Unit</th>
                  <th style={{ width: 80 }}>QTY</th>
                  <th style={{ width: 130 }}>Harga</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((it) => {
                  const adjusted = !it.nama && it.unitPrice !== standardUnitPrice(it.jenisPlak, plakCatalog);
                  // a single item's draft includes its +RM1; this line shows the price without it
                  const draft = it.ids.length === 1 ? priceDrafts[it.ids[0]] : undefined;
                  const inputValue = it.ids.length !== 1 ? it.unitPrice
                    : it.namaPerUnit && draft != null && draft !== '' ? Number(draft) - it.namaPerUnit
                      : (draft ?? it.unitPrice);
                  // The printed order lists each Selempang's ACARA / WARNA under its row (Sean, 2026-10-13).
                  const selempangLines = showSelempangLines && it.jenisPlak === SELEMPANG_CODE
                    ? group.items.filter((x) => it.ids.includes(x.id)).flatMap((x) => x.detail?.rows || [])
                    : [];
                  return (
                    <Fragment key={it.key}>
                    <tr
                      {...(onPick && canPick?.(it.jenisPlak) ? {
                        onClick: () => onPick(it.jenisPlak), title: 'Show this crystal in the Crystal Preview below',
                        style: { cursor: 'pointer', background: picked === it.jenisPlak ? 'var(--color-accent-100)' : undefined },
                      } : {})}
                    >
                      {!hideCategory && <td>{it.categoryLabel}</td>}
                      <td>{it.jenisPlak}{!combineJenisPlak && it.nameSurcharge > 0 && <span className="hint-text"> (nama +RM1)</span>}</td>
                      <td>
                        {editable && !it.nama ? (
                          <input
                            className={`input${adjusted ? ' amount-adjusted' : ''}`}
                            type="number"
                            min="0"
                            step="1"
                            // Falls back to it.unitPrice (same fallback the
                            // Harga column's own total already relies on,
                            // see StoreAdminOrderDetail/SalesOrderSummary's
                            // `rows` memo) whenever priceDrafts hasn't got a
                            // real number for this item yet — a stray
                            // null/undefined draft (e.g. a mouse-wheel nudge
                            // on the native number spinner) must never show
                            // as a blank field while Harga quietly still
                            // computes off the correct price underneath.
                            value={inputValue}
                            // Selects the existing text on focus so the very
                            // first keystroke replaces it outright — without
                            // this, clicking in and typing "10" over an
                            // unselected "0" inserts instead of replacing,
                            // leaving "010" on screen.
                            onFocus={(e) => e.target.select()}
                            // Belt-and-braces for anything that still slips a
                            // leading zero through (e.g. a paste): strip a
                            // zero immediately followed by another digit,
                            // leaving a real decimal like "0.5" untouched.
                            onChange={(e) => setLinePrice(it, e.target.value.replace(/^0+(?=\d)/, ''))}
                          />
                        ) : (
                          <span className={adjusted ? 'amount-adjusted' : undefined}>
                            {it.unitPrice != null ? `RM ${it.unitPrice.toFixed(2)}` : '—'}
                          </span>
                        )}
                      </td>
                      <td>{it.qty}</td>
                      <td>
                        <strong className={adjusted ? 'amount-adjusted' : undefined}>
                          {it.unitPrice != null ? `RM ${it.harga.toFixed(2)}` : '—'}
                        </strong>
                      </td>
                    </tr>
                    {selempangLines.map((r, i) => (
                      // eslint-disable-next-line react/no-array-index-key -- display-only list, rows have no stable id across items
                      <tr key={`${it.key}-sel-${i}`} className="selempang-line">
                        <td colSpan={columnCount} style={{ paddingLeft: 'var(--space-6)', fontSize: '0.9em' }}>
                          ↳ {r.acara || '—'} · {r.warna}{r.warnaCode ? ` (${r.warnaCode})` : ''} · {r.qty}
                        </td>
                      </tr>
                    ))}
                    </Fragment>
                  );
                })}
                <tr>
                  {!hideCategory && <td />}
                  <td />
                  <td />
                  <td><strong>{multiGroup ? 'SUBTOTAL' : 'TOTAL'}</strong></td>
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
