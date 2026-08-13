import { Fragment, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { fetchAuditLog } from '../lib/adminApi';

export default function AdminAuditLog() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    fetchAuditLog()
      .then(setRows)
      .catch((err) => { console.error('Failed to load activity log:', err); setLoadError('Unable to load the activity log. Please try again.'); });
  }, []);

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Activity Log</div>
          <p className="hint-text" style={{ margin: 0 }}>A record of administrative actions taken in this system.</p>
        </div>
      </div>

      {loadError && <div className="login-error">{loadError}</div>}

      {rows === null ? (
        <p className="hint-text">Loading activity log...</p>
      ) : rows.length === 0 ? (
        <p className="hint-text">No activity recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.profiles?.display_name || '—'}</td>
                    <td>{row.action}</td>
                    <td>{row.target_table ? `${row.target_table} (${row.target_id || '—'})` : '—'}</td>
                    <td>
                      {(row.before || row.after) && (
                        <button type="button" className="btn btn-ghost" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                          {expandedId === row.id ? 'Hide Details' : 'View Details'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === row.id && (row.before || row.after) && (
                    <tr>
                      <td colSpan={5}>
                        <div className="form-grid-2">
                          {row.before && <div><div className="dim">Before</div><pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.before, null, 2)}</pre></div>}
                          {row.after && <div><div className="dim">After</div><pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.after, null, 2)}</pre></div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
