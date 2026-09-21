// PriceTable (src/components/PriceTable.jsx) only ever shows Jenis Plak /
// Price / QTY — on the Summary page (SalesOrderSummary/StoreAdminOrderDetail
// with `combineJenisPlak` on) same-Jenis-Plak TOKOH rows also collapse into
// one combined line, hiding which student is which. This is the compact
// "who's actually getting what" list — Award / Nama Murid / Jenis Plak / QTY
// — one row per honoree, shown right under the price table instead of
// requiring a switch to the category's own Details tab just to see a name.
export default function TokohDetailsTable({ tokohBlocks }) {
  const rows = (tokohBlocks || []).flatMap((blk) => blk.rows || []);
  if (rows.length === 0) return null;
  return (
    <>
      <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Tokoh Details</div>
      <table className="table" style={{ margin: 'var(--space-3) 0 0' }}>
        <thead>
          <tr>
            <th>Award</th>
            <th>Nama Murid</th>
            <th>Jenis Plak</th>
            <th style={{ width: 80 }}>QTY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.desc || '—'}</td>
              <td>{row.tokohFields?.find((f) => f.key === 'namaMurid')?.value || '—'}</td>
              <td>{row.jenisPlak || '—'}</td>
              <td>{row.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
