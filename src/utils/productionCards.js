import { getOrderInvoiceSlices, getInvoiceItems } from './orderBatches';
import { kivParts, hasMainPart, isCrystalCode } from './exportCsv';

// The Production dashboard's cards for one order (Sean, 2026-10-28, ORD-0108). A split order shows
// one card per invoice, each judged by its OWN items: an invoice of only crystals has nothing to type
// (its crystals are on the KIV & ARTWORK card) and only an invoice with crystals is ACARA. The one
// KIV & ARTWORK card still holds the whole order's crystals / Reserved rows (artwork confirmed and
// Done for the whole order), naming the invoices they're billed on (`_kivInvoices`).
// A crystal card shows only its crystals' QTY / amount, the plaques' (ACARA) card the rest (Sean, 2026-10-30).
// Before In Production the crystals have no card of their own, so the one card keeps them (ORD-0193, 2026-10-31).
export const crystalsHaveOwnCard = (status) => status === 'In Production' || status === 'Completed';
function crystalTotals(card) {
  const crystals = kivParts(card).includes('CRYSTAL') && crystalsHaveOwnCard(card.status) ? (card.items || []).filter((it) => isCrystalCode(it.jenisPlak)) : [];
  return {
    qty: crystals.reduce((n, it) => n + (Number(it.qty) || 0), 0),
    amount: crystals.reduce((n, it) => n + (Number(it.harga) || 0), 0),
    any: crystals.length > 0,
  };
}

export function productionCards(ord, plakCatalog) {
  const split = (ord.invoiceGroups || []).length > 0;
  const slices = getOrderInvoiceSlices(ord, plakCatalog).map((slice, i) => {
    const card = { ...ord, items: split ? getInvoiceItems(ord, slice.invoiceId) : ord.items };
    const crystals = crystalTotals({ ...card, status: slice.status });
    return {
      ...card, invoiceId: slice.invoiceId, totalAmount: slice.totalAmount - crystals.amount, totalQty: slice.totalQty - crystals.qty,
      priceAdjusted: slice.priceAdjusted, status: slice.status, typedAt: slice.typedAt,
      _sliceKey: `${ord.id}::${slice.invoiceId || 'default'}`, _primarySlice: i === 0, _part: 'main', _order: ord,
    };
  });
  if (kivParts(ord).length === 0 || !slices[0]) return slices;
  const kivInvoices = split ? slices.filter((s) => kivParts(s).length > 0).map((s) => s.invoiceId).filter(Boolean) : [];
  // a SHORT SUPPLY-only card keeps the whole order's numbers
  const crystals = crystalTotals(ord);
  const totals = crystals.any ? { totalQty: crystals.qty, totalAmount: crystals.amount } : { totalQty: ord.totalQty, totalAmount: ord.totalAmount };
  return [...slices, { ...slices[0], items: ord.items, ...totals, _sliceKey: `${slices[0]._sliceKey}::kiv`, _part: 'kiv', _kivInvoices: kivInvoices }];
}

// The order's invoice groups once its KIV & ARTWORK card is Done: an invoice with nothing of its own
// to type (only crystals / Reserved rows) has no Typing card to finish it, so it's Completed here.
export function kivOnlyGroupsDone(order) {
  return (order.invoiceGroups || []).map((g) => {
    const own = { ...order, items: getInvoiceItems(order, g.invoiceId) };
    return own.items.length > 0 && !hasMainPart(own) ? { ...g, status: 'Completed' } : g;
  });
}
