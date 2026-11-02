// Why the Cart / Add On can't be submitted: a Jenis Plak over its stock, or one with no stock to sell
// at all (hidden — it came in from an uploaded file; Sean, 2026-11-02).
export default function StockViolationMessage({ violation }) {
  const where = violation.categoryLabel ? ` (${violation.categoryLabel})` : '';
  return (
    <div role="alert" style={{ border: '2px solid #c0392b', background: '#fdecea', color: '#c0392b', fontWeight: 600, padding: 'var(--space-3) var(--space-4)', borderRadius: 6, margin: 'var(--space-3) 0' }}>
      {violation.hidden ? (
        <>
          Jenis Plak &quot;{violation.jenisPlak}&quot;{where} tidak cukup stok — sila hubungi Salesman. Order ini tidak boleh dihantar.
          <div style={{ fontWeight: 400, marginTop: 4 }}>
            ({violation.jenisPlak} is out of stock — please contact your Salesman. This order can&apos;t be submitted.)
          </div>
        </>
      ) : (
        <>Stock tidak cukup untuk &quot;{violation.jenisPlak}&quot;{where} — baki {violation.maxOrderable} sahaja boleh ditempah. Sila kurangkan kuantiti atau hubungi Salesman sebelum submit.</>
      )}
    </div>
  );
}
