import OrderCategoryBlock from './OrderCategoryBlock';
import PriceTable from './PriceTable';
import { formatDate, formatDateTime, toMalaysiaDay } from '../data/catalog';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

// The printed order ("Print Order"): order info, remark and price table in
// bigger type, then every category's full details — one category per page —
// regardless of which tab is open on screen. Hidden on screen (.print-only).
// Shared by the Teacher (OrderDetails), Sales (SalesOrderSummary) and
// Production (ProductionOrderDetail) pages; each says which extras it shows.
export default function OrderPrintout({
  order, invoiceId, printedAt, urgent = false, stamp = null, showSales = false, showRemark = false,
  priceTable, catBlockGroups,
}) {
  return (
    <div className="print-only">
      {/* Bigger, easier-to-read type just for the Summary half — the Order
          Details half below (every category's full block, PBD's Nama Kelas
          breakdown especially) keeps the smaller compact print sizing (see
          .print-only's own font-size) since that sizing is load-bearing for
          fitting a large category on one printed page. */}
      <div className="print-summary-section">
        {(urgent || stamp || order.salesmanDelivery) && (
          <div className="order-stamp-corner">
            {urgent && <div className="order-stamp order-stamp-urgent">URGENT</div>}
            {/* The salesman delivers it himself (0079) — Store Admin doesn't
                arrange delivery. */}
            {order.salesmanDelivery && <div className="order-stamp">SALESMAN DELIVER</div>}
            {stamp && <div className="order-stamp">{stamp}</div>}
          </div>
        )}
        <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
          <div><div className="dim">Order ID</div><div>{order.id}</div></div>
          <div><div className="dim">Invoice Number</div><div>{invoiceId || '-'}</div></div>
          {printedAt && <div><div className="dim">Order Printed</div><div>{formatDateTime(printedAt)}</div></div>}
          {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
          {showSales && order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
          {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
          {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
          {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
          {/* Shipment Date directly above Function Date (one cell), not side
              by side across the two-column grid. */}
          {(order.shipmentDate || order.functionDate) && (
            <div>
              {order.shipmentDate && <><div className="dim">Shipment Date</div><div>{formatDate(toMalaysiaDay(order.shipmentDate))}</div></>}
              {order.functionDate && <><div className="dim" style={order.shipmentDate ? { marginTop: 'var(--space-2)' } : undefined}>Function Date</div><div>{formatDate(toMalaysiaDay(order.functionDate))}</div></>}
            </div>
          )}
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

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
        <PriceTable editable={false} priceDrafts={{}} setPrice={() => {}} {...priceTable} />
      </div>

      {catBlockGroups.length > 0 && (
        <div className="print-details-section">
          <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Order Details</div>
          {catBlockGroups.map(({ cat, blocks }, catIdx) => (
            <div key={cat.key} className={`print-category-page${catIdx > 0 ? ' print-category-break' : ''}`}>
              {blocks.map((blk, i) => (
                <OrderCategoryBlock key={i} blk={blk} editable={READONLY} hideEmptyRows />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
