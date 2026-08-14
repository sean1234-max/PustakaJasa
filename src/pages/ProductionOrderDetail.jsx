import { useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT, formatDate } from '../data/catalog';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { getOrderCategories, buildCsvRows, rowsToCsv, buildCategoryCsvFilename } from '../utils/exportCsv';
import { downloadTextFile } from '../utils/downloadBlob';
import { groupItemsByBatch } from '../utils/orderBatches';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false, namaKelas: false };

export default function ProductionOrderDetail() {
  const { state, setInvoiceId } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);

  const [invoiceDraft, setInvoiceDraft] = useState('');
  const [exportNote, setExportNote] = useState('');
  const exportNoteTimer = useRef(null);
  const [page, setPage] = useState('summary');

  const categories = useMemo(() => (order ? getOrderCategories(order) : []), [order]);
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];

  const catBlocks = useMemo(() => {
    if (!order || !currentCat) return [];
    return reconstructBlocksForCategory(order, currentCat.key, state.plakCatalog).blocks;
  }, [order, currentCat, state.plakCatalog]);

  const csvData = useMemo(() => {
    if (!order || !currentCat) return { rows: [], skippedItemIds: [] };
    return buildCsvRows(order, currentCat.key);
  }, [order, currentCat]);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(order.status);
  const totalQty = order.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const itemGroups = groupItemsByBatch(order.items);

  const handleSaveInvoice = () => {
    setInvoiceId(order.id, invoiceDraft);
    setInvoiceDraft('');
  };

  const handleExport = () => {
    if (!currentCat || csvData.rows.length === 0) return;
    const csv = rowsToCsv(csvData.rows);
    const filename = buildCategoryCsvFilename(order, currentCat.label);
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
          <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{order.status}</span>
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

            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Invoice</div>
            {order.invoiceId ? (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <div className="dim">Invoice ID</div>
                <div>{order.invoiceId}</div>
              </div>
            ) : (
              <div className="field" style={{ maxWidth: 340, marginTop: 'var(--space-2)' }}>
                <label htmlFor="invoiceId">Invoice ID</label>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    className="input"
                    id="invoiceId"
                    placeholder="e.g. INV-2026-090"
                    value={invoiceDraft}
                    onChange={(e) => setInvoiceDraft(e.target.value)}
                  />
                  <button type="button" className="btn btn-primary" onClick={handleSaveInvoice}>Save</button>
                </div>
              </div>
            )}
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

            {order.invoiceId ? (
              <>
                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Export by Category</div>
                {categories.length === 0 ? (
                  <p className="hint-text">No exportable categories found for this order.</p>
                ) : (
                  <>
                    <div style={{ margin: 'var(--space-3) 0' }}>
                      <CategoryTabs categories={categories} active={currentCat?.key} onSelect={setActiveCat} />
                    </div>

                    {catBlocks.map((blk) => (
                      <OrderCategoryBlock key={blk.idx} blk={blk} editable={READONLY} refImageUrl={state.refImages?.[blk.sampleSlotId]} />
                    ))}

                    {csvData.rows.length === 0 ? (
                      <p className="hint-text">No reference sample data to export for this category.</p>
                    ) : (
                      <>
                        {csvData.skippedItemIds.length > 0 && (
                          <p className="hint-text">{csvData.skippedItemIds.length} item(s) skipped — no reference sample data.</p>
                        )}
                        <p className="hint-text">{csvData.rows.length} row(s) ready to export.</p>
                      </>
                    )}

                    <div className="row-split" style={{ marginTop: 'var(--space-3)' }}>
                      <span />
                      <button type="button" className="btn btn-primary" disabled={csvData.rows.length === 0} onClick={handleExport}>
                        Export CSV
                      </button>
                    </div>
                    {exportNote && <p className="hint-text">{exportNote}</p>}
                  </>
                )}
              </>
            ) : (
              <p className="hint-text" style={{ marginTop: 'var(--space-6)' }}>Enter an Invoice ID on the Summary page before exporting.</p>
            )}

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
