import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import CorrectedExcelControl from '../components/CorrectedExcelControl';
import PriceTable from '../components/PriceTable';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, MANUAL_MAX_QTY } from '../data/catalog';
import { reconstructOrderDetailGroups, reconstructBlocksForCategory } from '../utils/computeBlocks';
import { getExportableCategories, splitOrderCategories, getOrderJenisPlakGroups, getPlakProductionMode, summarizeRowsForManual, buildCsvRows, rowsToCsv, buildCategoryCsvFilename, combineCsvRows, buildCombinedCsvFilename, validateExport } from '../utils/exportCsv';
import { downloadTextFile } from '../utils/downloadBlob';
import { getOrderImportUrl } from '../lib/storageApi';
import { getOrderChangeStamp } from '../utils/orderStamp';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

// Downloads the teacher's original FORM ANUGERAH upload (0055) via a
// short-lived signed URL — for cross-checking the order against the file.
async function downloadOrderImport(order, setErr) {
  setErr('');
  const url = await getOrderImportUrl(order.importFilePath);
  if (!url) { setErr('Could not download the file right now. Please try again.'); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = order.importFileName || 'order.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ProductionOrderDetail() {
  const { state, ensureOrderLoaded, loadCorrectedExcelPreview } = useAppState();
  const [importErr, setImportErr] = useState('');
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);

  // Re-derived from order.correctedImportFilePath whenever this order has
  // one (see loadCorrectedExcelPreview) — null while there's none, or
  // before the re-parse finishes, so `effectiveOrder` below falls back to
  // the order's own items until it resolves.
  const [correctedItems, setCorrectedItems] = useState(null);
  const [correctedWarnings, setCorrectedWarnings] = useState([]);
  const [correctedLoading, setCorrectedLoading] = useState(false);
  const [correctedError, setCorrectedError] = useState('');
  useEffect(() => {
    setCorrectedItems(null);
    setCorrectedWarnings([]);
    setCorrectedError('');
    if (!order?.correctedImportFilePath) return;
    let cancelled = false;
    setCorrectedLoading(true);
    loadCorrectedExcelPreview(order).then((res) => {
      if (cancelled) return;
      setCorrectedLoading(false);
      if (res.ok) { setCorrectedItems(res.items); setCorrectedWarnings(res.warnings || []); }
      else setCorrectedError(res.message || 'Could not re-read the corrected file.');
    });
    return () => { cancelled = true; };
    // Deliberately NOT `order` in full — a realtime status/pricing update on
    // this order shouldn't re-trigger a full re-parse of the (unchanged)
    // corrected file; only a genuinely new file (path changes) should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.correctedImportFilePath, loadCorrectedExcelPreview]);

  // Every export below reads from this, never from `order` directly — once
  // a corrected Excel is on file, its freshly-parsed items stand in for
  // order.items everywhere export-related (categories, CSV rows, the
  // Jenis Plak table); order.totalAmount/status/pricing/stock are
  // untouched regardless, since the Summary tab and Nav still read `order`
  // itself.
  const effectiveOrder = useMemo(
    () => (correctedItems ? { ...order, items: correctedItems } : order),
    [order, correctedItems],
  );

  const [exportNote, setExportNote] = useState('');
  const exportNoteTimer = useRef(null);
  const [page, setPage] = useState('summary');

  const categories = useMemo(() => (effectiveOrder ? getExportableCategories(effectiveOrder) : []), [effectiveOrder]);
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];
  // SELEMPANG — Production makes nothing for it, so it's kept out of every
  // export tab/CSV and shown read-only just so they can see it was ordered.
  const selempangBlocks = useMemo(() => {
    if (!effectiveOrder) return [];
    return splitOrderCategories(effectiveOrder).selempang
      .flatMap((cat) => reconstructBlocksForCategory(effectiveOrder, cat.key, state.plakCatalog).blocks);
  }, [effectiveOrder, state.plakCatalog]);

  // One entry per (block, batch) — a category can carry more than one
  // distinct "order detail" (e.g. PBD's Kuantiti and Kedudukan variants, or
  // the same variant reused by a later Add On with a different Jenis Plak),
  // and each needs its own reference-sample view and its own CSV export —
  // merging them would mix rows meant for different physical AI files into
  // one file with no way to tell them apart. See reconstructOrderDetailGroups.
  const detailGroups = useMemo(() => {
    if (!effectiveOrder || !currentCat) return [];
    return reconstructOrderDetailGroups(effectiveOrder, currentCat.key, state.plakCatalog);
  }, [effectiveOrder, currentCat, state.plakCatalog]);

  // Scoped to (category, Jenis Plak) — never combined across categories,
  // since two categories can share a Jenis Plak (same physical AI file)
  // while needing different reference-sample layouts. See
  // getOrderJenisPlakGroups.
  const jenisPlakGroups = useMemo(() => (effectiveOrder ? getOrderJenisPlakGroups(effectiveOrder) : []), [effectiveOrder]);

  // Rows + a hard validation result per (category, Jenis Plak) group (see
  // validateExport). `mode` ('csv' | 'manual') is the small-qty split — see
  // getPlakProductionMode: a group with a small enough combined qty is
  // faster hand-typed into Illustrator than exported, so Production gets a
  // checklist instead of a button (but "Export CSV anyway" stays available).
  const jenisPlakExport = useMemo(() => {
    if (!effectiveOrder) return [];
    const modes = getPlakProductionMode(effectiveOrder);
    return jenisPlakGroups.map((group) => {
      const csvData = buildCsvRows(effectiveOrder, null, group.items);
      const { mode, totalQty } = modes.get(group.groupKey) || { mode: 'csv', totalQty: 0 };
      return { ...group, csvData, mode, totalQty, check: validateExport(effectiveOrder, group.items, state.plakCatalog, csvData) };
    });
  }, [effectiveOrder, jenisPlakGroups, state.plakCatalog]);

  const manualPlakGroups = useMemo(
    () => jenisPlakExport.filter((g) => g.mode === 'manual'),
    [jenisPlakExport],
  );

  if (!order) return null;

  const stamp = getOrderChangeStamp(order);
  const totalQty = effectiveOrder.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const effectiveTotalAmount = effectiveOrder.items.reduce((sum, it) => sum + it.harga, 0);

  // Both export paths refuse a selection that failed validateExport, even
  // if called programmatically — the disabled button is the first line, this
  // is the backstop.
  const handleExportGroup = (group, csvData, check) => {
    if (!check.ok || csvData.rows.length === 0) return;
    const csv = rowsToCsv(csvData.rows);
    const label = [group.blk.qtyLabel, group.batch !== 0 ? group.label : null, group.jenisPlak]
      .filter(Boolean).join(' - ');
    const filename = buildCategoryCsvFilename(order, label, currentCat?.key);
    downloadTextFile(filename, csv);
    setExportNote(`Exported ${csvData.rows.length} row(s) to ${filename}.`);
    clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = setTimeout(() => setExportNote(''), 4000);
  };

  const handleExportJenisPlak = (group, csvData, check) => {
    if (!check.ok || csvData.rows.length === 0) return;
    const csv = rowsToCsv(csvData.rows);
    const filename = buildCategoryCsvFilename(order, `${group.categoryLabel} - ${group.jenisPlak}`, group.categoryKey);
    downloadTextFile(filename, csv);
    setExportNote(`Exported ${csvData.rows.length} row(s) to ${filename}.`);
    clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = setTimeout(() => setExportNote(''), 4000);
  };

  // Every (category, Jenis Plak) group's rows, one file — blocked outright
  // if any group is itself blocked (validateExport), same "never let bad
  // data leave the app" rule as the per-group export.
  const combinedRows = combineCsvRows(jenisPlakExport);
  const combinedOk = jenisPlakExport.length > 0 && jenisPlakExport.every((g) => g.check.ok) && combinedRows.length > 0;
  const handleExportCombined = () => {
    if (!combinedOk) return;
    const csv = rowsToCsv(combinedRows);
    const filename = buildCombinedCsvFilename(order);
    downloadTextFile(filename, csv);
    setExportNote(`Exported ${combinedRows.length} row(s) to ${filename}.`);
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
            {/* Corrected Excel present — every export below already reads
                from it (see effectiveOrder), this just makes that visible
                at a glance without opening the order. */}
            {order.correctedImportFilePath && (
              <span className="status-pill" style={{ background: '#fff4ce', color: '#8a6d00' }}>Excel Updated</span>
            )}
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
              {order.shipmentDate && <div><div className="dim">Shipment Date</div><div>{formatDate(new Date(order.shipmentDate))}</div></div>}
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

            {order.importFilePath && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div className="dim">Original Excel (from the teacher)</div>
                <button type="button" className="btn btn-primary" style={{ marginTop: 4 }} onClick={() => downloadOrderImport(order, setImportErr)}>
                  ⬇ {order.importFileName || 'Download file'}
                </button>
                {importErr && <div className="login-error" style={{ marginTop: 4 }}>{importErr}</div>}
              </div>
            )}

            <CorrectedExcelControl
              order={order}
              onUploaded={(items, warnings) => { setCorrectedItems(items); setCorrectedWarnings(warnings || []); setCorrectedError(''); }}
            />
            {correctedLoading && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>Re-reading the corrected file…</p>}
            {correctedError && <p className="hint-text" style={{ color: '#b0392e', fontWeight: 600, marginTop: 'var(--space-2)' }}>⚠ {correctedError} — export is showing the original data instead.</p>}
            {correctedWarnings.length > 0 && correctedWarnings.map((w) => (
              <p key={w} className="hint-text" style={{ color: '#b45309', marginTop: 'var(--space-2)' }}>⚠ {w}</p>
            ))}

            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Invoice</div>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div className="dim">Invoice Number</div>
              <div>{order.invoiceId || 'Not assigned yet — Store Admin handles this.'}</div>
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
            <p className="hint-text" style={{ marginTop: 0 }}>
              Combined by Jenis Plak, not Category — the same code bought for two different categories is one line here. Selempang has its own detail block below (it's never combined into this table); TOKOH's per-honoree names aren't needed here at all — export by Category further down still shows every name.
            </p>
            <PriceTable
              rows={effectiveOrder.items} editable={false} priceDrafts={{}} setPrice={() => {}}
              plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={effectiveTotalAmount} priceAdjusted={false}
              hideCategory combineJenisPlak
            />

            {selempangBlocks.length > 0 && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                {selempangBlocks.map((blk) => (
                  <OrderCategoryBlock key={`sel-${blk.idx}`} blk={blk} editable={READONLY} />
                ))}
              </div>
            )}

            <>
                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Export by Jenis Plak</div>
                <p className="hint-text" style={{ marginTop: 0 }}>
                  One CSV per Category + Jenis Plak — combined across every order detail that uses the same category and Jenis Plak (that's one Adobe Illustrator file). Never combined across different categories, even when they share a Jenis Plak, since each category's reference-sample layout can differ.
                  A group with {MANUAL_MAX_QTY} keping or fewer in total is marked <strong>BUAT MANUAL</strong>: type those few straight into Illustrator, it's faster than exporting and importing. Its plaque text is listed below.
                </p>
                {jenisPlakGroups.length > 0 && (
                  <div style={{ margin: 'var(--space-3) 0' }}>
                    <button type="button" className="btn btn-primary" disabled={!combinedOk} onClick={handleExportCombined}>
                      ⬇ Download Combined CSV{combinedRows.length > 0 ? ` (${combinedRows.length} rows)` : ''}
                    </button>
                    <p className="hint-text" style={{ marginTop: 4 }}>
                      Every group above, in one file — each row still carries its own Category and Jenis Plak column. Disabled if any group below is blocked.
                    </p>
                  </div>
                )}
                {jenisPlakGroups.length === 0 ? (
                  <p className="hint-text">No Jenis Plak found for this order.</p>
                ) : (
                  <>
                    <table className="table" style={{ margin: 'var(--space-3) 0' }}>
                      <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>Order Details</th><th style={{ width: 80 }}>QTY</th><th style={{ width: 110 }}>Rows</th><th style={{ width: 150 }} /></tr></thead>
                      <tbody>
                        {jenisPlakExport.map((group) => {
                          const { groupKey, categoryLabel, jenisPlak, items, csvData, check, mode, totalQty } = group;
                          return (
                          <tr key={groupKey}>
                            <td>{categoryLabel}</td>
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
                                <button type="button" className="btn btn-ghost" disabled={!check.ok || csvData.rows.length === 0} onClick={() => handleExportJenisPlak(group, csvData, check)}>
                                  Export CSV anyway
                                </button>
                              ) : (
                                <button type="button" className="btn btn-primary" disabled={!check.ok || csvData.rows.length === 0} onClick={() => handleExportJenisPlak(group, csvData, check)}>
                                  Export CSV
                                </button>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {manualPlakGroups.length > 0 && (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        {manualPlakGroups.map(({ groupKey, categoryLabel, jenisPlak, totalQty, csvData }) => {
                          const engrave = summarizeRowsForManual(csvData.rows);
                          return (
                            <div key={groupKey} style={{ marginBottom: 'var(--space-3)' }}>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>
                                <span className="pill-manual" style={{ marginRight: 8 }}>Buat Manual</span>
                                {categoryLabel} — {jenisPlak} — {totalQty} keping
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
                      <p key={g.groupKey} className="hint-text" style={{ color: '#b0392e', fontWeight: 600 }}>
                        ⚠ {g.categoryLabel} — {g.jenisPlak}: {g.check.errors.join(' ')}
                      </p>
                    ))}
                    {jenisPlakExport.flatMap((g) => g.check.warnings.map((w) => (
                      <p key={`${g.groupKey}-${w}`} className="hint-text" style={{ color: '#b45309' }}>{g.categoryLabel} — {g.jenisPlak}: {w}</p>
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
                      const csvData = buildCsvRows(effectiveOrder, currentCat.key, group.items);
                      const check = validateExport(effectiveOrder, group.items, state.plakCatalog, csvData);
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
