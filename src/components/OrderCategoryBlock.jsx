import ImageDrop from './ImageDrop';

// Renders one category "block": reference sample + numbered lines, the
// quantity table (matrix or list mode), the optional Nama Kelas & Tahun
// sub-table (PBD variant 0 only), and the Jenis Plak / QTY / Harga row.
// Reused by New Order Step 2, Amend, and Add On — `editable` controls which
// parts of the block are inputs vs read-only text for each of those.
export default function OrderCategoryBlock({ blk, editable, plakOptions, refImage, onRefImageChange }) {
  return (
    <div>
      <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Reference Sample (Contoh)</div>
      <p className="hint-text">Fill each numbered line to match the sample layout — this tells us exactly how to place the text and sizing on the plaque.</p>

      <div className="ref-sample-grid">
        <div className="ref-sample-image">
          <ImageDrop
            value={refImage?.url}
            fileName={refImage?.fileName}
            onChange={(url, fileName) => onRefImageChange?.(blk.sampleSlotId, url, fileName)}
            placeholder="Drop reference sample"
            subtext="or click to browse"
            height={200}
            thumbSize={80}
          />
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
              {blk.matrixRows.map((row) => (
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
              {blk.rows.map((row) => (
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
                  <select className="input" value={pr.jenisPlak} onChange={(e) => pr.setJenisPlak(e.target.value)}>
                    <option value="">—</option>
                    {plakOptions.map((po) => <option key={po.code} value={po.code}>{po.code}</option>)}
                  </select>
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
