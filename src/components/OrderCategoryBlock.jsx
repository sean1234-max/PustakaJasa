import { useState } from 'react';
import PlakPicker from './PlakPicker';
import { getStockStatus } from '../data/catalog';

const TAHUN_OPTIONS = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'];

// Whether a duplicated Mata Pelajaran/Klas section has any teacher-entered
// data — decides whether deleting it needs a confirm prompt first. Reads
// straight off the already-computed `blk` (Reference Sample lines, Kuantiti
// rows, Nama Kelas list, Tahun, Jenis Plak), so no extra state plumbing is
// needed just to answer this.
function blockHasSectionData(blk) {
  const linesHaveValue = blk.lines.some((ln) => (ln.value || '').trim() || (ln.secondLine?.value || '').trim());
  const rowsHaveValue = blk.rows.some((r) => (r.desc || '').trim() || (r.qty || '').toString().trim());
  const namaKelasHaveValue = blk.namaKelasRows.some((nk) => (nk.name || '').trim());
  const tahunHasValue = (blk.tahun?.value || '').trim();
  const plakHasValue = blk.plakRows.some((p) => (p.jenisPlak || '').trim());
  return linesHaveValue || rowsHaveValue || namaKelasHaveValue || !!tahunHasValue || plakHasValue;
}

