import PlakPicker from './PlakPicker';
import { getStockStatus } from '../data/catalog';

const TAHUN_OPTIONS = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'];

// Renders one category "block": reference sample + numbered lines, the
// quantity table (fixed matrix / dynamic matrix / list mode), and the Jenis
// Plak / QTY / Harga row. Reused by New Order Step 2, Add On, and every
// read-only order-review screen (Sales/Production/Admin/teacher order
// details) — `editable` controls which parts of the block are inputs vs
// read-only text for each of those.
// The reference image itself is never editable here regardless of
// `editable` — it's a fixed per-category example Production manages from
// its own admin screen (Production → Reference Images), not per-order data.
// `hideEmptyRows` (print only — the editable New Order / Add On
// them in) drops subjects/rows/columns nobody ordered from the printed
// quantity table, so the printout only lists what was actually selected.
export default function OrderCategoryBlock({ blk, editable, plakOptions, refImageUrl, hideEmptyRows }) {
  const matrixRows = hideEmptyRows ? blk.matrixRows.filter((row) => row.rowTotal > 0) : blk.matrixRows;
  const listRows = hideEmptyRows ? blk.rows.filter((row) => Number(row.qty) > 0) : blk.rows;
  // Dynamic-matrix columns are teacher-added and can end up unused (added,
  // then never filled in) — hide those on print the same way empty subject
  // rows already are, keeping both the header and every row's cells in sync
  // by index.
  const keepColIdx = blk.isDynamicMatrix && hideEmptyRows
    ? blk.columns.map((_, i) => (blk.colTotals[i]?.value || 0) > 0)
    : blk.columns.map(() => true);
  const dynColumns = blk.isDynamicMatrix ? blk.columns.filter((_, i) => keepColIdx[i]) : blk.columns;
  const dynColTotals = blk.isDynamicMatrix ? blk.colTotals.filter((_, i) => keepColIdx[i]) : blk.colTotals;
  // table-layout:auto (the .table default) computes column widths from
  // content, which can't see the intended width of a `width:100%` input —
  // it ends up squeezing every column of this often-13-columns-wide table
  // down to a sliver instead of actually overflowing/scrolling. Switching
  // to a fixed layout with an explicit total width (sum of every column's
  // own width below) makes each column render at its real size and lets
  // table-wrap's overflow-x do the scrolling.
  const DYN_COL_WIDTHS = { tahun: 190, namaKelas: 150, subject: 110, total: 70 };
  const dynTableWidth = DYN_COL_WIDTHS.tahun + DYN_COL_WIDTHS.namaKelas
    + dynColumns.length * DYN_COL_WIDTHS.subject + DYN_COL_WIDTHS.total;
  // isMatrix columns are fixed catalog-defined for MP THP 1/2, but a
  // category can opt into teacher-addable columns too (OTHERS — see
  // catalog.js's `freeColumns` flag) mirroring the existing custom-ROW
  // mechanism (getCustomMatrixRowIds) on the other axis. Teacher-added
  // columns can end up unused same as dynamic-matrix columns, so hide those
  // on print the same way.
  const keepMatrixColIdx = blk.isMatrix && blk.freeColumns && hideEmptyRows
    ? blk.columns.map((_, i) => (blk.colTotals[i]?.value || 0) > 0)
    : blk.columns.map(() => true);
  const matrixCols = blk.isMatrix ? blk.columns.filter((_, i) => keepMatrixColIdx[i]) : blk.columns;
  const matrixColTotals = blk.isMatrix ? blk.colTotals.filter((_, i) => keepMatrixColIdx[i]) : blk.colTotals;

  return (
    <div>
      <div className="card-kicker">Jenis Plak / QTY / Harga</div>
      <table className="table">
        <thead><tr><th>Jenis Plak</th><th style={{ width: 130 }}>QTY</th><th style={{ width: 130 }}>Harga</th></tr></thead>
        <tbody>
          {blk.plakRows.map((pr) => {
            // Live preview of the server-enforced cap (plak_stock_deduct,
            // supabase/migrations/0032_add_plak_stock.sql) — this can only
            // warn early using the last-fetched catalog snapshot; the
            // actual submit (Cart/AddOnSummary) re-checks and the database
            // function is the real backstop against a stale/racing read.
            const stockStatus = pr.jenisPlak ? getStockStatus(pr.jenisPlak, plakOptions) : null;
            const overStock = !!stockStatus && Number(pr.qty) > stockStatus.maxOrderable;
            return (
              <tr key={pr.id}>
                <td>
                  {editable.jenisPlak ? (
                    <PlakPicker value={pr.jenisPlak} onChange={pr.setJenisPlak} catalog={plakOptions} />
                  ) : (pr.jenisPlak || '—')}
                </td>
                <td>
                  <div className="input input-readonly" style={overStock ? { color: '#c0392b', fontWeight: 700 } : undefined}>
                    {pr.qty}
                  </div>
                  {overStock && (
                    <div className="hint-text" style={{ color: '#c0392b', margin: '2px 0 0' }}>
                      Stock tidak cukup — baki {stockStatus.maxOrderable} sahaja boleh ditempah. Sila hubungi Salesman.
                    </div>
                  )}
                </td>
                <td><div className="input input-readonly input-price">{pr.hargaLabel}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Reference Sample (Contoh)</div>
      <p className="hint-text">Fill each numbered line to match the sample layout — this tells us exactly how to place the text and sizing on the plaque.</p>
      <p className="hint-text"><span style={{ color: '#c0392b' }}>★</span> = wording on this line is required and must be filled in.</p>

      <div className="ref-sample-grid">
        <div className="ref-sample-image">
          {refImageUrl ? (
            <img src={refImageUrl} alt="Reference sample" className="ref-sample-img" />
          ) : (
            <div className="ref-sample-placeholder">No reference image set yet</div>
          )}
        </div>
        <div className="ref-sample-lines">
          {blk.lines.map((ln) => (
            <div key={ln.key} className="ref-sample-line">
              <span
                style={{ color: '#c0392b', fontSize: 14, width: 14, textAlign: 'center', flex: 'none', visibility: ln.required ? 'visible' : 'hidden' }}
                aria-label={ln.required ? 'required' : undefined}
              >
                ★
              </span>
              <div className="line-num">{ln.num}</div>
              {ln.secondLine ? (
                <div className="ref-sample-line-stack">
                  <input
                    className="input"
                    placeholder={ln.placeholder}
                    value={ln.value}
                    readOnly={!editable.lines}
                    onChange={editable.lines ? (e) => ln.onChange(e.target.value) : undefined}
                  />
                  <input
                    className="input"
                    placeholder={ln.secondLine.placeholder}
                    value={ln.secondLine.value}
                    readOnly={!editable.lines}
                    onChange={editable.lines ? (e) => ln.secondLine.onChange(e.target.value) : undefined}
                  />
                </div>
              ) : (
                <input
                  className="input"
                  placeholder={ln.placeholder}
                  value={ln.value}
                  readOnly={!editable.lines}
                  onChange={editable.lines ? (e) => ln.onChange(e.target.value) : undefined}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card-kicker">Kuantiti — {blk.qtyLabel}</div>

      {blk.isMatrix ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Subjek</th>
                {matrixCols.map((col) => (
                  <th key={col.colKey} style={{ width: col.custom ? 220 : 90 }}>
                    {col.custom && editable.addRemoveRows ? (
                      <div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder={blk.customColumnTahunPlaceholder || 'e.g. 1-6'} value={col.tahun} onChange={(e) => col.setTahun(e.target.value)} />
                          <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove column" onClick={col.remove}>✕</button>
                        </div>
                        <input className="input" style={{ marginTop: 4 }} placeholder={blk.customColumnNamaKelasPlaceholder || 'e.g. ADIL'} value={col.namaKelas} onChange={(e) => col.setNamaKelas(e.target.value)} />
                        {col.minQty > 1 && <div className="hint-text" style={{ margin: '2px 0 0', fontWeight: 400 }}>min {col.minQty} setiap subjek</div>}
                      </div>
                    ) : col.label}
                  </th>
                ))}
                <th style={{ width: 70 }}>Total</th>
                {editable.addRemoveRows && <th style={{ width: 48 }} />}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={row.custom ? `custom-${row.id}` : row.subject}>
                  <td>
                    {row.custom && editable.addRemoveRows
                      ? <input className="input" placeholder="e.g. SUKAN" value={row.subject} onChange={(e) => row.setSubject(e.target.value)} />
                      : row.subject}
                  </td>
                  {row.cells.filter((_, i) => keepMatrixColIdx[i]).map((cell) => (
                    <td key={cell.key}>
                      <input
                        className="input"
                        type="number"
                        min={cell.minQty > 1 ? cell.minQty : 0}
                        placeholder="0"
                        value={cell.value}
                        readOnly={!editable.matrix}
                        onChange={editable.matrix ? (e) => cell.onChange(e.target.value) : undefined}
                      />
                    </td>
                  ))}
                  <td><strong>{row.rowTotal}</strong></td>
                  {editable.addRemoveRows && (
                    <td>{row.custom && <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove row" onClick={row.remove}>✕</button>}</td>
                  )}
                </tr>
              ))}
              <tr>
                <td><strong>TOTAL</strong></td>
                {matrixColTotals.map((ct, i) => <td key={i}><strong>{ct.value}</strong></td>)}
                <td><strong>{blk.grandTotal}</strong></td>
                {editable.addRemoveRows && <td />}
              </tr>
            </tbody>
          </table>
          {editable.addRemoveRows && (
            <div className="row-actions" style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={blk.addMatrixRow}>+ Add Row</button>
              {blk.freeColumns && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={blk.addMatrixColumnSameTahun}>+ Add Kelas</button>
                  <button type="button" className="btn btn-secondary" onClick={blk.addMatrixColumn}>+ Add Tahun</button>
                </>
              )}
            </div>
          )}
        </div>
      ) : blk.isDynamicMatrix ? (
        <div>
          <div className="table-wrap">
            <table className="table" style={{ tableLayout: 'fixed', width: dynTableWidth }}>
              <thead>
                <tr>
                  <th style={{ width: DYN_COL_WIDTHS.tahun }}>Tahun</th>
                  <th style={{ width: DYN_COL_WIDTHS.namaKelas }}>Nama Kelas</th>
                  {dynColumns.map((col) => (
                    <th key={col.id} style={{ width: DYN_COL_WIDTHS.subject }}>
                      {col.custom && editable.rowDesc ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="e.g. KEMAHIRAN HIDUP" value={col.subject} onChange={(e) => col.setSubject(e.target.value)} />
                          {editable.addRemoveRows && (
                            <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove subject" onClick={col.remove}>✕</button>
                          )}
                        </div>
                      ) : col.subject}
                    </th>
                  ))}
                  <th style={{ width: DYN_COL_WIDTHS.total }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <select
                          className="input"
                          style={{ flex: 1, minWidth: 0 }}
                          value={row.tahunFrom}
                          disabled={!editable.rowDesc}
                          onChange={editable.rowDesc ? (e) => row.setTahunFrom(e.target.value) : undefined}
                        >
                          <option value="">Dari</option>
                          {TAHUN_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <span>–</span>
                        <select
                          className="input"
                          style={{ flex: 1, minWidth: 0 }}
                          value={row.tahunTo}
                          disabled={!editable.rowDesc}
                          onChange={editable.rowDesc ? (e) => row.setTahunTo(e.target.value) : undefined}
                        >
                          <option value="">Hingga</option>
                          {TAHUN_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      {row.minQty > 1 && <div className="hint-text" style={{ margin: '2px 0 0' }}>min {row.minQty} setiap subjek</div>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          className="input"
                          style={{ flex: 1, minWidth: 0 }}
                          placeholder="Nama Kelas"
                          value={row.namaKelas}
                          readOnly={!editable.rowDesc}
                          onChange={editable.rowDesc ? (e) => row.setNamaKelas(e.target.value) : undefined}
                        />
                        {editable.addRemoveRows && (
                          <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove class" onClick={row.remove}>✕</button>
                        )}
                      </div>
                    </td>
                    {row.cells.filter((_, i) => keepColIdx[i]).map((cell) => (
                      <td key={cell.key}>
                        <input
                          className="input"
                          type="number"
                          min={row.minQty}
                          placeholder="0"
                          value={cell.value}
                          readOnly={!editable.matrix}
                          onChange={editable.matrix ? (e) => cell.onChange(e.target.value) : undefined}
                        />
                      </td>
                    ))}
                    <td><strong>{row.rowTotal}</strong></td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}><strong>TOTAL ({blk.qtyColHeader})</strong></td>
                  {dynColTotals.map((ct, i) => <td key={i}><strong>{ct.value}</strong></td>)}
                  <td><strong>{blk.grandTotal}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          {editable.addRemoveRows && (
            <div className="row-actions" style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)' }}>
              <button type="button" className="btn btn-secondary" onClick={blk.addRow}>+ Add Subject</button>
              <button type="button" className="btn btn-secondary" onClick={blk.addColumnSameTahun}>+ Add Kelas</button>
              <button type="button" className="btn btn-secondary" onClick={blk.addColumn}>+ Add Tahun</button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ width: 140 }}>{blk.qtyColHeader}</th>
                {editable.addRemoveRows && <th style={{ width: 48 }} />}
              </tr>
            </thead>
            <tbody>
              {listRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {editable.rowDesc
                      ? <input className="input" placeholder="e.g. TAHUN 1" value={row.desc} onChange={(e) => row.setDesc(e.target.value)} />
                      : row.desc}
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={row.qty}
                      readOnly={!editable.rowQty}
                      onChange={editable.rowQty ? (e) => row.setQty(e.target.value) : undefined}
                    />
                  </td>
                  {editable.addRemoveRows && (
                    <td><button type="button" className="btn btn-ghost btn-icon" aria-label="Remove row" onClick={row.remove}>✕</button></td>
                  )}
                </tr>
              ))}
              <tr><td><strong>TOTAL</strong></td><td><strong>{blk.blockTotalQty}</strong></td>{editable.addRemoveRows && <td />}</tr>
            </tbody>
          </table>
          {editable.addRemoveRows && (
            <div className="row-actions">
              <button type="button" className="btn btn-secondary" onClick={blk.addRow}>+ Add Row</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
