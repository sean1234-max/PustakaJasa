import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import { summarizeUrgentCommission, URGENT_COMMISSION_RATE } from '../utils/urgentOrder';

const EMPTY_ORDERS = [];
const rm = (n) => `RM ${(Number(n) || 0).toFixed(2)}`;

// Every urgent order's 2.5% commission (src/utils/urgentOrder.js), worked out
// live from its current order total. The Google Sheet gets the same figure
// once, when Store Admin saves the order's Invoice Number.
export default function AdminUrgentCommission() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const orders = state.orders || EMPTY_ORDERS;
  const { rows, months } = useMemo(() => summarizeUrgentCommission(orders), [orders]);
  const rate = `${URGENT_COMMISSION_RATE * 100}%`;

  return (
    <AdminLayout title="Urgent Commission" subtitle={`Each urgent order gives up ${rate} of its order total as commission.`}>
      {!state.ordersLoaded ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No urgent orders yet.</p>
      ) : (
        <>
          <section className="mb-10">
            <h2 className="text-headline-sm text-on-surface mb-4">Per month, per salesman</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {months.map((m) => (
                <div key={m.month} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
                  <div className="flex justify-between items-baseline mb-3">
                    <span className="text-label-bold uppercase tracking-wider text-on-surface-variant">{m.month}</span>
                    <span className="text-headline-sm text-primary">{rm(m.commission)}</span>
                  </div>
                  <table className="w-full text-body-md">
                    <thead>
                      <tr className="text-on-surface-variant text-left">
                        <th className="py-1 font-semibold">Salesman</th>
                        <th className="py-1 font-semibold text-right">Orders</th>
                        <th className="py-1 font-semibold text-right">Order total</th>
                        <th className="py-1 font-semibold text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.salesmen.map((s) => (
                        <tr key={s.name} className="border-t border-outline-variant">
                          <td className="py-1.5">{s.name}</td>
                          <td className="py-1.5 text-right">{s.count}</td>
                          <td className="py-1.5 text-right">{rm(s.amount)}</td>
                          <td className="py-1.5 text-right font-semibold">{rm(s.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-headline-sm text-on-surface mb-4">Every urgent order ({rows.length})</h2>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-body-md">
                <thead>
                  <tr className="text-on-surface-variant text-left">
                    <th className="px-4 py-3 font-semibold">Order</th>
                    <th className="px-4 py-3 font-semibold">Invoice</th>
                    <th className="px-4 py-3 font-semibold">School</th>
                    <th className="px-4 py-3 font-semibold">Salesman</th>
                    <th className="px-4 py-3 font-semibold">Date placed</th>
                    <th className="px-4 py-3 font-semibold text-right">Order total</th>
                    <th className="px-4 py-3 font-semibold text-right">Commission ({rate})</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ order, amount, commission }) => (
                    <tr
                      key={order.id}
                      className="border-t border-outline-variant cursor-pointer hover:bg-surface-variant"
                      onClick={() => navigate(`/admin/orders/${order.id}`)}
                    >
                      <td className="px-4 py-3 text-primary font-semibold">{order.id}</td>
                      <td className="px-4 py-3">{order.invoiceId || '—'}</td>
                      <td className="px-4 py-3">{order.sekolah || '—'}</td>
                      <td className="px-4 py-3">{order.sales || '—'}</td>
                      <td className="px-4 py-3">{order.datePlaced}</td>
                      <td className="px-4 py-3 text-right">{rm(amount)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{rm(commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </AdminLayout>
  );
}
