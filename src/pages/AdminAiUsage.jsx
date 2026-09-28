import { Fragment, useEffect, useMemo, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import { fetchAiExtractionRuns, fetchAiGrammarChecks, fetchAllProfiles } from '../lib/adminApi';
import { loadWithRetry } from '../lib/loadWithRetry';

// Per-user monthly cost caps enforced by the two Edge Functions. Mirrors the
// defaults in supabase/functions/{extract-order-file,check-engraving-text}
// /index.ts — each is overridable there via a Supabase secret without a code
// change, so a cap shown here can drift from what's actually enforced if an
// admin has overridden it. "Remaining" below is computed against these.
const EXTRACT_MONTHLY_CAP_USD = 6;
const GRAMMAR_MONTHLY_CAP_USD = 3;

function centsToUsd(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function utcMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function StatTile({ value, label }) {
  return (
    <div className="bg-surface-container-lowest rounded-lg border border-outline-variant p-5 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col justify-between">
      <span className="text-label-bold text-on-surface-variant mb-2">{label}</span>
      <span className="text-stat-lg text-on-surface">{value}</span>
    </div>
  );
}

const STATUS_BADGE = {
  succeeded: 'bg-green-100 text-green-800',
  needs_human: 'bg-amber-100 text-amber-800',
  rate_limited: 'bg-amber-100 text-amber-800',
  cost_capped: 'bg-amber-100 text-amber-800',
  failed: 'bg-error-container text-on-error-container',
  processing: 'bg-surface-variant text-on-surface-variant',
};

function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded text-label-bold font-semibold text-xs ${STATUS_BADGE[status] || 'bg-surface-variant text-on-surface-variant'}`}>
      {status}
    </span>
  );
}

function aggregateByUser(rows, profilesById) {
  const byId = new Map();
  for (const r of rows) {
    const key = r.created_by;
    if (!byId.has(key)) byId.set(key, { userId: key, runs: 0, promptTok: 0, completionTok: 0, costCents: 0 });
    const agg = byId.get(key);
    agg.runs += 1;
    agg.promptTok += r.prompt_tokens || 0;
    agg.completionTok += r.completion_tokens || 0;
    agg.costCents += Number(r.cost_usd_cents) || 0;
  }
  return [...byId.values()]
    .map((agg) => {
      const profile = profilesById.get(agg.userId);
      return { ...agg, name: profile?.display_name || profile?.email || agg.userId };
    })
    .sort((a, b) => b.costCents - a.costCents);
}

function UsageByUserTable({ rows, capUsd }) {
  const capCents = capUsd * 100;
  if (rows.length === 0) return <p className="text-body-md text-on-surface-variant">No runs this month.</p>;
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-outline-variant bg-surface-bright/50">
              <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider">User</th>
              <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Runs</th>
              <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Tokens (in/out)</th>
              <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Spent</th>
              <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Cap</th>
              <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Remaining</th>
              <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Used</th>
            </tr>
          </thead>
          <tbody className="text-body-md text-on-surface divide-y divide-outline-variant">
            {rows.map((r) => {
              const usedPct = Math.min(100, Math.round((r.costCents / capCents) * 100));
              const remainingCents = Math.max(0, capCents - r.costCents);
              const warn = usedPct >= 90 ? 'text-error font-semibold' : usedPct >= 70 ? 'text-amber-700 font-semibold' : '';
              return (
                <tr key={r.userId} className="hover:bg-surface-container-low transition-colors">
                  <td className="py-3 px-6 font-medium">{r.name}</td>
                  <td className="py-3 px-6 text-right">{r.runs}</td>
                  <td className="py-3 px-6 text-right text-on-surface-variant">{r.promptTok.toLocaleString()} / {r.completionTok.toLocaleString()}</td>
                  <td className="py-3 px-6 text-right">{centsToUsd(r.costCents)}</td>
                  <td className="py-3 px-6 text-right text-on-surface-variant">${capUsd.toFixed(2)}</td>
                  <td className="py-3 px-6 text-right">{centsToUsd(remainingCents)}</td>
                  <td className={`py-3 px-6 text-right ${warn}`}>{usedPct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminAiUsage() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    loadWithRetry(() => Promise.all([fetchAiExtractionRuns(), fetchAiGrammarChecks(), fetchAllProfiles()]))
      .then(([extractRows, grammarRows, profiles]) => { if (!cancelled) setData({ extractRows, grammarRows, profiles }); })
      .catch((err) => { console.error('Failed to load AI usage:', err); if (!cancelled) setLoadError('Could not load. Check your connection and try again.'); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const derived = useMemo(() => {
    if (!data) return null;
    const profilesById = new Map(data.profiles.map((p) => [p.id, p]));
    const monthStart = utcMonthStartIso();
    const extractMonth = data.extractRows.filter((r) => r.created_at >= monthStart);
    const grammarMonth = data.grammarRows.filter((r) => r.created_at >= monthStart);

    const sumCost = (rows) => rows.reduce((s, r) => s + (Number(r.cost_usd_cents) || 0), 0);
    const sumTok = (rows) => rows.reduce((s, r) => s + (r.prompt_tokens || 0) + (r.completion_tokens || 0), 0);

    const totalCostCents = sumCost(extractMonth) + sumCost(grammarMonth);
    const totalTokens = sumTok(extractMonth) + sumTok(grammarMonth);
    const succeeded = extractMonth.filter((r) => r.status === 'succeeded').length;
    const needsHuman = extractMonth.filter((r) => r.status === 'needs_human').length;
    const successRate = extractMonth.length ? Math.round((succeeded / extractMonth.length) * 100) : 0;

    const recent = [
      ...data.extractRows.slice(0, 40).map((r) => ({ ...r, _type: 'extract' })),
      ...data.grammarRows.slice(0, 40).map((r) => ({ ...r, _type: 'grammar' })),
    ]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 40)
      .map((r) => ({ ...r, _name: profilesById.get(r.created_by)?.display_name || profilesById.get(r.created_by)?.email || '—' }));

    return {
      totalCostCents,
      totalTokens,
      extractRunsMonth: extractMonth.length,
      grammarChecksMonth: grammarMonth.length,
      successRate,
      needsHuman,
      extractByUser: aggregateByUser(extractMonth, profilesById),
      grammarByUser: aggregateByUser(grammarMonth, profilesById),
      recent,
    };
  }, [data]);

  return (
    <AdminLayout title="AI Usage & Cost" subtitle="Token spend and monthly quota for the AI order-file reader and engraving-text checker.">
      {loadError ? (
        <div className="text-body-md">
          <p className="text-error mb-2">{loadError}</p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="text-label-bold font-semibold text-primary hover:underline">Retry</button>
        </div>
      ) : derived === null ? (
        <p className="text-body-md text-on-surface-variant">Loading AI usage...</p>
      ) : (
        <>
          <section className="mb-10">
            <h3 className="text-headline-sm text-on-surface mb-4 uppercase tracking-wider opacity-70">This Month, All Users</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              <StatTile value={centsToUsd(derived.totalCostCents)} label="Total Spend" />
              <StatTile value={derived.totalTokens.toLocaleString()} label="Total Tokens" />
              <StatTile value={derived.extractRunsMonth} label="File Imports" />
              <StatTile value={derived.grammarChecksMonth} label="Text Checks" />
              <StatTile value={`${derived.successRate}%`} label="Import Success Rate" />
              <StatTile value={derived.needsHuman} label="Imports Needing Review" />
            </div>
          </section>

          <section className="mb-10">
            <h3 className="text-headline-sm text-on-surface mb-4 uppercase tracking-wider opacity-70">
              Order File Extraction — by User (${EXTRACT_MONTHLY_CAP_USD.toFixed(2)}/month cap each)
            </h3>
            <UsageByUserTable rows={derived.extractByUser} capUsd={EXTRACT_MONTHLY_CAP_USD} />
          </section>

          <section className="mb-10">
            <h3 className="text-headline-sm text-on-surface mb-4 uppercase tracking-wider opacity-70">
              Engraving Text Check — by User (${GRAMMAR_MONTHLY_CAP_USD.toFixed(2)}/month cap each)
            </h3>
            <UsageByUserTable rows={derived.grammarByUser} capUsd={GRAMMAR_MONTHLY_CAP_USD} />
          </section>

          <section>
            <h3 className="text-headline-sm text-on-surface mb-4 uppercase tracking-wider opacity-70">Recent Activity</h3>
            {derived.recent.length === 0 ? (
              <p className="text-body-md text-on-surface-variant">No AI runs recorded yet.</p>
            ) : (
              <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-outline-variant bg-surface-bright/50">
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider">When</th>
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider">User</th>
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider">Feature</th>
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider">Status</th>
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider">Model</th>
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Tokens (in/out)</th>
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right">Cost</th>
                        <th className="text-label-bold text-on-surface-variant py-3 px-6 uppercase tracking-wider text-right" />
                      </tr>
                    </thead>
                    <tbody className="text-body-md text-on-surface divide-y divide-outline-variant">
                      {derived.recent.map((r) => {
                        const hasDetails = Boolean(r.error || r.file_name || r.raw_response);
                        return (
                          <Fragment key={`${r._type}-${r.id}`}>
                            <tr className="hover:bg-surface-container-low transition-colors">
                              <td className="py-3 px-6 text-on-surface-variant whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                              <td className="py-3 px-6 font-medium">{r._name}</td>
                              <td className="py-3 px-6 text-on-surface-variant">{r._type === 'extract' ? 'File Import' : 'Text Check'}</td>
                              <td className="py-3 px-6"><StatusBadge status={r.status} /></td>
                              <td className="py-3 px-6 text-on-surface-variant">{r.model || '—'}</td>
                              <td className="py-3 px-6 text-right text-on-surface-variant">{(r.prompt_tokens || 0).toLocaleString()} / {(r.completion_tokens || 0).toLocaleString()}</td>
                              <td className="py-3 px-6 text-right">{centsToUsd(r.cost_usd_cents)}</td>
                              <td className="py-3 px-6 text-right">
                                {hasDetails && (
                                  <button type="button" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="text-label-bold font-semibold text-on-surface hover:text-primary transition-colors">
                                    {expandedId === r.id ? 'Hide' : 'Details'}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {expandedId === r.id && hasDetails && (
                              <tr>
                                <td className="p-0" colSpan={8}>
                                  <div className="p-6 bg-surface border-t border-outline-variant grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="text-body-sm space-y-1">
                                      {r._type === 'extract' && <p><span className="text-on-surface-variant">File:</span> {r.file_name}</p>}
                                      {r._type === 'grammar' && <p><span className="text-on-surface-variant">Lines checked / issues found:</span> {r.lines_checked ?? '—'} / {r.issues_found ?? '—'}</p>}
                                      <p><span className="text-on-surface-variant">Attempt:</span> {r.attempt ?? '—'}</p>
                                      {r.error && <p className="text-error">{r.error}</p>}
                                    </div>
                                    {r.raw_response && (
                                      <div>
                                        <span className="text-label-bold text-on-surface-variant uppercase tracking-wider block mb-2">Raw Model Response</span>
                                        <pre className="text-body-sm whitespace-pre-wrap bg-surface-container-lowest border border-outline-variant rounded-lg p-3 max-h-64 overflow-y-auto">
                                          {JSON.stringify(r.raw_response, null, 2).slice(0, 4000)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </AdminLayout>
  );
}
