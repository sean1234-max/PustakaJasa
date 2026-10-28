import { getOrderInvoiceSlices, getInvoiceItems } from './orderBatches';
import { kivParts, hasMainPart } from './exportCsv';

// The Production dashboard's cards for one order (Sean, 2026-10-28, ORD-0108). A split order shows
// one card per invoice, each judged by its OWN items: an invoice of only crystals has nothing to type
// (its crystals are on the KIV & ARTWORK card) and only an invoice with crystals is ACARA. The one
// KIV & ARTWORK card still holds the whole order's crystals / Reserved rows (artwork confirmed and
// Done for the whole order), naming the invoices they're billed on (`_kivInvoices`).
export function productionCards(ord, plakCatalog) {
  const split = (ord.invoiceGroups || []).length > 0;
  const slices = getOrderInvoiceSlices(ord, plakCatalog).map((slice, i) => ({
    ...ord, items: split ? getInvoiceItems(ord, slice.invoiceId) : ord.items,
    invoiceId: slice.invoiceId, totalAmount: slice.totalAmount, totalQty: slice.totalQty,
    priceAdjusted: slice.priceAdjusted, status: slice.status, typedAt: slice.typedAt,
    _sliceKey: `${ord.id}::${slice.invoiceId || 'default'}`, _primarySlice: i === 0, _part: 'main', _order: ord,
  }));
  if (kivParts(ord).length === 0 || !slices[0]) return slices;
  const kivInvoices = split ? slices.filter((s) => kivParts(s).length > 0).map((s) => s.invoiceId).filter(Boolean) : [];
  return [...slices, { ...slices[0], items: ord.items, _sliceKey: `${slices[0]._sliceKey}::kiv`, _part: 'kiv', _kivInvoices: kivInvoices }];
}

// The order's invoice groups once its KIV & ARTWORK card is Done: an invoice with nothing of its own
// to type (only crystals / Reserved rows) has no Typing card to finish it, so it's Completed here.
export function kivOnlyGroupsDone(order) {
  return (order.invoiceGroups || []).map((g) => {
    const own = { ...order, items: getInvoiceItems(order, g.invoiceId) };
    return own.items.length > 0 && !hasMainPart(own) ? { ...g, status: 'Completed' } : g;
  });
}