// Renders one category "block": reference sample + numbered lines, the
// quantity table (fixed matrix / dynamic matrix / list mode), and the Jenis
// Plak / QTY / Harga row. Reused by New Order Step 2, Add On, and every
// read-only order-review screen (Sales/Production/Admin/teacher order
// details) — `editable` controls which parts of the block are inputs vs
// read-only text for each of those.
// The Reference Sample area shows a live text preview (see
// .ref-sample-live-preview below) built purely from `blk.lines` — no
// Production-managed reference image anymore (that whole admin feature
// was removed; Production/Admin no longer need to manage anything here).
// `hideEmptyRows` (print only — the editable New Order / Add On
// them in) drops subjects/rows/columns nobody ordered from the printed
// quantity table, so the printout only lists what was actually selected.
// `isLastBlock` (New Order / Add On only) gates the "Duplicate" button —
// only the last currently-revealed block (see NewOrderStep2/AddOn's
// visible-block slicing) can duplicate itself into the next one, so an
// earlier already-duplicated-from block doesn't confusingly overwrite it.
// `flashJenisPlak` (New Order Step 2 only) briefly highlights this block's
// own Jenis Plak field — see NewOrderStep2.jsx's liveImportWarnings click
// handler, which scrolls a warning's own block into view and flips this on
// for a moment so the teacher's eye lands on the exact field it's about.
export default function OrderCategoryBlock({ blk, editable, plakOptions, hideEmptyRows, isLastBlock, flashJenisPlak }) {
  // Drag-and-drop reordering of Reference Sample rows (OTHERS — see
  // catalog.js's draggableReferenceSample / computeBlocks.js's
  // reorderReferenceSample). Only offered when actually editable (never on
  // read-only review screens) — dragSlotId tracks which row is mid-drag so
  // it can be visually dimmed while dragging.
  const [dragSlotId, setDragSlotId] = useState(null);
  const referenceSampleDraggable = !!blk.reorderReferenceSample && editable.lines;
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
  const DYN_COL_WIDTHS = { tahun: 260, namaKelas: 150, subject: 190, total: 70 };
  const dynTableWidth = DYN_COL_WIDTHS.tahun + DYN_COL_WIDTHS.namaKelas
    + dynColumns.length * DYN_COL_WIDTHS.subject + DYN_COL_WIDTHS.total;
  const namaKelasRows = hideEmptyRows ? blk.namaKelasRows.filter((nk) => (nk.name || '').trim()) : blk.namaKelasRows;
  // `hasNamaKelasList` categories (OTHERS) apply ONE Jenis Plak + Reference
  // Sample to every Tahun part — Duplicate copies both under the hood (see
  // draftUpdaters.js's onDuplicateBlock) so each block's own cart item/CSV
  // export still carries them, but showing those two sections again on
  // every duplicated block would just be the same read-back values
  // repeated for no reason — only the first block ever displays them; every
  // later block goes straight to its own Kuantiti part.
  const showSharedSections = !blk.hasNamaKelasList || blk.idx === 0;

  return (
    <div>
      {showSharedSections && (
        <>
          {/* hasNamaKelasList categories (OTHERS) and plakPerBlock categories
              (KLAS_MATRIX) no longer show a single shared Jenis Plak/QTY/
              Harga table here — Jenis Plak renders above their own Kuantiti
              part instead, with QTY/Harga at the bottom of that same
              part — see the hasNamaKelasList/isDynamicMatrix branches below. */}
          {!blk.hasNamaKelasList && !blk.plakPerBlock && (
            <>
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
            </>
          )}

          <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Reference Sample (Contoh)</div>
          <p className="hint-text">Fill each numbered line to match the sample layout — this tells us exactly how to place the text and sizing on the plaque.</p>
          <p className="hint-text"><span style={{ color: '#c0392b' }}>★</span> = Wording dalam column ini tak boleh ditukar.</p>
          {referenceSampleDraggable && (
            <p className="hint-text">Drag the number beside each row to arrange them in whatever order matches your plaque — Production will follow the order you choose.</p>
          )}

          <div className="ref-sample-grid">
            <div className="ref-sample-image">
              {/* Fully replaces the uploaded reference image — whatever
                  the teacher types into the numbered lines shows here
                  live, with nothing from the original artwork/placeholder
                  text showing through underneath (see
                  .ref-sample-live-preview, an opaque box covering this
                  whole area). No Production setup needed for this. */}
              <div className="ref-sample-live-preview">
                {blk.lines.map((ln) => {
                  const hasValue = String(ln.value || '').trim();
                  return (
                    <div key={ln.key} className={`ref-sample-live-line${ln.redText ? ' ref-sample-live-red' : ''}`}>
                      <span className="ref-sample-live-num">{ln.num}</span>
                      {/* Red/bold lines (e.g. Main Template's ACARA and
                          SUBJEK/POSITION) always show at full strength —
                          dimming them the same as a plain placeholder would
                          undercut the whole point of calling them out. */}
                      <span className="ref-sample-live-text" style={{ opacity: hasValue || ln.redText ? 1 : 0.4 }}>
                        {hasValue ? ln.value : ln.placeholder}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="ref-sample-lines">
              {blk.lines.map((ln) => (
                <div
                  key={ln.key}
                  className={`ref-sample-line${referenceSampleDraggable && dragSlotId === ln.slotId ? ' ref-sample-line-dragging' : ''}`}
                  draggable={referenceSampleDraggable}
                  onDragStart={referenceSampleDraggable ? () => setDragSlotId(ln.slotId) : undefined}
                  onDragOver={referenceSampleDraggable ? (e) => e.preventDefault() : undefined}
                  onDrop={referenceSampleDraggable ? () => {
                    if (!dragSlotId || dragSlotId === ln.slotId) return;
                    const order = blk.lines.map((l) => l.slotId);
                    const fromIdx = order.indexOf(dragSlotId);
                    const toIdx = order.indexOf(ln.slotId);
                    if (fromIdx === -1 || toIdx === -1) return;
                    order.splice(fromIdx, 1);
                    order.splice(toIdx, 0, dragSlotId);
                    blk.reorderReferenceSample(order);
                    setDragSlotId(null);
                  } : undefined}
                  onDragEnd={referenceSampleDraggable ? () => setDragSlotId(null) : undefined}
                >
                  <span
                    style={{ color: '#c0392b', fontSize: 14, width: 14, textAlign: 'center', flex: 'none', marginTop: 7, visibility: ln.starred ? 'visible' : 'hidden' }}
                    aria-label={ln.required ? 'required' : undefined}
                  >
                    ★
                  </span>
                  <div className={referenceSampleDraggable ? 'line-num line-num-draggable' : 'line-num'} title={referenceSampleDraggable ? 'Drag to reorder' : undefined}>
                    {ln.num}
                  </div>
                  <div style={{ flex: 1 }}>
                    <input
                      className={ln.redText ? 'input input-red' : 'input'}
                      placeholder={ln.placeholder}
                      value={ln.value}
                      readOnly={!editable.lines}
                      onChange={editable.lines ? (e) => ln.onChange(e.target.value) : undefined}
                    />
                    {ln.typoHint && (
                      <div className="typo-hint">
                        Possible typo: "{ln.typoHint.word}" — did you mean "{ln.typoHint.suggestion}"?
                      </div>
                    )}
                  </div>
                  {ln.deletable && editable.lines && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      aria-label={`Delete row ${ln.num}`}
                      title={`Delete row ${ln.num}`}
                      style={{ flex: 'none', marginTop: 2 }}
                      onClick={ln.onDelete}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {blk.addReferenceLine && editable.lines && (
            <div className="row-actions" style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 8 }}>
              {blk.canAddReferenceLine && (
                <button type="button" className="btn btn-secondary" onClick={blk.addReferenceLine}>+ Add Reference Row</button>
              )}
              {!blk.deletableReferenceLines && blk.canRemoveReferenceLine && (
                <button type="button" className="btn btn-ghost" onClick={blk.removeReferenceLine}>− Delete Reference Row</button>
              )}
            </div>
          )}
        </>
      )}

      <div className="card-kicker">{blk.qtyLabel ? `Kuantiti — ${blk.qtyLabel}` : 'Kuantiti'}</div>

      {blk.isMatrix ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Subjek</th>
                {blk.columns.map((col) => <th key={col.colKey} style={{ width: 90 }}>{col.label}</th>)}
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
      ) : blk.isDynamicMatrix ? (
        <div>
          {blk.plakPerBlock && (
            <div
              id={`klas-matrix-plak-${blk.idx}`}
              className={`field${flashJenisPlak ? ' flash-highlight' : ''}`}
              style={{ marginBottom: 'var(--space-4)', maxWidth: 420 }}
            >
              <label>Jenis Plak</label>
              {blk.plakRows.map((pr) => {
                const stockStatus = pr.jenisPlak ? getStockStatus(pr.jenisPlak, plakOptions) : null;
                const overStock = !!stockStatus && Number(pr.qty) > stockStatus.maxOrderable;
                return (
                  <div key={pr.id}>
                    {editable.jenisPlak ? (
                      <PlakPicker value={pr.jenisPlak} onChange={pr.setJenisPlak} catalog={plakOptions} />
                    ) : (pr.jenisPlak || '—')}
                    {overStock && (
                      <div className="hint-text" style={{ color: '#c0392b', margin: '2px 0 0' }}>
                        Stock tidak cukup — baki {stockStatus.maxOrderable} sahaja boleh ditempah. Sila hubungi Salesman.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
                          <input
                            className="input"
                            style={{ flex: 1, minWidth: 0, fontSize: '0.8em', padding: '4px 6px' }}
                            placeholder="e.g. KEMAHIRAN HIDUP"
                            title={col.subject}
                            value={col.subject}
                            onChange={(e) => col.setSubject(e.target.value)}
                          />
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
                {blk.plakPerBlock && (
                  <tr>
                    <td colSpan={2}><strong>HARGA</strong></td>
                    {dynColTotals.map((ct, i) => <td key={i} />)}
                    <td><strong className="input-price" style={{ fontSize: '1.5em', fontWeight: 800 }}>{blk.plakRows[0]?.hargaLabel ?? '—'}</strong></td>
                  </tr>
                )}
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
      ) : blk.hasNamaKelasList ? (
        <div>
          <div className="field" style={{ marginBottom: 'var(--space-4)', maxWidth: 420 }}>
            <label>Jenis Plak</label>
            {blk.plakRows.map((pr) => {
              const stockStatus = pr.jenisPlak ? getStockStatus(pr.jenisPlak, plakOptions) : null;
              const overStock = !!stockStatus && Number(pr.qty) > stockStatus.maxOrderable;
              return (
                <div key={pr.id}>
                  {editable.jenisPlak ? (
                    <PlakPicker value={pr.jenisPlak} onChange={pr.setJenisPlak} catalog={plakOptions} />
                  ) : (pr.jenisPlak || '—')}
                  {overStock && (
                    <div className="hint-text" style={{ color: '#c0392b', margin: '2px 0 0' }}>
                      Stock tidak cukup — baki {stockStatus.maxOrderable} sahaja boleh ditempah. Sila hubungi Salesman.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {blk.tahun && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <input
                id={`tahun-${blk.idx}`}
                className="input"
                style={{ width: 260 }}
                placeholder={blk.tahunPlaceholder || 'e.g. TAHUN 1 / PRASEKOLAH / PPKI'}
                value={blk.tahun.value}
                readOnly={!editable.lines}
                onChange={editable.lines ? (e) => blk.tahun.onChange(e.target.value) : undefined}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <table className="table" style={{ flex: '1 1 320px' }}>
              <thead>
                <tr>
                  <th>ROW 4 SUBJECK/POSITION</th>
                  {blk.extraRefColumns.map((col) => <th key={col.key}>{col.label}</th>)}
                  <th style={{ width: 140 }}>{blk.qtyColHeader}</th>
                  {editable.addRemoveRows && <th style={{ width: 48 }} />}
                </tr>
              </thead>
              <tbody>
                {listRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {editable.rowDesc
                        ? <input className="input" placeholder="e.g. BAHASA MELAYU" value={row.desc} onChange={(e) => row.setDesc(e.target.value)} />
                        : row.desc}
                      {row.typoHint && (
                        <div className="typo-hint">
                          Possible typo: "{row.typoHint.word}" — did you mean "{row.typoHint.suggestion}"?
                        </div>
                      )}
                    </td>
                    {row.extraRefValues.map((rv) => (
                      <td key={rv.key}>
                        {editable.rowDesc
                          ? <input className="input" value={rv.value} onChange={(e) => rv.onChange(e.target.value)} />
                          : rv.value}
                      </td>
                    ))}
                    <td>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={row.qty}
                        readOnly={!editable.rowQty}
                        style={row.qtyMismatch ? { color: '#c0392b', fontWeight: 700 } : undefined}
                        onChange={editable.rowQty ? (e) => row.setQty(e.target.value) : undefined}
                      />
                      {row.qtyMismatch && (
                        <div className="hint-text" style={{ color: '#c0392b', margin: '2px 0 0' }}>
                          ⚠ {blk.namaKelasCount} Nama Kelas — QTY patut {blk.namaKelasCount}
                        </div>
                      )}
                    </td>
                    {editable.addRemoveRows && (
                      <td><button type="button" className="btn btn-ghost btn-icon" aria-label="Remove row" onClick={row.remove}>✕</button></td>
                    )}
                  </tr>
                ))}
                <tr>
                  <td><strong>TOTAL QTY</strong></td>
                  {blk.extraRefColumns.map((col) => <td key={col.key} />)}
                  <td><strong>{blk.blockTotalQty}</strong></td>
                  {editable.addRemoveRows && <td />}
                </tr>
                <tr>
                  <td><strong>HARGA</strong></td>
                  {blk.extraRefColumns.map((col) => <td key={col.key} />)}
                  <td><strong className="input-price" style={{ fontSize: '1.5em', fontWeight: 800 }}>{blk.plakRows[0]?.hargaLabel ?? '—'}</strong></td>
                  {editable.addRemoveRows && <td />}
                </tr>
              </tbody>
            </table>
            <table className="table" style={{ flex: '0 0 220px' }}>
              <thead>
                <tr>
                  <th>Nama Kelas</th>
                  {editable.addRemoveRows && <th style={{ width: 48 }} />}
                </tr>
              </thead>
              <tbody>
                {namaKelasRows.map((nk) => (
                  <tr key={nk.id}>
                    <td>
                      {editable.rowDesc
                        ? <input className="input" placeholder={blk.namaKelasPlaceholder || 'e.g. ADIF'} value={nk.name} onChange={(e) => nk.setName(e.target.value)} />
                        : nk.name}
                    </td>
                    {editable.addRemoveRows && (
                      <td><button type="button" className="btn btn-ghost btn-icon" aria-label="Remove Nama Kelas" onClick={nk.remove}>✕</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable.addRemoveRows && (
            <div className="row-actions" style={{ display: 'flex', gap: 8, marginTop: 'var(--space-3)' }}>
              <button type="button" className="btn btn-secondary" onClick={blk.addRowSameQty}>+ Add Subjek/Position</button>
              <button type="button" className="btn btn-secondary" onClick={blk.addNamaKelas}>+ Add Nama Kelas</button>
              {blk.duplicateBlock && isLastBlock && (
                <button type="button" className="btn btn-secondary" onClick={blk.duplicateBlock}>Duplicate</button>
              )}
              {blk.removeBlock && isLastBlock && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="Delete this section"
                  title="Delete this section"
                  onClick={() => {
                    const hasData = blockHasSectionData(blk);
                    if (!hasData || window.confirm('Are you sure you want to delete this section? All information in this section will be removed.')) {
                      blk.removeBlock();
                    }
                  }}
                >
                  ✕ Delete
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          <table className="table">
            <thead>
              <tr>
                <th>{blk.descColumnLabel || 'Description'}</th>
                {blk.extraRefColumns.map((col) => <th key={col.key}>{col.label}</th>)}
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
                    {row.typoHint && (
                      <div className="typo-hint">
                        Possible typo: "{row.typoHint.word}" — did you mean "{row.typoHint.suggestion}"?
                      </div>
                    )}
                  </td>
                  {row.extraRefValues.map((rv) => (
                    <td key={rv.key}>
                      {editable.rowDesc
                        ? <input className="input" value={rv.value} onChange={(e) => rv.onChange(e.target.value)} />
                        : rv.value}
                    </td>
                  ))}
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
              <tr>
                <td><strong>TOTAL</strong></td>
                {blk.extraRefColumns.map((col) => <td key={col.key} />)}
                <td><strong>{blk.blockTotalQty}</strong></td>
                {editable.addRemoveRows && <td />}
              </tr>
            </tbody>
          </table>
          {editable.addRemoveRows && blk.canAddRow && (
            <div className="row-actions">
              <button type="button" className="btn btn-secondary" onClick={blk.addRow}>+ Add Row</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
