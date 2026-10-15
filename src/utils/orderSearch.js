// "Search Order" (Salesman 2026-10-09, Production 2026-10-15): a partial,
// case-insensitive match on School Name, Invoice Number (the order's own or a
// split invoice's — 0070), Order ID, or the Salesman's name / account ID.
// Extra spaces are ignored, so "sk  sungai" finds "SK SUNGAI ...".
const normalize = (text) => String(text || '').toUpperCase().replace(/\s+/g, ' ').trim();

export function matchesOrderSearch(order, query) {
  const q = normalize(query);
  if (!q) return false;
  const invoices = [order.invoiceId, ...(order.invoiceGroups || []).map((g) => g.invoiceId)];
  return [order.sekolah, order.id, ...invoices, order.sales, order.salesmanId].some((field) => normalize(field).includes(q));
}
