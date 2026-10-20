// A Tambahan that is really the original order uploaded again (Sean,
// 2026-10-19, ORD-0087: the whole of ORD-0046, RM 2,761, became an
// add-on): most of its items are items the order already has (same tab,
// Jenis Plak and quantity), and together they are at least half the
// order. Returns { matched, total } when it looks like that, else null.
const sig = (it) => [it.categoryKey || it.categoryLabel || '', String(it.jenisPlak || '').trim().toUpperCase(), Number(it.qty) || 0].join('\u0000');

export function addonRepeatsOrder(addonItems, orderItems) {
  const addon = addonItems || [];
  const order = orderItems || [];
  if (!addon.length || !order.length) return null;
  const left = new Map();
  order.forEach((it) => left.set(sig(it), (left.get(sig(it)) || 0) + 1));
  let matched = 0;
  let matchedQty = 0;
  addon.forEach((it) => {
    const n = left.get(sig(it));
    if (!n) return;
    left.set(sig(it), n - 1);
    matched += 1;
    matchedQty += Number(it.qty) || 0;
  });
  const orderQty = order.reduce((a, it) => a + (Number(it.qty) || 0), 0);
  return matched >= addon.length * 0.8 && matchedQty >= orderQty * 0.5 ? { matched, total: addon.length } : null;
}

export function addonRepeatMessage(orderId, hit) {
  return `${hit.matched} daripada ${hit.total} item Tambahan ini sama dengan order asal ${orderId}. Adakah ini order asal yang dimuat naik semula?\n\n`
    + `${hit.matched} of this Tambahan's ${hit.total} items are already in the original order ${orderId} — it looks like the original order uploaded again, which would be made twice.\n\nTeruskan juga? / Continue anyway?`;
}
