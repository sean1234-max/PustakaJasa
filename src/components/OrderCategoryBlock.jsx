import PlakPicker from './PlakPicker';

const TAHUN_OPTIONS = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'];

// Renders one category "block": reference sample + numbered lines, the
// quantity table (fixed matrix / dynamic matrix / list mode), and the Jenis
// Plak / QTY / Harga row. Reused by New Order Step 2, Amend, and Add On —
// `editable` controls which parts of the block are inputs vs read-only text
// for each of those.
// The reference image itself is never editable here regardless of
// `editable` — it's a fixed per-category example Production manages from
// its own admin screen (Production → Reference Images), not per-order data.
// `hideEmptyRows` (print only — the editable New Order / Amend / Add On
// screens always show every subject/row so the teacher can fill any of
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

  return (
    <div>
      <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Reference Sample (Contoh)</div>
      <p className="hint-text">Fill each numbered line to match the sample layout — this tells us exactly how to place the text and sizing on the plaque.</p>

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
                {blk.columns.map((col) => <th key={col} style={{ width: 90 }}>{col}</th>)}
                <th style={{ width: 70 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={row.subject}>
                  <td>{row.subject}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.key}>
                      <input
                        className="input"
                        type="number"
                        min="0"
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
                <td><strong>TOTAL</strong></td>
                {blk.colTotals.map((ct, i) => <td key={i}><strong>{ct.value}</strong></td>)}
                <td><strong>{blk.grandTotal}</strong></td>
              </tr>
            </tbody>
          </table>
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

      <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / QTY / Harga</div>
      <table className="table">
        <thead><tr><th>Jenis Plak</th><th style={{ width: 130 }}>QTY</th><th style={{ width: 130 }}>Harga</th></tr></thead>
        <tbody>
          {blk.plakRows.map((pr) => (
            <tr key={pr.id}>
              <td>
                {editable.jenisPlak ? (
                  <PlakPicker value={pr.jenisPlak} onChange={pr.setJenisPlak} catalog={plakOptions} />
                ) : (pr.jenisPlak || '—')}
              </td>
              <td><div className="input input-readonly">{pr.qty}</div></td>
              <td><div className="input input-readonly input-price">{pr.hargaLabel}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
