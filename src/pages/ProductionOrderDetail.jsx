import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav';
import ConfirmButton from '../components/ConfirmButton';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import CorrectedExcelControl from '../components/CorrectedExcelControl';
import PriceTable from '../components/PriceTable';
import CrystalPreview from '../components/CrystalPreview';
import OrderPrintout from '../components/OrderPrintout';
import AddOnTag from '../components/AddOnTag';
import { duplicateReasons } from '../utils/duplicateOrders';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, MANUAL_MAX_QTY, shipmentDatePassed, toMalaysiaDay, malaysiaToday, isReviewed, isAddonInFlight, invoiceLabel, invoiceSetByNote, invoiceSource, resolveCategory } from '../data/catalog';
import { redLinesProblem, RED_LINES_SUFFIX } from '../utils/redLines';
import { reconstructOrderDetailGroups, reconstructBlocksForCategory, noopUpdaters } from '../utils/computeBlocks';
import { getExportableCategories, splitOrderCategories, getOrderJenisPlakGroups, getPlakProductionMode, summarizeRowsForManual, buildCsvRows, rowsToCsv, buildCategoryCsvFilename, combineCsvRows, addInvoiceGaps, buildCombinedCsvFilename, validateExport, getInvoiceIdForJenisPlak, getPartialSplitNotes, needsKiv, kivInProduction, kivParts, isCrystalCode, firstKivCategory, crystalWithPlak, lateNamesOrder, hasLateNames } from '../utils/exportCsv';
import { downloadTextFile } from '../utils/downloadBlob';
import { getInvoiceItems } from '../utils/orderBatches';
import ImportFileButtons from '../components/ImportFileButtons';
import ProductionChecks from '../components/ProductionChecks';
import ShipmentUrgencyEditor from '../components/ShipmentUrgencyEditor';
import ProductionPriceEditor from '../components/ProductionPriceEditor';
import ProductionInvoiceEntry from '../components/ProductionInvoiceEntry';
import ReservedNamesForm from '../components/ReservedNamesForm';
import { getAiFileHelperStatus, startAiFileHelperJob, getAiFileHelperJob } from '../lib/aiFileHelper';
import { schoolFolderFor } from '../data/schoolFolders';
import { getOrderChangeStamp } from '../utils/orderStamp';

// 3 flashes × 0.5s (index.css .kiv-row-flash), then the rows go back to normal
const KIV_FLASH_MS = 1700;
const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };
// Production may still drag the Reference Sample rows into a new order — nothing else.
const REORDER_ONLY = { ...READONLY, lineOrder: true };
const CRYSTAL_SEND_WAIT_MS = 3 * 60 * 1000; // Generate AI File: how long the plaques wait for the crystals to be sent

