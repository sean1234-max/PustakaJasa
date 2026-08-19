import PlakPicker from './PlakPicker';

// Renders one category "block": reference sample + numbered lines, the
// quantity table (matrix or list mode), the optional Nama Kelas & Tahun
// sub-table (PBD variant 0 only), and the Jenis Plak / QTY / Harga row.
// Reused by New Order Step 2, Amend, and Add On — `editable` controls which
// parts of the block are inputs vs read-only text for each of those.
// The reference image itself is never editable here regardless of
// `editable` — it's a fixed per-category example Production manages from
// its own admin screen (Production → Reference Images), not per-order data.
// `hideEmptyRows` (print only — the editable New Order / Amend / Add On
// screens always show every subject/row so the teacher can fill any of
// them in) drops subjects/rows nobody ordered from the printed quantity
// table, so the printout only lists what was actually selected.
export default function OrderCategoryBlock({ blk, editable, plakOptions, refImageUrl, hideEmptyRows }) {
  const matrixRows = hideEmptyRows ? blk.matrixRows.filter((row) => row.rowTotal > 0) : blk.matrixRows;
  const listRows = hideEmptyRows ? blk.rows.filter((row) => Number(row.qty) > 0) : blk.rows;
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
                  {editable.addRemoveRows && (
                    <td>{row.custom && <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove row" onClick={row.remove}>✕</button>}</td>
                  )}
                </tr>
              ))}
              <tr>
                <td><strong>TOTAL</strong></td>
                {blk.colTotals.map((ct, i) => <td key={i}><strong>{ct.value}</strong></td>)}
                <td><strong>{blk.grandTotal}</strong></td>
                {editable.addRemoveRows && <td />}
              </tr>
            </tbody>
          </table>
          {editable.addRemoveRows && (
            <div className="row-actions">
              <button type="button" className="btn btn-secondary" onClick={blk.addMatrixRow}>+ Add Row</button>
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

      {blk.showNamaKelas && editable.namaKelas && (
        <>
          <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Nama Kelas &amp; Tahun</div>
          <table className="table">
            <thead><tr><th>Nama Kelas</th><th>Tahun</th><th style={{ width: 48 }} /></tr></thead>
            <tbody>
              {blk.namaKelasRows.map((nk) => (
                <tr key={nk.id}>
                  <td><input className="input" placeholder="e.g. 1 ADIL" value={nk.namaKelas} onChange={(e) => nk.setNamaKelas(e.target.value)} /></td>
                  <td><input className="input" placeholder="e.g. TAHUN 1" value={nk.tahun} onChange={(e) => nk.setTahun(e.target.value)} /></td>
                  <td><button type="button" className="btn btn-ghost btn-icon" aria-label="Remove row" onClick={nk.remove}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-secondary" style={{ marginTop: 'var(--space-3)' }} onClick={blk.addNamaKelasRow}>+ Add Row</button>
        </>
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
