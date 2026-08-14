import { useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { getOrderCategories, buildCsvRows, rowsToCsv, buildCategoryCsvFilename } from '../utils/exportCsv';
import { downloadTextFile } from '../utils/downloadBlob';
import { groupItemsByBatch } from '../utils/orderBatches';

// Admin-only fork of ProductionOrderDetail.jsx — same order data and the
// same AppState handler (setInvoiceId), restyled to match the Admin Portal
// redesign. Kept separate rather than sharing one component with
// /production/orders/:id because that route needs to keep Production's own
// (unredesigned) look — see AdminLayout.jsx's header comment.
const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false, namaKelas: false };

export default function AdminOrderDetail() {
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

  if (!order) return <AdminLayout title="Order Details"><p className="text-body-md text-on-surface-variant">Order not found.</p></AdminLayout>;

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
    <AdminLayout>
      <button type="button" onClick={() => navigate('/admin/orders')} className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors w-fit mb-6">
        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        <span className="text-label-bold font-semibold">Back to Orders</span>
      </button>

      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={() => setPage('summary')}
          className={`flex items-center gap-2 text-label-bold font-semibold ${page === 'summary' ? 'text-primary' : 'text-on-surface-variant'}`}
        >
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${page === 'summary' ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
            {page === 'summary' ? '1' : '✓'}
          </span>
          Summary
        </button>
        <div className="h-px w-10 bg-outline-variant" />
        <button
          type="button"
          onClick={() => setPage('details')}
          className={`flex items-center gap-2 text-label-bold font-semibold ${page === 'details' ? 'text-primary' : 'text-on-surface-variant'}`}
        >
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border ${page === 'details' ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant'}`}>2</span>
          Order Details
        </button>
      </div>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-6 md:p-8">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="text-label-bold text-on-surface-variant uppercase tracking-widest block mb-1">{page === 'summary' ? 'Summary' : 'Order Details'}</span>
            <h2 className="text-headline-md text-on-surface">{order.id}</h2>
          </div>
          <span className="px-3 py-1 rounded-md text-label-bold font-semibold" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{order.status}</span>
        </div>

        {page === 'summary' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              {order.sekolah && <div><span className="text-body-sm text-on-surface-variant block mb-0.5">Sekolah</span><span className="text-body-md text-on-surface">{order.sekolah}</span></div>}
              {order.picName && <div><span className="text-body-sm text-on-surface-variant block mb-0.5">PIC Name</span><span className="text-body-md text-on-surface">{order.picName}{order.phone ? ` / ${order.phone}` : ''}</span></div>}
              <div><span className="text-body-sm text-on-surface-variant block mb-0.5">Date Placed</span><span className="text-body-md text-on-surface">{order.datePlaced}</span></div>
              <div><span className="text-body-sm text-on-surface-variant block mb-0.5">Total Amount</span><span className="text-body-md text-on-surface">RM {order.totalAmount.toFixed(2)}</span></div>
            </div>

            <h3 className="text-label-bold text-on-surface-variant uppercase tracking-widest mt-8 mb-2">Invoice</h3>
            {order.invoiceId ? (
              <div>
                <span className="text-body-sm text-on-surface-variant block mb-0.5">Invoice ID</span>
                <span className="text-body-md text-on-surface">{order.invoiceId}</span>
              </div>
            ) : (
              <div className="max-w-md">
                <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="invoiceId">Invoice ID</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border border-outline-variant rounded-lg px-4 py-2.5 text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    id="invoiceId"
                    placeholder="e.g. INV-2026-090"
                    value={invoiceDraft}
                    onChange={(e) => setInvoiceDraft(e.target.value)}
                  />
                  <button type="button" onClick={handleSaveInvoice} className="bg-primary text-on-primary text-label-bold font-semibold px-5 py-2.5 rounded-lg hover:bg-primary/90 transition-colors">Save</button>
                </div>
              </div>
            )}
            {state.productionToast && <p className="text-body-sm text-on-surface-variant mt-2">{state.productionToast}</p>}

            <div className="flex justify-end mt-8">
              <button type="button" onClick={() => setPage('details')} className="bg-primary text-on-primary text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-primary/90 transition-colors">Next: Order Details →</button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-label-bold text-on-surface-variant uppercase tracking-widest mt-6 mb-2">Jenis Plak / QTY / Harga</h3>
            {itemGroups.map((group, gi) => {
              const groupQty = group.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
              const groupHarga = group.items.reduce((sum, it) => sum + it.harga, 0);
              return (
                <div key={group.batch}>
                  {itemGroups.length > 1 && <h4 className={`text-label-bold text-on-surface-variant uppercase tracking-widest mb-1 ${gi === 0 ? 'mt-0' : 'mt-4'}`}>{group.label}</h4>}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-outline-variant">
                          <th className="py-2 pr-4 text-label-bold text-on-surface-variant uppercase">Category</th>
                          <th className="py-2 pr-4 text-label-bold text-on-surface-variant uppercase">Jenis Plak</th>
                          <th className="py-2 pr-4 text-label-bold text-on-surface-variant uppercase w-24">QTY</th>
                          <th className="py-2 text-label-bold text-on-surface-variant uppercase w-32">Harga</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant text-body-md text-on-surface">
                        {group.items.map((it) => (
                          <tr key={it.id}>
                            <td className="py-2 pr-4">{it.categoryLabel}</td>
                            <td className="py-2 pr-4">{it.jenisPlak}</td>
                            <td className="py-2 pr-4">{it.qty}</td>
                            <td className="py-2">RM {it.harga.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="py-2" />
                          <td className="py-2">{itemGroups.length > 1 ? 'SUBTOTAL' : 'TOTAL'}</td>
                          <td className="py-2">{groupQty}</td>
                          <td className="py-2">RM {(itemGroups.length > 1 ? groupHarga : order.totalAmount).toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {itemGroups.length > 1 && (
              <div className="flex justify-between items-center mt-4 pt-4 border-t border-outline-variant">
                <span className="text-body-sm text-on-surface-variant">QTY total: {totalQty}</span>
                <span className="text-headline-sm text-on-surface">Grand Total: RM {order.totalAmount.toFixed(2)}</span>
              </div>
            )}

            {order.invoiceId ? (
              <>
                <h3 className="text-label-bold text-on-surface-variant uppercase tracking-widest mt-8 mb-2">Export by Category</h3>
                {categories.length === 0 ? (
                  <p className="text-body-md text-on-surface-variant">No exportable categories found for this order.</p>
                ) : (
                  <>
                    <div className="my-3">
                      <CategoryTabs categories={categories} active={currentCat?.key} onSelect={setActiveCat} />
                    </div>

                    {catBlocks.map((blk) => (
                      <OrderCategoryBlock key={blk.idx} blk={blk} editable={READONLY} refImageUrl={state.refImages?.[blk.sampleSlotId]} />
                    ))}

                    {csvData.rows.length === 0 ? (
                      <p className="text-body-md text-on-surface-variant">No reference sample data to export for this category.</p>
                    ) : (
                      <>
                        {csvData.skippedItemIds.length > 0 && (
                          <p className="text-body-md text-on-surface-variant">{csvData.skippedItemIds.length} item(s) skipped — no reference sample data.</p>
                        )}
                        <p className="text-body-md text-on-surface-variant">{csvData.rows.length} row(s) ready to export.</p>
                      </>
                    )}

                    <div className="flex justify-end mt-3">
                      <button type="button" disabled={csvData.rows.length === 0} onClick={handleExport} className="bg-primary text-on-primary text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                        Export CSV
                      </button>
                    </div>
                    {exportNote && <p className="text-body-md text-on-surface-variant mt-2">{exportNote}</p>}
                  </>
                )}
              </>
            ) : (
              <p className="text-body-md text-on-surface-variant mt-8">Enter an Invoice ID on the Summary page before exporting.</p>
            )}

            <div className="flex justify-between mt-8">
              <button type="button" onClick={() => setPage('summary')} className="text-label-bold font-semibold text-on-surface hover:text-primary transition-colors">← Back to Summary</button>
            </div>
          </>
        )}
      </section>
    </AdminLayout>
  );
}