export default function ProductionOrderDetail() {
  const { state, ensureOrderLoaded, loadCorrectedExcelPreview, updateReferenceOrder, markReviewDone, markAddOnReviewed, fillReservedNames } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const order = state.orders.find((o) => o.id === id);
  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);
  // a Tambahan's own order prints with its original order's price table (0091)
  const parentId = order?.parentOrderId || null;
  useEffect(() => { if (parentId) ensureOrderLoaded(parentId); }, [parentId, ensureOrderLoaded]);
  const originalOrder = parentId ? state.orders.find((o) => o.id === parentId) || null : null;

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
  // Production's own Reference Sample row order and MERAH ticks
  // (updateReferenceOrder) are saved on the order's items, so they're carried
  // over onto the re-read file.
  // Opened from a KIV card in Typing (?part=kiv, Sean 2026-10-17): only what that card makes —
  // its crystals and the plaques whose Reserved names came after typing (lateNamesOrder).
  const kivCardView = searchParams.get('part') === 'kiv' && !!order;
  // Opened from an Add-On Review card (?addon=1, Sean 2026-10-17): the Tambahan alone.
  const addonView = searchParams.get('addon') === '1' && !!order && isAddonInFlight(order);
  const effectiveOrder = useMemo(() => {
    if (addonView) return { ...order, items: order.pendingAddonItems || [] };
    if (kivCardView) {
      const crystals = kivParts(order).includes('CRYSTAL') ? (order.items || []).filter((it) => isCrystalCode(it.jenisPlak)) : [];
      return { ...order, items: [...crystals, ...(lateNamesOrder(order)?.items || [])] };
    }
    if (!correctedItems) return order;
    const saved = Object.fromEntries((order.items || []).flatMap((it) => (
      Object.entries(it.detail?.lines || {}).filter(([k]) => k.endsWith('::refOrder') || k.endsWith('::redLines'))
    )));
    // Prices adjusted by hand on the order (Adjust Prices) carry over too, by Jenis Plak (ORD-0058, Sean 2026-10-21).
    const ownPrice = order.priceAdjusted ? new Map((order.items || []).map((it) => [it.jenisPlak, Number(it.unitPrice)])) : new Map();
    const withOwnPrice = (it) => {
      const price = ownPrice.get(it.jenisPlak);
      if (!(price >= 0) || price === Number(it.unitPrice)) return it;
      const rows = Array.isArray(it.detail?.rows)
        ? it.detail.rows.map((r) => (r.jenisPlak === it.jenisPlak || (!r.jenisPlak && r.unitPrice != null) ? { ...r, unitPrice: price } : r))
        : it.detail?.rows;
      return { ...it, unitPrice: price, harga: (Number(it.qty) || 0) * price, ...(it.detail ? { detail: { ...it.detail, rows } } : {}) };
    };
    const items = correctedItems.map((it) => {
      const prefix = `${it.categoryKey}::${it.blockIdx ?? 0}::`;
      const own = Object.fromEntries(Object.entries(saved).filter(([k]) => k === `${prefix}refOrder` || k === `${prefix}redLines`));
      return withOwnPrice(it.detail && Object.keys(own).length
        ? { ...it, detail: { ...it.detail, lines: { ...(it.detail.lines || {}), ...own } } }
        : it);
    });
    return { ...order, items };
  }, [order, correctedItems, kivCardView, addonView]);

  // The row order stays changeable from submit until the Shipment Date
  // itself — a teacher may phone in a change after submitting. Saved on
  // every drop.
  const canReorder = !!order && order.status !== 'Cancelled'
    && !shipmentDatePassed(order.shipmentDate, malaysiaToday());
  // MERAH beside each Reference Sample row: only while reviewing (Sean, 2026-10-15)
  const canPickRed = canReorder && order.status === 'Reviewing Order';
  const [refOrderNote, setRefOrderNote] = useState('');
  const reorderUpdaters = useMemo(() => (canReorder ? {
    ...noopUpdaters,
    onLine: async (key, value) => {
      const isRed = key.endsWith(`::${RED_LINES_SUFFIX}`);
      if (isRed) {
        // more black rows than the plaque has lines for: not saved
        const item = (order.items || []).find((it) => key.startsWith(`${it.categoryKey}::${it.blockIdx ?? 0}::`));
        const problem = item && redLinesProblem({ ...item.detail?.lines, [key]: value }, key.slice(0, -RED_LINES_SUFFIX.length), resolveCategory(item.categoryKey));
        if (problem) { setRefOrderNote(problem); return; }
      }
      const ok = await updateReferenceOrder(order.id, key, value);
      setRefOrderNote(ok
        ? `${isRed ? 'MERAH' : 'New row order'} saved — export the CSV / Generate AI File again to use it.`
        : `Could not save the ${isRed ? 'MERAH ticks' : 'new row order'}. Please try again.`);
    },
  } : noopUpdaters), [canReorder, order, updateReferenceOrder]);

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
  const [pickedCrystal, setPickedCrystal] = useState(null); // a crystal row clicked in the price table
  const [crystalMakeAi, setCrystalMakeAi] = useState(0); // bumped: the Crystal Preview opens the crystals in Illustrator
  const crystalSent = useRef(null); // resolves when the preview has handed the crystals to the helper
  const [crystalPrep, setCrystalPrep] = useState(false);
  // Which price table is open for adjusting: 'order' or 'addon'.
  const [priceEditor, setPriceEditor] = useState(null);
  const togglePrices = (which) => setPriceEditor((open) => (open === which ? null : which));
  // Deferred a tick so the new printedAt is in the print-only DOM first.
  const handlePrint = () => { setPrintedAt(new Date().toISOString()); setTimeout(() => window.print(), 0); };

  // Opened from KIV & ARTWORK's View Order (?kiv=1, Sean 2026-10-14): straight to Order Details,
  // the first category (tab order) with a RESERVE / RESERVED / KIV row, every such row flashing
  // three times. Once per order — a re-render doesn't flash again; another order starts afresh.
  const fromKiv = searchParams.get('kiv') === '1';
  const [kivFlash, setKivFlash] = useState(false);
  const kivHandledFor = useRef(null);
  useEffect(() => {
    if (!fromKiv || !effectiveOrder || kivHandledFor.current === effectiveOrder.id) return;
    kivHandledFor.current = effectiveOrder.id;
    const key = firstKivCategory(effectiveOrder, categories.map((c) => c.key));
    if (!key) return;
    setPage('details');
    setActiveCat(key);
    setKivFlash(true);
  }, [fromKiv, effectiveOrder, categories]);
  useEffect(() => {
    if (!kivFlash) return undefined;
    document.querySelector('.kiv-row-flash')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setKivFlash(false), KIV_FLASH_MS);
    return () => clearTimeout(t);
  }, [kivFlash]);

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
  // data leave the app" rule as the per-group export. A group whose every
  // plaque is still "Reserved" (no names yet) is skipped instead of
  // blocking the rest (Sean, 2026-10-13) — it's generated later, once the
  // names are in.
  const isAllReserved = (g) => g.csvData.rows.length === 0 && g.csvData.reservedCount > 0;
  // Crystals never go in the CSV: the Crystal Preview makes their .ai. Once their
  // artwork is confirmed they're typed with the plaques — Generate AI File runs
  // both (Sean, 2026-10-15); otherwise they're made from their own card.
  const crystalGroups = jenisPlakExport.filter((g) => isCrystalCode(g.jenisPlak));
  const crystalsHere = crystalGroups.length > 0 && (kivCardView ? !!order.artworkConfirmedAt : crystalWithPlak(order));
  const plakGroups = jenisPlakExport.filter((g) => !isCrystalCode(g.jenisPlak));
  const reservedGroups = plakGroups.filter((g) => g.csvData.reservedCount > 0);
  const combinedRows = addInvoiceGaps(order, combineCsvRows(plakGroups));
  const combinedOk = plakGroups.length > 0 && plakGroups.every((g) => g.check.ok || isAllReserved(g)) && combinedRows.length > 0;
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
  const generateOk = crystalsHere ? (plakGroups.length === 0 || combinedOk) : combinedOk;
  const handleGenerateAiFile = async () => {
    if (!generateOk || aiFileBusy) return;
    setAiFileErr('');
    setAiFileChecking(true);
    try {
      const status = await getAiFileHelperStatus();
      if (!status) {
        window.alert('This computer is not set up to generate AI files (the AI File helper is not running).');
        return;
      }
      if (!status.nasOk) {
        window.alert(`This computer can't find the AI FILE folder:\n${status.aiFileDir}`);
        return;
      }
      // Crystals first, while this page is still on screen: the plaques bring Illustrator to the
      // front, and in a background tab the browser all but stops the preview drawing them
      // (ORD-9016, Sean 2026-10-15). Plaques go once the crystals are handed over (or after 3 min).
      if (crystalsHere) {
        setCrystalPrep(true);
        await new Promise((resolve) => {
          const t = setTimeout(resolve, CRYSTAL_SEND_WAIT_MS);
          crystalSent.current = () => { clearTimeout(t); crystalSent.current = null; resolve(); };
          setCrystalMakeAi((n) => n + 1);
        });
        setCrystalPrep(false);
      }
      if (!combinedOk) return;
      const id = await startAiFileHelperJob(buildCombinedCsvFilename(order), rowsToCsv(combinedRows), schoolFolderFor(order.sekolah));
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
            <AddOnTag order={order} />
            {order.duplicateCheck && (
              <div className="hint-text no-print" style={{ margin: '4px 0 0', fontWeight: 600, color: '#b45309' }}>
                ⚠ Possible duplicate of{' '}
                {(order.duplicateCheck.matches || []).map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && '; '}
                    <a href={`#/production/orders/${m.id}`}>{m.id}</a> ({duplicateReasons(m.reasons)})
                  </span>
                ))}
                {' '}— submitted anyway by {order.duplicateCheck.confirmedBy || '—'}. Check before Done Review.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {stamp && <span className="order-stamp-inline no-print">{stamp}</span>}
            {(needsKiv(order) || kivInProduction(order)) && kivParts(order).map((part) => (
              <span key={part} className="order-stamp-inline no-print">{part}</span>
            ))}
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
                ? 'Review done — waiting for the salesman to approve. You can still edit the order until then.'
                : 'Check this order — wording, line order, quantities, Jenis Plak. Fix anything with Edit Order, then click Done Review so Sales can approve it.'}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/production/orders/${order.id}/edit`)}>Edit Order</button>
              <button type="button" className="btn btn-secondary" onClick={() => togglePrices('order')}>{priceEditor === 'order' ? 'Close Prices' : 'Adjust Prices'}</button>
              {!isReviewed(order) && (
                <ConfirmButton label="Done Review" question="Finished reviewing? The salesman can approve it after this." onConfirm={() => markReviewDone(order.id)} />
              )}
            </div>
            {priceEditor === 'order' && <ProductionPriceEditor order={order} />}
          </div>
        )}
        {/* A submitted add-on (Tambahan) — reviewed like the order itself:
            Edit Order (download / upload its Excel there), then Done Review. */}
        {isAddonInFlight(order) && (
          <div className="confirm-panel" style={{ marginBottom: 'var(--space-4)' }}>
            {order.pendingAddonShipmentDate && (
              <p className="hint-text" style={{ margin: '0 0 var(--space-2)', fontWeight: 600, color: '#8a6d00' }}>
                Tambahan Shipment Date: {formatDate(toMalaysiaDay(order.pendingAddonShipmentDate))}
              </p>
            )}
            <p className="hint-text" style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
              {order.pendingAddonStatus === 'reviewed'
                ? 'Tambahan (add-on) review done — waiting for the salesman to approve. You can still edit it until then.'
                : 'Check this Tambahan (add-on) — wording, line order, quantities, Jenis Plak. Fix anything with Edit Order, then click Done Review so Sales can approve it.'}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(`/production/orders/${order.id}/edit?addon=1`)}>Edit Order</button>
              <button type="button" className="btn btn-secondary" onClick={() => togglePrices('addon')}>{priceEditor === 'addon' ? 'Close Prices' : 'Adjust Prices'}</button>
              {order.pendingAddonStatus === 'pending' && (
                <ConfirmButton label="Done Review" question="Finished reviewing this Tambahan? The salesman can approve it after this." onConfirm={() => markAddOnReviewed(order.id)} />
              )}
            </div>
            {priceEditor === 'addon' && <ProductionPriceEditor order={order} addOn />}
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

        {addonView && (
          <p className="hint-text" style={{ marginBottom: 'var(--space-3)', color: '#8a6d00', fontWeight: 600 }}>
            TAMBAHAN — showing only this add-on{order.pendingAddonShipmentDate ? ` (Shipment Date ${formatDate(toMalaysiaDay(order.pendingAddonShipmentDate))})` : ''}.{' '}
            <button type="button" onClick={() => navigate(`/production/orders/${order.id}`)} className="btn-link">View full order</button>
          </p>
        )}
        {kivCardView && (
          <p className="hint-text" style={{ marginBottom: 'var(--space-3)', color: '#8a6d00', fontWeight: 600 }}>
            KIV card — showing only what this card makes: {[kivParts(order).includes('CRYSTAL') && 'the crystals', hasLateNames(order) && 'the plaques named after typing'].filter(Boolean).join(' and ') || 'nothing yet'}.{' '}
            <button type="button" onClick={() => navigate(`/production/orders/${order.id}`)} className="btn-link">View full order</button>
          </p>
        )}
        <ReservedNamesForm order={order} onSave={(names) => fillReservedNames(order.id, names)} />

        {page === 'summary' ? (
          <>
            <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
              {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
              {order.createdBySalesman && <div><div className="dim">Placed by</div><div>Salesman {order.snapshot?.placedBy || ''}</div></div>}
              {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
              {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
              {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
              {order.shipmentDate && <div><div className="dim">Shipment Date</div><div>{formatDate(toMalaysiaDay(order.shipmentDate))}</div></div>}
              {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(toMalaysiaDay(order.functionDate))}</div></div>}
              <div><div className="dim">Date Placed</div><div>{order.datePlaced}</div></div>
              <div><div className="dim">Total Amount</div><div>RM {(isFiltered || addonView ? effectiveTotalAmount : order.totalAmount).toFixed(2)}</div></div>
            </div>
            <ShipmentUrgencyEditor order={order} />
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

            <div style={{ marginTop: 'var(--space-4)' }}>
              <div className="dim">{order.importFilePath ? 'Teacher’s file (Excel / Word / PDF) + the website’s Excel' : 'The website’s Excel'}</div>
              <ImportFileButtons order={order} buttonClassName="btn btn-primary" errorClassName="login-error" websiteExcel />
            </div>

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
              <div>{(isFiltered ? invoiceLabel(order, viewInvoiceId) : invoiceLabel(invoiceSource(order, state.orders))) || 'Not assigned yet — Store Admin handles this.'}</div>
              {order.invoiceId && invoiceSetByNote(order) && <div className="dim">{invoiceSetByNote(order)}</div>}
              <ProductionInvoiceEntry order={order} />
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
              canPick={isCrystalCode} onPick={setPickedCrystal} picked={pickedCrystal}
            />
            {partialSplitNotes.map((note) => (
              <p key={note} className="hint-text" style={{ color: '#b45309', marginTop: 'var(--space-2)' }}>{note}</p>
            ))}
            {/* Reviewing a Tambahan: only its own crystals, nothing to confirm or make yet (as SalesOrderSummary). */}
            {addonView
              ? <CrystalPreview order={effectiveOrder} role="production" selected={pickedCrystal} showArtwork={false} canMake={false} />
              : <CrystalPreview order={order} role="production" selected={pickedCrystal} canMake={kivCardView || !kivParts(order).includes('CRYSTAL')} makeAi={crystalMakeAi} makeAiFolder={buildCombinedCsvFilename(order).replace(/\.csv$/i, '')} makeAiSchool={schoolFolderFor(order.sekolah)} onMakeAiSent={() => crystalSent.current?.()} />}

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
                    {crystalGroups.length > 0 && (
                      <p className="hint-text" style={{ marginTop: 4, color: '#8a6d00', fontWeight: 600 }}>
                        {crystalsHere
                          ? 'CRYSTAL is not in the CSV — Generate AI File also opens the crystals in Illustrator (from the Crystal Preview above): '
                          : 'CRYSTAL is made from its own card (KIV & ARTWORK, then Typing once the artwork is confirmed) — left out of this CSV / AI file: '}
                        {crystalGroups.map((g) => `${g.categoryLabel} – ${g.jenisPlak} (${g.totalQty})`).join(', ')}.
                      </p>
                    )}
                    {reservedGroups.length > 0 && (
                      <p className="hint-text" style={{ marginTop: 4, color: '#8a6d00', fontWeight: 600 }}>
                        Still RESERVED (no name yet) — left out of the CSV / AI file this time:{' '}
                        {reservedGroups.map((g) => `${g.categoryLabel} – ${g.jenisPlak} (${g.csvData.reservedCount})`).join(', ')}.
                      </p>
                    )}
                    <ProductionChecks order={effectiveOrder} groups={jenisPlakExport} />
                    <button
                      type="button" className="btn" style={{ marginTop: 8 }}
                      disabled={!generateOk || aiFileBusy} onClick={handleGenerateAiFile}
                    >
                      {crystalPrep ? '⏳ Preparing the crystals — keep this page in front…' : aiFileChecking ? 'Checking this computer…' : activeAiFileJobId ? '⏳ Generating…' : '🖨 Generate AI File'}
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
                        {aiFileJob.status === 'done' && aiFileJob.schoolCopy && `\n${aiFileJob.schoolCopy}`}
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
                                : check.ok ? csvData.rows.length
                                  : isAllReserved(group) ? <span style={{ color: '#8a6d00', fontWeight: 700 }}>reserved</span>
                                    : <span style={{ color: '#b0392e', fontWeight: 700 }}>blocked</span>}
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
                    Drag a Reference Sample row number to change the line order on the plaque (allowed until the Shipment Date).
                    {canPickRed && ' While reviewing, tick MERAH on the rows that print red — two ticked rows join into one red line (the first, then the second under it); unticked rows print black (two at most).'}
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
                          <OrderCategoryBlock blk={group.blk} editable={canReorder ? { ...REORDER_ONLY, redLines: canPickRed } : READONLY} flashKivRows={kivFlash} />

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
          original={originalOrder}
          order={order} invoiceId={isFiltered ? viewInvoiceId : invoiceSource(order, state.orders).invoiceId} printedAt={printedAt}
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
