import OrderCategoryBlock from './OrderCategoryBlock';
import PriceTable from './PriceTable';
import { formatDate, formatDateTime, toMalaysiaDay } from '../data/catalog';
import { groupItemsByBatch } from '../utils/orderBatches';
import { splitOrderCategories } from '../utils/exportCsv';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

// The printed order ("Print Order"): order info, remark and price table in
// bigger type, then every category's full details — one category per page —
// regardless of which tab is open on screen. Hidden on screen (.print-only).
// Shared by the Teacher (OrderDetails), Sales (SalesOrderSummary) and
// Production (ProductionOrderDetail) pages; each says which extras it shows.
//
// Once an add-on was approved (items with a `batch`), the print is split
// (Sean, 2026-10-09): the original order's price table + details first,
// then a TAMBAHAN divider and each add-on's own price table + details — all
// flowing on the same page(s), no forced page breaks (Sean, 2026-10-09).
export default function OrderPrintout({
  order, invoiceId, printedAt, urgent = false, stamp = null, showSales = false, showRemark = false,
  priceTable, catBlockGroups,
}) {
  const batches = groupItemsByBatch(priceTable.rows);
  const split = batches.length > 1;
  const batchTable = (items) => ({
    ...priceTable,
    rows: items,
    totalQty: items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0),
    totalHarga: items.reduce((sum, it) => sum + (Number(it.harga) || 0), 0),
  });
  const batchBlockGroups = (items) => {
    const batchOrder = { ...order, items };
    const { anugerah, selempang } = splitOrderCategories(batchOrder);
    return [...anugerah, ...selempang]
      .filter((cat) => items.some((it) => it.categoryKey === cat.key))
      .map((cat) => ({ cat, blocks: reconstructBlocksForCategory(batchOrder, cat.key, priceTable.plakCatalog).blocks }));
  };
  const [first, ...addOns] = batches;

  return (
    <div className="print-only">
      {/* Bigger, easier-to-read type just for the Summary half — the Order
          Details half below (every category's full block, PBD's Nama Kelas
          breakdown especially) keeps the smaller compact print sizing (see
          .print-only's own font-size) since that sizing is load-bearing for
          fitting a large category on one printed page. */}
      <div className="print-summary-section">
        {(urgent || stamp || order.salesmanDelivery || split) && (
          <div className="order-stamp-corner">
            {split && <div className="order-stamp order-stamp-urgent">TAMBAHAN</div>}
            {urgent && <div className="order-stamp order-stamp-urgent">URGENT</div>}
            {/* The salesman delivers it himself (0079) — Store Admin doesn't
                arrange delivery. */}
            {order.salesmanDelivery && <div className="order-stamp">SALESMAN DELIVER</div>}
            {stamp && <div className="order-stamp">{stamp}</div>}
          </div>
        )}
        <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
          <div><div className="dim">Order ID</div><div>{order.id}</div></div>
          {printedAt && <div><div className="dim">Order Printed</div><div>{formatDateTime(printedAt)}</div></div>}
          {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
          {showSales && order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
          {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
          {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
          {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
          {/* Invoice Number, Shipment Date and Function Date stacked in one
              cell, not spread across the two-column grid. */}
          <div>
            <div className="dim">Invoice Number</div><div>{invoiceId || '-'}</div>
            {(order.shipmentDate || order.functionDate) && (
              <div style={{ marginTop: 'var(--space-2)' }}>
              {order.shipmentDate && <><div className="dim">Shipment Date</div><div>{formatDate(toMalaysiaDay(order.shipmentDate))}</div></>}
              {order.functionDate && <><div className="dim" style={order.shipmentDate ? { marginTop: 'var(--space-2)' } : undefined}>Function Date</div><div>{formatDate(toMalaysiaDay(order.functionDate))}</div></>}
            </div>
          )}
          </div>
          {order.salesmanDelivery && (
            <div><div className="dim">Delivery</div><div><strong>This order: salesman delivers himself (Salesman hantar sendiri)</strong></div></div>
          )}
        </div>
        {/* A KIV/pending note (AppState.jsx's importFormAnugerahExcel) needs to
            physically travel with the printed order, not just live in the app. */}
        {showRemark && order.remark && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div className="dim">Remark</div>
            <div>{order.remark}</div>
          </div>
        )}

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>
          {split ? `${first.label} — ` : ''}Jenis Plak / Price per Unit / QTY / Harga
        </div>
        <PriceTable editable={false} priceDrafts={{}} setPrice={() => {}} {...(split ? batchTable(first.items) : priceTable)} />
      </div>

      <PrintDetails groups={split ? batchBlockGroups(first.items) : catBlockGroups} title={split ? `Order Details — ${first.label}` : 'Order Details'} flow={split} />

      {split && addOns.map((batch) => (
        <div key={batch.batch}>
          <div className="print-tambahan-banner">{batch.label.toUpperCase()}</div>
          <div className="print-summary-section">
            <div className="card-kicker" style={{ marginTop: 'var(--space-3)' }}>{batch.label} — Jenis Plak / Price per Unit / QTY / Harga</div>
            <PriceTable editable={false} priceDrafts={{}} setPrice={() => {}} {...batchTable(batch.items)} />
          </div>
          <PrintDetails groups={batchBlockGroups(batch.items)} title={`Order Details — ${batch.label}`} flow />
        </div>
      ))}
      {split && (
        <p style={{ marginTop: 'var(--space-6)', fontSize: 14 }}>
          <strong>GRAND TOTAL (Original Order + Tambahan): RM {(Number(priceTable.totalHarga) || 0).toFixed(2)}</strong>
        </p>
      )}
    </div>
  );
}

// `flow`: no page breaks (the split print keeps everything together).
function PrintDetails({ groups, title, flow = false }) {
  if (groups.length === 0) return null;
  return (
    <div className={flow ? undefined : 'print-details-section'}>
      <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>{title}</div>
      {groups.map(({ cat, blocks }, catIdx) => (
        <div key={cat.key} className={`print-category-page${catIdx > 0 && !flow ? ' print-category-break' : ''}`}>
          {blocks.map((blk, i) => (
            <OrderCategoryBlock key={i} blk={blk} editable={READONLY} hideEmptyRows />
          ))}
        </div>
      ))}
    </div>
  );
}
