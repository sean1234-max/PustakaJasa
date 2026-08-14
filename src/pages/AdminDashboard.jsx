import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import { fetchAllProfiles } from '../lib/adminApi';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';

function StatTile({ value, label }) {
  return (
    <div className="bg-surface-container-lowest rounded-lg border border-outline-variant p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col justify-between">
      <span className="text-label-bold text-on-surface-variant mb-2">{label}</span>
      <span className="text-stat-lg text-on-surface">{value}</span>
    </div>
  );
}

export default function AdminDashboard() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllProfiles()
      .then((rows) => { if (!cancelled) setProfiles(rows); })
      .catch((err) => console.error('Failed to load users:', err));
    return () => { cancelled = true; };
  }, []);

  const schools = (profiles || []).filter((p) => p.role === 'teacher');
  const salesmen = (profiles || []).filter((p) => p.role === 'salesman');
  const production = (profiles || []).filter((p) => p.role === 'production');
  const activeCount = (profiles || []).filter((p) => p.status === 'active').length;
  const inactiveCount = (profiles || []).filter((p) => p.status !== 'active').length;

  const orders = state.orders || [];
  const recentOrders = [...orders]
    .sort((a, b) => (a.datePlaced < b.datePlaced ? 1 : -1))
    .slice(0, 8);

  return (
    <AdminLayout title="Admin Dashboard" subtitle="What's happening in the system right now.">
      {profiles === null ? (
        <p className="text-body-md text-on-surface-variant">Loading users...</p>
      ) : (
        <section className="mb-10">
          <h3 className="text-headline-sm text-on-surface mb-4 uppercase tracking-wider opacity-70">Users</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
            <StatTile value={profiles.length} label="Total Users" />
            <StatTile value={schools.length} label="Schools" />
            <StatTile value={salesmen.length} label="Salesmen" />
            <StatTile value={production.length} label="Production" />
            <StatTile value={activeCount} label="Active" />
            <StatTile value={inactiveCount} label="Inactive" />
          </div>
        </section>
      )}

      <section className="mb-10">
        <h3 className="text-headline-sm text-on-surface mb-4 uppercase tracking-wider opacity-70">Orders</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">
          <StatTile value={orders.length} label="Total Orders" />
          {STATUS_STAGES.map((stage) => (
            <StatTile key={stage} value={orders.filter((o) => o.status === stage).length} label={stage} />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-headline-sm text-on-surface uppercase tracking-wider opacity-70">Recent Orders</h3>
          <button type="button" onClick={() => navigate('/admin/orders')} className="text-primary text-label-bold font-semibold hover:underline">View All</button>
        </div>
        {recentOrders.length === 0 && <p className="text-body-md text-on-surface-variant">No orders yet.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recentOrders.map((ord) => {
            const idx = STATUS_STAGES.indexOf(ord.status);
            return (
              <button
                type="button"
                key={ord.id}
                onClick={() => navigate(`/admin/orders/${ord.id}`)}
                className="text-left bg-surface-container-lowest rounded-lg border border-outline-variant p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col"
              >
                <div className="flex justify-between items-start mb-4 border-b border-outline-variant/30 pb-4">
                  <div>
                    <span className="text-label-bold text-on-surface-variant block mb-1">Order ID</span>
                    <span className="text-headline-md text-primary">{ord.id}</span>
                  </div>
                  <span className="px-3 py-1 rounded text-label-bold font-semibold" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>
                    {ord.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <span className="text-label-bold text-on-surface-variant block mb-1">Sekolah</span>
                    <span className="text-body-md text-on-surface">{ord.sekolah || '—'}</span>
                  </div>
                  <div>
                    <span className="text-label-bold text-on-surface-variant block mb-1">Sales</span>
                    <span className="text-body-md text-on-surface">{ord.sales || '—'}</span>
                  </div>
                  <div>
                    <span className="text-label-bold text-on-surface-variant block mb-1">Date Placed</span>
                    <span className="text-body-md text-on-surface">{ord.datePlaced}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </AdminLayout>
  );
}
