import { Fragment, useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
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
    <AdminLayout title="Activity Log" subtitle="A record of administrative actions taken in this system.">
      {loadError && <div className="mb-6 bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md">{loadError}</div>}

      {rows === null ? (
        <p className="text-body-md text-on-surface-variant">Loading activity log...</p>
      ) : rows.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No activity recorded yet.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-bright/50">
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">When</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">Admin</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">Action</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">Target</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider text-right" />
                </tr>
              </thead>
              <tbody className="text-body-md text-on-surface divide-y divide-outline-variant">
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="hover:bg-surface-container-low transition-colors">
                      <td className="py-4 px-6 text-on-surface-variant">{new Date(row.created_at).toLocaleString()}</td>
                      <td className="py-4 px-6 font-medium">{row.profiles?.display_name || '—'}</td>
                      <td className="py-4 px-6">{row.action}</td>
                      <td className="py-4 px-6 text-on-surface-variant">{row.target_table ? `${row.target_table} (${row.target_id || '—'})` : '—'}</td>
                      <td className="py-4 px-6 text-right">
                        {(row.before || row.after) && (
                          <button type="button" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} className="text-label-bold font-semibold text-on-surface hover:text-primary transition-colors">
                            {expandedId === row.id ? 'Hide Details' : 'View Details'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === row.id && (row.before || row.after) && (
                      <tr>
                        <td className="p-0" colSpan={5}>
                          <div className="p-6 bg-surface border-t border-outline-variant grid grid-cols-1 md:grid-cols-2 gap-6">
                            {row.before && (
                              <div>
                                <span className="text-label-bold text-on-surface-variant uppercase tracking-wider block mb-2">Before</span>
                                <pre className="text-body-sm whitespace-pre-wrap bg-surface-container-lowest border border-outline-variant rounded-lg p-3">{JSON.stringify(row.before, null, 2)}</pre>
                              </div>
                            )}
                            {row.after && (
                              <div>
                                <span className="text-label-bold text-on-surface-variant uppercase tracking-wider block mb-2">After</span>
                                <pre className="text-body-sm whitespace-pre-wrap bg-surface-container-lowest border border-outline-variant rounded-lg p-3">{JSON.stringify(row.after, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
