import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { fetchAllProfiles } from '../lib/adminApi';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';

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
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Admin Dashboard</div>
          <p className="hint-text" style={{ margin: 0 }}>What&apos;s happening in the system right now.</p>
        </div>
      </div>

      {profiles === null ? (
        <p className="hint-text">Loading users...</p>
      ) : (
        <>
          <div className="card-kicker">Users</div>
          <div className="stat-grid">
            <div className="stat-tile"><div className="stat-tile-value">{profiles.length}</div><div className="stat-tile-label">Total Users</div></div>
            <div className="stat-tile"><div className="stat-tile-value">{schools.length}</div><div className="stat-tile-label">Schools</div></div>
            <div className="stat-tile"><div className="stat-tile-value">{salesmen.length}</div><div className="stat-tile-label">Salesmen</div></div>
            <div className="stat-tile"><div className="stat-tile-value">{production.length}</div><div className="stat-tile-label">Production</div></div>
            <div className="stat-tile"><div className="stat-tile-value">{activeCount}</div><div className="stat-tile-label">Active</div></div>
            <div className="stat-tile"><div className="stat-tile-value">{inactiveCount}</div><div className="stat-tile-label">Inactive</div></div>
          </div>
        </>
      )}

      <div className="card-kicker">Orders</div>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-tile-value">{orders.length}</div><div className="stat-tile-label">Total Orders</div></div>
        {STATUS_STAGES.map((stage) => (
          <div className="stat-tile" key={stage}>
            <div className="stat-tile-value">{orders.filter((o) => o.status === stage).length}</div>
            <div className="stat-tile-label">{stage}</div>
          </div>
        ))}
      </div>

      <div className="card-kicker">Recent Orders</div>
      {recentOrders.length === 0 && <p className="hint-text">No orders yet.</p>}
      <div className="order-grid">
        {recentOrders.map((ord) => {
          const idx = STATUS_STAGES.indexOf(ord.status);
          return (
            <div key={ord.id} className="card order-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/orders/${ord.id}`)}>
              <div className="order-card-top">
                <div>
                  <div className="order-card-label">Order ID</div>
                  <div className="order-card-id">{ord.id}</div>
                </div>
                <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{ord.status}</span>
              </div>
              <div className="order-card-meta">
                <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
                <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
              </div>
              <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
