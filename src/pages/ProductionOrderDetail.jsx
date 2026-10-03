import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav';
import ConfirmButton from '../components/ConfirmButton';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import CorrectedExcelControl from '../components/CorrectedExcelControl';
import PriceTable from '../components/PriceTable';
import OrderPrintout from '../components/OrderPrintout';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, MANUAL_MAX_QTY, deliveryStageForShipmentDate, toMalaysiaDay, malaysiaToday, isReviewed } from '../data/catalog';
import { reconstructOrderDetailGroups, reconstructBlocksForCategory, noopUpdaters } from '../utils/computeBlocks';
import { getExportableCategories, splitOrderCategories, getOrderJenisPlakGroups, getPlakProductionMode, summarizeRowsForManual, buildCsvRows, rowsToCsv, buildCategoryCsvFilename, combineCsvRows, buildCombinedCsvFilename, validateExport, getInvoiceIdForJenisPlak, getPartialSplitNotes } from '../utils/exportCsv';
import { downloadTextFile } from '../utils/downloadBlob';
import { getInvoiceItems } from '../utils/orderBatches';
import { getOrderImportUrl } from '../lib/storageApi';
import { getAiFileHelperStatus, startAiFileHelperJob, getAiFileHelperJob } from '../lib/aiFileHelper';
import { getOrderChangeStamp } from '../utils/orderStamp';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };
// Production may still drag the Reference Sample rows into a new order — nothing else.
const REORDER_ONLY = { ...READONLY, lineOrder: true };

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
  const { state, ensureOrderLoaded, loadCorrectedExcelPreview, updateReferenceOrder, markReviewDone } = useAppState();
  const [importErr, setImportErr] = useState('');
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const order = state.orders.find((o) => o.id === id);
  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);

  // Opened from one specific invoice's card on the Production dashboard (a
  // split order shows one card per invoice, see ProductionDashboard.jsx/
  // getOrderInvoiceSlices) — ?invoice= says which one, so both the Export
  // by Jenis Plak table and the Export by Category tabs below only show
  // (and let Production export) the Jenis Plak actually billed under THAT
  // invoice, instead of mixing every invoice's plaques into one page no
  // matter which card was clicked. Absent, or on an un-split order (no
  // invoiceGroups to slice by), shows everything — same as before this
  // existed. The exported CSV content was already correct per invoice even
  // before this (each (category, Jenis Plak) group is inherently ONE
  // invoice's data, see getOrderJenisPlakGroups) — this only changes what's
  // visible/exportable from this page at a glance.
  const viewInvoiceId = searchParams.get('invoice') || null;
  const isFiltered = !!viewInvoiceId && !!(order?.invoiceGroups || []).length;
  // A split order's invoices can each be marked Done independently
  // (markProductionDone, AppState.jsx) and carry their own `status` on the
  // matching invoiceGroups entry — falls back to the whole order's status
  // when viewing unfiltered, or when this invoice was never marked done on
  // its own yet, same as getOrderInvoiceSlices (src/utils/orderBatches.js).
  const viewGroup = isFiltered ? (order.invoiceGroups || []).find((g) => g.invoiceId === viewInvoiceId) : null;
  const sliceStatus = viewGroup?.status || order?.status;
  // Production alone sees In Production split: not typed yet = "Typing" (0078).
  const sliceLabel = sliceStatus === 'In Production' && !(viewGroup ? viewGroup.typedAt : order?.typedAt) ? 'Typing' : sliceStatus;

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
  // Production's own Reference Sample row order (updateReferenceOrder) is
  // saved on the order's items, so it's carried over onto the re-read file.
  const effectiveOrder = useMemo(() => {
    if (!correctedItems) return order;
    const savedRefOrders = Object.fromEntries((order.items || []).flatMap((it) => (
      Object.entries(it.detail?.lines || {}).filter(([k]) => k.endsWith('::refOrder'))
    )));
    const items = correctedItems.map((it) => {
      const key = `${it.categoryKey}::${it.blockIdx ?? 0}::refOrder`;
      return it.detail && savedRefOrders[key]
        ? { ...it, detail: { ...it.detail, lines: { ...(it.detail.lines || {}), [key]: savedRefOrders[key] } } }
        : it;
    });
    return { ...order, items };
  }, [order, correctedItems]);

  // The row order stays changeable from submit until the Shipment Date
  // itself (same calendar rule as the Shipped/Completed status) — a teacher
  // may phone in a change after submitting. Saved on every drop.
  const canReorder = !!order && order.status !== 'Cancelled'
    && deliveryStageForShipmentDate(order.shipmentDate, malaysiaToday()) !== 'Completed';
  const [refOrderNote, setRefOrderNote] = useState('');
  const reorderUpdaters = useMemo(() => (canReorder ? {
    ...noopUpdaters,
    onLine: async (key, value) => {
      const ok = await updateReferenceOrder(order.id, key, value);
      setRefOrderNote(ok
        ? 'New row order saved — export the CSV / Generate AI File again to use it. 顺序已保存，请重新 export / generate。'
        : 'Could not save the new row order. Please try again. 顺序没有保存，请再试一次。');
    },
  } : noopUpdaters), [canReorder, order?.id, updateReferenceOrder]);

  const [exportNote, setExportNote] = useState('');
  const exportNoteTimer = useRef(null);
  const [aiFileJob, setAiFileJob] = useState(null);
  const [aiFileChecking, setAiFileChecking] = useState(false);
  const [aiFileErr, setAiFileErr] = useState('');
  const [page, setPage] = useState('summary');

  // While this computer's AI File helper is running the job, poll it every
  // 3s. The job lives only in that helper (no server-side record), so a page
  // refresh just stops showing progress — the run itself carries on.
  const activeAiFileJobId = aiFileJob && (aiFileJob.status === 'queued' || aiFileJob.status === 'running') ? aiFileJob.id : null;
  useEffect(() => {
    if (!activeAiFileJobId) return undefined;
    const timer = setInterval(async () => {
      const updated = await getAiFileHelperJob(activeAiFileJobId);
      setAiFileJob(updated || { id: activeAiFileJobId, status: 'error', message: 'The AI File helper on this computer stopped responding.', files: [] });
    }, 3000);
    return () => clearInterval(timer);
  }, [activeAiFileJobId]);

  const allCategories = useMemo(() => (effectiveOrder ? getExportableCategories(effectiveOrder) : []), [effectiveOrder]);
  // When viewing one specific invoice (see isFiltered above), drop a
  // category entirely once NONE of its items are billed under that invoice
  // — no point showing an empty tab for a category whose Jenis Plak all
  // belong to a different invoice.
  const categories = useMemo(() => {
    if (!isFiltered) return allCategories;
    return allCategories.filter((cat) => (effectiveOrder.items || []).some((it) => (
      it.categoryKey === cat.key && getInvoiceIdForJenisPlak(effectiveOrder, it.jenisPlak) === viewInvoiceId
    )));
  }, [allCategories, effectiveOrder, isFiltered, viewInvoiceId]);
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
  // one file with no way to tell them apart. See reconstructOrderDetailGroups
  // (a one-item-per-row sheet like UMUM is the exception: its rows show as
  // one table). Filtered by invoice item by item before grouping.
  const detailGroups = useMemo(() => {
    if (!effectiveOrder || !currentCat) return [];
    const scoped = isFiltered
      ? { ...effectiveOrder, items: effectiveOrder.items.filter((it) => getInvoiceIdForJenisPlak(effectiveOrder, it.jenisPlak) === viewInvoiceId) }
      : effectiveOrder;
    return reconstructOrderDetailGroups(scoped, currentCat.key, state.plakCatalog, reorderUpdaters);
  }, [effectiveOrder, currentCat, state.plakCatalog, isFiltered, viewInvoiceId, reorderUpdaters]);

  // Scoped to (category, Jenis Plak) — never combined across categories,
  // since two categories can share a Jenis Plak (same physical AI file)
  // while needing different reference-sample layouts. See
  // getOrderJenisPlakGroups. Filtered by invoice the same way as
  // detailGroups above — every downstream export (jenisPlakExport,
  // combinedRows/handleExportCombined) derives from this, so the "Export by
  // Jenis Plak" table AND the Combined CSV button both narrow down to just
  // the invoice being viewed for free.
  const jenisPlakGroups = useMemo(() => {
    const groups = effectiveOrder ? getOrderJenisPlakGroups(effectiveOrder) : [];
    if (!isFiltered) return groups;
    return groups.filter((g) => getInvoiceIdForJenisPlak(effectiveOrder, g.jenisPlak) === viewInvoiceId);
  }, [effectiveOrder, isFiltered, viewInvoiceId]);

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

  // Print Order — the same full printout Teacher / Sales get (OrderPrintout):
  // every category's details at once, cut down to the invoice being viewed
  // (a partly-split Jenis Plak's block shows on both, as on OrderDetails).
  // Stamped with when Production printed it, without overwriting the
  // Teacher/Sales "Order Printed" time (recordPrint).
  const printCatBlockGroups = useMemo(() => {
    if (!effectiveOrder) return [];
    const sliceItems = isFiltered ? getInvoiceItems(effectiveOrder, viewInvoiceId) : effectiveOrder.items;
    const { anugerah, selempang } = splitOrderCategories(effectiveOrder);
    return [...anugerah, ...selempang]
      .filter((cat) => sliceItems.some((it) => it.categoryKey === cat.key))
      .map((cat) => ({
        cat,
        blocks: reconstructBlocksForCategory(effectiveOrder, cat.key, state.plakCatalog).blocks
          .filter((blk) => !isFiltered || !blk.jenisPlak || sliceItems.some((it) => it.jenisPlak === blk.jenisPlak)),
      }));
  }, [effectiveOrder, isFiltered, viewInvoiceId, state.plakCatalog]);
  const [printedAt, setPrintedAt] = useState(null);
  // Deferred a tick so the new printedAt is in the print-only DOM first.
  const handlePrint = () => { setPrintedAt(new Date().toISOString()); setTimeout(() => window.print(), 0); };

  if (!order) return null;

  const reviewing = order.status === 'Reviewing Order';

  const stamp = getOrderChangeStamp(order);
  // Only this invoice's items when filtered — feeds the "Jenis Plak / QTY /
  // Harga" overview table at the top of Order Details and its two totals.
  // getInvoiceItems cuts a partly-split Jenis Plak down to this invoice's QTY.
  const visibleItems = isFiltered ? getInvoiceItems(effectiveOrder, viewInvoiceId) : effectiveOrder.items;
  const partialSplitNotes = isFiltered ? getPartialSplitNotes(effectiveOrder, viewInvoiceId) : [];
  const totalQty = visibleItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const effectiveTotalAmount = visibleItems.reduce((sum, it) => sum + it.harga, 0);

  // Both export paths refuse a selection that failed validateExport, even
  // if called programmatically — the disabled button is the first line, this
  // is the backstop.
  const handleExportGroup = (group, csvData, check) => {
    if (!check.ok || csvData.rows.length === 0) return;
    const csv = rowsToCsv(csvData.rows);
    const label = [group.blk.qtyLabel, group.batch !== 0 ? group.label : null, group.jenisPlak]
      .filter(Boolean).join(' - ');
    // A combined sheet's group can list several Jenis Plak — its first one
    // picks the invoice number for the filename.
    const filename = buildCategoryCsvFilename(order, label, group.items[0].jenisPlak);
    downloadTextFile(filename, csv);
    setExportNote(`Exported ${csvData.rows.length} row(s) to ${filename}.`);
    clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = setTimeout(() => setExportNote(''), 4000);
  };

  const handleExportJenisPlak = (group, csvData, check) => {
    if (!check.ok || csvData.rows.length === 0) return;
    const csv = rowsToCsv(csvData.rows);
    const filename = buildCategoryCsvFilename(order, `${group.categoryLabel} - ${group.jenisPlak}`, group.jenisPlak);
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

  // Runs on THIS computer only: first asks its AI File helper whether it can
  // reach the NAS AI FILE folder, and stops with an alert if there's no
  // helper or no folder — instead of queuing a job nobody will pick up.
  const aiFileBusy = aiFileChecking || !!activeAiFileJobId;
  const handleGenerateAiFile = async () => {
    if (!combinedOk || aiFileBusy) return;
    setAiFileErr('');
    setAiFileChecking(true);
    try {
      const status = await getAiFileHelperStatus();
      if (!status) {
        window.alert('This computer is not set up to generate AI files (the AI File helper is not running).\n\n这台电脑没有安装或没有开启 AI File helper，不能生成 AI file。');
        return;
      }
      if (!status.nasOk) {
        window.alert(`This computer can't find the AI FILE folder:\n${status.aiFileDir}\n\n这台电脑找不到这个 file path，不能生成 AI file。`);
        return;
      }
      const id = await startAiFileHelperJob(buildCombinedCsvFilename(order), rowsToCsv(combinedRows));
      setAiFileJob({ id, status: 'queued', message: '', files: [] });
    } catch (err) {
      setAiFileErr(err.message || 'Could not start the AI file run. Please try again.');
    } finally {
      setAiFileChecking(false);
    }
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
            {stamp && <span className="order-stamp-inline no-print">{stamp}</span>}
            {/* Corrected Excel present — every export below already reads
                from it (see effectiveOrder), this just makes that visible
                at a glance without opening the order. */}
            {order.correctedImportFilePath && (
              <span className="status-pill no-print" style={{ background: '#fff4ce', color: '#8a6d00' }}>Excel Updated</span>
            )}
            <span className="status-pill" style={statusPillStyle(sliceStatus)}>{sliceLabel}</span>
            {reviewing && isReviewed(order) && <span className="status-pill no-print" style={{ background: '#dcefe3', color: '#2f6b4f' }}>✓ Review Done</span>}
          </div>
        </div>

        <div className="screen-only">
        {/* Production review (supabase/migrations/0077): check the order, fix
            it in the editor if needed, then Done Review so Sales can approve. */}
        {reviewing && (
          <div className="confirm-panel" style={{ marginBottom: 'var(--space-4)' }}>
            <p className="hint-text" style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
              {isReviewed(order)
                ? 'Review done — waiting for the salesman to approve. You can still edit the order until then. 已 review，等 Salesman approve。'
                : 'Check this order — wording, line order, quantities, Jenis Plak. Fix anything with Edit Order, then click Done Review so Sales can approve it. 检查好了按 Done Review，Salesman 才可以 approve。'}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/production/orders/${order.id}/edit`)}>Edit Order</button>
              {!isReviewed(order) && (
                <ConfirmButton label="Done Review" question="确定 review 好了吗？Salesman can approve it after this." onConfirm={() => markReviewDone(order.id)} />
              )}
            </div>
          </div>
        )}
        {isFiltered && (
          <p className="hint-text" style={{ marginBottom: 'var(--space-3)' }}>
            Showing only the <strong>{viewInvoiceId}</strong> invoice for this order — the Jenis Plak table, category tabs, and exports below all cover just that slice.{' '}
            <button type="button" onClick={() => navigate(`/production/orders/${order.id}`)} className="text-label-bold font-semibold text-primary hover:underline">
              View full order
            </button>
          </p>
        )}

        {page === 'summary' ? (
          <>
            <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
              {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
              {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
              {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
              {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
              {order.shipmentDate && <div><div className="dim">Shipment Date</div><div>{formatDate(toMalaysiaDay(order.shipmentDate))}</div></div>}
              {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(toMalaysiaDay(order.functionDate))}</div></div>}
              <div><div className="dim">Date Placed</div><div>{order.datePlaced}</div></div>
              <div><div className="dim">Total Amount</div><div>RM {(isFiltered ? effectiveTotalAmount : order.totalAmount).toFixed(2)}</div></div>
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

            {!reviewing && <CorrectedExcelControl
              order={order}
              onUploaded={(items, warnings) => { setCorrectedItems(items); setCorrectedWarnings(warnings || []); setCorrectedError(''); }}
            />}
            {correctedLoading && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>Re-reading the corrected file…</p>}
            {correctedError && <p className="hint-text" style={{ color: '#b0392e', fontWeight: 600, marginTop: 'var(--space-2)' }}>⚠ {correctedError} — export is showing the original data instead.</p>}
            {correctedWarnings.length > 0 && correctedWarnings.map((w) => (
              <p key={w} className="hint-text" style={{ color: '#b45309', marginTop: 'var(--space-2)' }}>⚠ {w}</p>
            ))}

            {/* SELEMPANG's rows (ACARA / WARNA / QTY) also show right here on the
                Summary — the only category that does (Sean); every category's full
                details stay on the Order Details tab. */}
            {selempangBlocks.map((blk) => (
              <div key={`sum-sel-${blk.idx}`} style={{ marginTop: 'var(--space-6)' }}>
                <OrderCategoryBlock blk={blk} editable={READONLY} />
              </div>
            ))}
            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Invoice</div>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div className="dim">Invoice Number</div>
              <div>{(isFiltered ? viewInvoiceId : order.invoiceId) || 'Not assigned yet — Store Admin handles this.'}</div>
            </div>
            {state.productionToast && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>{state.productionToast}</p>}

            <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
              <button type="button" className="btn btn-secondary" onClick={handlePrint}>Print Order</button>
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
              rows={visibleItems} editable={false} priceDrafts={{}} setPrice={() => {}}
              plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={effectiveTotalAmount} priceAdjusted={false}
              hideCategory combineJenisPlak
            />
            {partialSplitNotes.map((note) => (
              <p key={note} className="hint-text" style={{ color: '#b45309', marginTop: 'var(--space-2)' }}>{note}</p>
            ))}

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
                    <button
                      type="button" className="btn" style={{ marginTop: 8 }}
                      disabled={!combinedOk || aiFileBusy} onClick={handleGenerateAiFile}
                    >
                      {aiFileChecking ? 'Checking this computer…' : activeAiFileJobId ? '⏳ Generating…' : '🖨 Generate AI File'}
                    </button>
                    <p className="hint-text" style={{ marginTop: 4 }}>
                      Runs this same combined CSV in Illustrator on this computer — it needs the AI File helper installed and the NAS AI FILE folder reachable here. Type your name when Illustrator asks.
                    </p>
                    {aiFileJob && (
                      <p className="hint-text" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                        {aiFileJob.status === 'queued' && 'Waiting for Illustrator on this computer…'}
                        {aiFileJob.status === 'running' && 'Running in Illustrator now…'}
                        {aiFileJob.status === 'error' && `Failed: ${aiFileJob.message || 'unknown error'}`}
                        {aiFileJob.status === 'done' && `Done — ${aiFileJob.files.length} file(s) saved to ${aiFileJob.outputFolder} (opened on this computer).`}
                      </p>
                    )}
                    {aiFileErr && <div className="login-error" style={{ marginTop: 4 }}>{aiFileErr}</div>}
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
                {canReorder && (
                  <p className="hint-text">
                    Drag a Reference Sample row number to change the line order on the plaque (allowed until the Shipment Date). 拖 Reference Sample 的号码可以换上下顺序（到 Shipment Date 当天为止）。
                  </p>
                )}
                {refOrderNote && <p className="hint-text" style={{ fontWeight: 600 }}>{refOrderNote}</p>}
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
                          <OrderCategoryBlock blk={group.blk} editable={canReorder ? REORDER_ONLY : READONLY} />

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

        {/* Print-only — see "Print Order" on the Summary page. */}
        <OrderPrintout
          order={order} invoiceId={isFiltered ? viewInvoiceId : order.invoiceId} printedAt={printedAt}
          urgent={order.urgent} stamp={stamp} showSales showRemark
          priceTable={{
            rows: visibleItems, plakCatalog: state.plakCatalog, totalQty, totalHarga: effectiveTotalAmount,
            priceAdjusted: false, hideCategory: true, combineJenisPlak: true,
          }}
          catBlockGroups={printCatBlockGroups}
        />
      </div>
    </div>
  );
}
