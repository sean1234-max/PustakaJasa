import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, MANUAL_MAX_QTY } from '../data/catalog';
import { reconstructOrderDetailGroups } from '../utils/computeBlocks';
import { getOrderCategories, getOrderJenisPlakGroups, getPlakProductionMode, summarizeRowsForManual, buildCsvRows, rowsToCsv, buildCategoryCsvFilename, validateExport } from '../utils/exportCsv';
import { downloadTextFile } from '../utils/downloadBlob';
import { groupItemsByBatch } from '../utils/orderBatches';
import { getOrderChangeStamp } from '../utils/orderStamp';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

export default function ProductionOrderDetail() {
  const { state, ensureOrderLoaded } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);

  const [exportNote, setExportNote] = useState('');
  const exportNoteTimer = useRef(null);
  const [page, setPage] = useState('summary');

  const categories = useMemo(() => (order ? getOrderCategories(order) : []), [order]);
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];

  // One entry per (block, batch) — a category can carry more than one
  // distinct "order detail" (e.g. PBD's Kuantiti and Kedudukan variants, or
  // the same variant reused by a later Add On with a different Jenis Plak),
  // and each needs its own reference-sample view and its own CSV export —
  // merging them would mix rows meant for different physical AI files into
  // one file with no way to tell them apart. See reconstructOrderDetailGroups.
  const detailGroups = useMemo(() => {
    if (!order || !currentCat) return [];
    return reconstructOrderDetailGroups(order, currentCat.key, state.plakCatalog);
  }, [order, currentCat, state.plakCatalog]);

  // Order-wide, not scoped to the selected category tab — the CSV's own
  // columns carry no Jenis Plak info, so two items sharing a Jenis Plak
  // (even from different categories) are bound for the same physical AI
  // file and can be exported as one combined CSV. See getOrderJenisPlakGroups.
  const jenisPlakGroups = useMemo(() => (order ? getOrderJenisPlakGroups(order) : []), [order]);

  // Rows + a hard validation result per Jenis Plak group (see validateExport).
  // `mode` ('csv' | 'manual') is the small-qty split — see getPlakProductionMode:
  // a Jenis Plak with a small enough combined qty is faster hand-typed into
  // Illustrator than exported, so Production gets a checklist instead of a
  // button (but "Export CSV anyway" stays available).
  const jenisPlakExport = useMemo(() => {
    if (!order) return [];
    const modes = getPlakProductionMode(order);
    return jenisPlakGroups.map(({ jenisPlak, items }) => {
      const csvData = buildCsvRows(order, null, items);
      const { mode, totalQty } = modes.get(jenisPlak) || { mode: 'csv', totalQty: 0 };
      return { jenisPlak, items, csvData, mode, totalQty, check: validateExport(order, items, state.plakCatalog, csvData) };
    });
  }, [order, jenisPlakGroups, state.plakCatalog]);

  const manualPlakGroups = useMemo(
    () => jenisPlakExport.filter((g) => g.mode === 'manual'),
    [jenisPlakExport],
  );

  if (!order) return null;

  const stamp = getOrderChangeStamp(order);
  const totalQty = order.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const itemGroups = groupItemsByBatch(order.items);

  // Both export paths refuse a selection that failed validateExport, even
  // if called programmatically — the disabled button is the first line, this
  // is the backstop.
  const handleExportGroup = (group, csvData, check) => {
    if (!check.ok || csvData.rows.length === 0) return;
    const csv = rowsToCsv(csvData.rows);
    const label = [group.blk.qtyLabel, group.batch !== 0 ? group.label : null, group.jenisPlak]
      .filter(Boolean).join(' - ');
    const filename = buildCategoryCsvFilename(order, label);
    downloadTextFile(filename, csv);
    setExportNote(`Exported ${csvData.rows.length} row(s) to ${filename}.`);
    clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = setTimeout(() => setExportNote(''), 4000);
  };

  const handleExportJenisPlak = (jenisPlak, csvData, check) => {
    if (!check.ok || csvData.rows.length === 0) return;
    const csv = rowsToCsv(csvData.rows);
    const filename = buildCategoryCsvFilename(order, jenisPlak);
    downloadTextFile(filename, csv);
    setExportNote(`Exported ${csvData.rows.length} row(s) to ${filename}.`);
    clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = setTimeout(() => setExportNote(''), 4000);
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <button
        type="button"
        className="btn btn-ghost"
        style={{ marginBottom: 'var(--space-4)' }}
        onClick={() => navigate('/production/dashboard')}
      >
        ← Back to Production Orders
      </button>

      <div className="step-header">
        <div className={`step ${page === 'summary' ? 'step-active' : 'step-done'}`} style={{ cursor: 'pointer' }} onClick={() => setPage('summary')}>
          <div className="step-dot">{page === 'summary' ? '1' : '✓'}</div>
          <span>Summary</span>
        </div>
        <div className="step-line" />
        <div className={`step ${page === 'details' ? 'step-active' : 'step-upcoming'}`} style={{ cursor: 'pointer' }} onClick={() => setPage('details')}>
          <div className={`step-dot${page === 'details' ? '' : ' step-dot-outline'}`}>2</div>
          <span>Order Details</span>
        </div>
      </div>

      <div className="card elev-md">
        <div className="order-card-top" style={{ marginBottom: 'var(--space-3)' }}>
          <div>
            <div className="card-kicker">{page === 'summary' ? 'Summary' : 'Order Details'}</div>
            <div className="card-title">{order.id}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {stamp && <span className="order-stamp-inline">{stamp}</span>}
            <span className="status-pill" style={statusPillStyle(order.status)}>{order.status}</span>
          </div>
        </div>

        {page === 'summary' ? (
          <>
            <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
              {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
              {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
              {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
              {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
              {order.dueDate && <div><div className="dim">Due Date</div><div>{formatDate(new Date(order.dueDate))}</div></div>}
              {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
              <div><div className="dim">Date Placed</div><div>{order.datePlaced}</div></div>
              <div><div className="dim">Total Amount</div><div>RM {order.totalAmount.toFixed(2)}</div></div>
            </div>
            {/* Not shown here before this — an import-derived note (a KIV
                line, a wording-only plaque parked here for now) landed in
                this SAME field but had nowhere to actually surface for
                Production, so it went unseen until the teacher happened to
                mention it separately. See AppState.jsx's importFormAnugerahExcel. */}
            {order.remark && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div className="dim">Remark</div>
                <div>{order.remark}</div>
              </div>
            )}

            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Invoice</div>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div className="dim">Invoice Number</div>
              <div>{order.invoiceId || 'Not assigned yet — Invoicing Department handles this.'}</div>
            </div>
            {state.productionToast && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>{state.productionToast}</p>}

            <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
              <span />
              <button type="button" className="btn btn-primary" onClick={() => setPage('details')}>Next: Order Details →</button>
            </div>
          </>
        ) : (
          <>
            <div className="card-kicker" style={{ marginTop: 'var(--space-3)' }}>Jenis Plak / QTY / Harga</div>
            {itemGroups.map((group, gi) => {
              const groupQty = group.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
              const groupHarga = group.items.reduce((sum, it) => sum + it.harga, 0);
              return (
                <div key={group.batch}>
                  {itemGroups.length > 1 && <div className="card-kicker" style={{ marginTop: gi === 0 ? 0 : 'var(--space-6)' }}>{group.label}</div>}
                  <table className="table" style={{ margin: 'var(--space-3) 0 0' }}>
                    <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th></tr></thead>
                    <tbody>
                      {group.items.map((it) => (
                        <tr key={it.id}>
                          <td>{it.categoryLabel}</td>
                          <td>{it.jenisPlak}</td>
                          <td>{it.qty}</td>
                          <td>RM {it.harga.toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td /><td><strong>{itemGroups.length > 1 ? 'SUBTOTAL' : 'TOTAL'}</strong></td>
                        <td><strong>{groupQty}</strong></td>
                        <td><strong>RM {(itemGroups.length > 1 ? groupHarga : order.totalAmount).toFixed(2)}</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
            {itemGroups.length > 1 && (
              <>
                <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>QTY total: {totalQty}</p>
                <div className="combined-total" style={{ marginTop: 'var(--space-4)' }}>
                  <span className="dim">Grand Total:</span> <strong>RM {order.totalAmount.toFixed(2)}</strong>
                </div>
              </>
            )}

            <>
                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Export by Jenis Plak</div>
                <p className="hint-text" style={{ marginTop: 0 }}>
                  One CSV per Jenis Plak — combined across every order detail that uses it (that's one Adobe Illustrator file).
                  A Jenis Plak with {MANUAL_MAX_QTY} keping or fewer in total is marked <strong>BUAT MANUAL</strong>: type those few straight into Illustrator, it's faster than exporting and importing. Its plaque text is listed below.
                </p>
                {jenisPlakGroups.length === 0 ? (
                  <p className="hint-text">No Jenis Plak found for this order.</p>
                ) : (
                  <>
                    <table className="table" style={{ margin: 'var(--space-3) 0' }}>
                      <thead><tr><th>Jenis Plak</th><th style={{ width: 110 }}>Order Details</th><th style={{ width: 80 }}>QTY</th><th style={{ width: 110 }}>Rows</th><th style={{ width: 150 }} /></tr></thead>
                      <tbody>
                        {jenisPlakExport.map(({ jenisPlak, items, csvData, check, mode, totalQty }) => (
                          <tr key={jenisPlak}>
                            <td>{jenisPlak}</td>
                            <td>{items.length}</td>
                            <td>{totalQty}</td>
                            <td>
                              {mode === 'manual'
                                ? <span className="pill-manual">Buat Manual</span>
                                : check.ok ? csvData.rows.length : <span style={{ color: '#b0392e', fontWeight: 700 }}>blocked</span>}
                            </td>
                            <td>
                              {mode === 'manual' ? (
                                <button type="button" className="btn btn-ghost" disabled={!check.ok || csvData.rows.length === 0} onClick={() => handleExportJenisPlak(jenisPlak, csvData, check)}>
                                  Export CSV anyway
                                </button>
                              ) : (
                                <button type="button" className="btn btn-primary" disabled={!check.ok || csvData.rows.length === 0} onClick={() => handleExportJenisPlak(jenisPlak, csvData, check)}>
                                  Export CSV
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {manualPlakGroups.length > 0 && (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        {manualPlakGroups.map(({ jenisPlak, totalQty, csvData }) => {
                          const engrave = summarizeRowsForManual(csvData.rows);
                          return (
                            <div key={jenisPlak} style={{ marginBottom: 'var(--space-3)' }}>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>
                                <span className="pill-manual" style={{ marginRight: 8 }}>Buat Manual</span>
                                {jenisPlak} — {totalQty} keping
                              </div>
                              {engrave.length > 0 ? (
                                <ul className="manual-engrave-list">
                                  {engrave.map((e) => (
                                    <li key={e.text}>{e.count} ×&nbsp; {e.text}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="hint-text" style={{ marginTop: 2 }}>
                                  See the “Export by Category” section below for the full engraving text.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {jenisPlakExport.filter((g) => !g.check.ok).map((g) => (
                      <p key={g.jenisPlak} className="hint-text" style={{ color: '#b0392e', fontWeight: 600 }}>
                        ⚠ {g.jenisPlak}: {g.check.errors.join(' ')}
                      </p>
                    ))}
                    {jenisPlakExport.flatMap((g) => g.check.warnings.map((w) => (
                      <p key={`${g.jenisPlak}-${w}`} className="hint-text" style={{ color: '#b45309' }}>{g.jenisPlak}: {w}</p>
                    )))}
                  </>
                )}
                {exportNote && <p className="hint-text">{exportNote}</p>}

                <div className="hint-text" style={{ marginTop: 'var(--space-6)', fontWeight: 600, opacity: 0.8 }}>Export by Category (for review)</div>
                {categories.length === 0 ? (
                  <p className="hint-text">No exportable categories found for this order.</p>
                ) : (
                  <>
                    <div style={{ margin: 'var(--space-3) 0' }}>
                      <CategoryTabs categories={categories} active={currentCat?.key} onSelect={setActiveCat} />
                    </div>

                    {detailGroups.length === 0 && <p className="hint-text">No order details found for this category.</p>}
                    {detailGroups.map((group, gi) => {
                      if (!group.blk) return null;
                      const csvData = buildCsvRows(order, currentCat.key, group.items);
                      const check = validateExport(order, group.items, state.plakCatalog, csvData);
                      return (
                        <div
                          key={group.items[0].id}
                          style={gi > 0 ? { marginTop: 'var(--space-8)', paddingTop: 'var(--space-8)', borderTop: '1px solid var(--color-neutral-300)' } : undefined}
                        >
                          <div className="card-kicker">
                            {group.blk.qtyLabel}{group.batch !== 0 ? ` — ${group.label}` : ''} — {group.jenisPlak}
                          </div>
                          <OrderCategoryBlock blk={group.blk} editable={READONLY} />

                          {check.errors.map((e) => (
                            <p key={e} className="hint-text" style={{ color: '#b0392e', fontWeight: 600 }}>⚠ {e}</p>
                          ))}
                          {check.warnings.map((w) => (
                            <p key={w} className="hint-text" style={{ color: '#b45309' }}>{w}</p>
                          ))}
                          {check.ok && csvData.rows.length > 0 && (
                            <p className="hint-text">{csvData.rows.length} row(s) ready to export.</p>
                          )}

                          <div className="row-split" style={{ marginTop: 'var(--space-3)' }}>
                            <span />
                            <button type="button" className="btn btn-primary" disabled={!check.ok || csvData.rows.length === 0} onClick={() => handleExportGroup(group, csvData, check)}>
                              Export CSV
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {exportNote && <p className="hint-text">{exportNote}</p>}
                  </>
                )}
              </>

            <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPage('summary')}>← Back to Summary</button>
              <span />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
