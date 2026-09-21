// Shows the result of computeAddOnDiff (src/utils/addOnDiff.js) before
// anything is written into the Add-On draft — three buckets per category
// (new / already-exists-skip / flagged-missing-or-decreased), plus one
// explicit "Apply" gate at the bottom. No modal exists anywhere in this
// codebase; this follows the same inline "review before continuing" idiom
// NewOrderStep2.jsx's own .confirm-panel already uses, just with plain
// informational lists instead of yes/no choice buttons — there's nothing
// to individually accept/reject here, only to look at before confirming,
// since the actual per-row editing already lives in the block editor below.
export default function AddOnDiffPanel({ diffResult, applying, onApply, onCancel }) {
  const categories = diffResult?.perCategory || [];
  const totalNew = categories.reduce((sum, c) => (
    sum + c.newRows.length + c.matrixDelta.length + (c.isNewCategory ? 1 : 0)
  ), 0);

  return (
    <div className="confirm-panel" style={{ maxWidth: 560, margin: '0 auto var(--space-6)' }}>
      <div className="confirm-panel-title">Review before applying</div>
      {categories.map((cat) => (
        <div key={cat.categoryKey} className="confirm-item">
          <p className="confirm-item-q">{cat.categoryLabel}</p>

          {cat.isNewCategory && (
            <p className="hint-text" style={{ margin: 0 }}>New category — everything in this sheet will be added.</p>
          )}

          {cat.kind === 'unsupported' && (
            <div className="login-error" style={{ margin: 0 }}>
              {cat.flaggedMissing.map((f) => <div key={f.note}>{f.note}</div>)}
            </div>
          )}

          {cat.newRows.length > 0 && (
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              {cat.newRows.map((r, i) => (
                <li key={i} className="hint-text">
                  {r.namaMurid ? `${r.namaMurid} — ${r.desc}` : `${r.desc}: +${r.delta} (${r.oldQty} → ${r.newQty})`}
                </li>
              ))}
            </ul>
          )}
          {cat.matrixDelta.length > 0 && (
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              {cat.matrixDelta.map((d, i) => (
                <li key={i} className="hint-text">{d.subject} × {d.col}: +{d.delta} ({d.oldQty} → {d.newQty})</li>
              ))}
            </ul>
          )}

          {cat.skippedRows.length > 0 && (
            <p className="hint-text" style={{ margin: '4px 0', opacity: 0.6 }}>
              {cat.skippedRows.length} already in the order — skipped.
            </p>
          )}

          {(cat.flaggedMissing.length > 0 && cat.kind !== 'unsupported') && (
            <div className="login-error" style={{ margin: '4px 0' }}>
              {cat.flaggedMissing.map((f, i) => (
                <div key={i}>
                  {f.namaMurid
                    ? `${f.namaMurid} — ${f.desc}: not found in this upload.`
                    : `${f.desc}: file shows ${f.newQty}, order currently has ${f.oldQty} — not reduced.`}
                </div>
              ))}
            </div>
          )}
          {cat.matrixFlagged.length > 0 && (
            <div className="login-error" style={{ margin: '4px 0' }}>
              {cat.matrixFlagged.map((d, i) => (
                <div key={i}>{d.subject} × {d.col}: file shows {d.newQty}, order currently has {d.oldQty} — not reduced.</div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="row-actions" style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={onApply} disabled={applying}>
          {applying ? 'Applying…' : `Apply ${totalNew} new item(s)`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={applying}>Cancel / re-upload</button>
      </div>
    </div>
  );
}
