// Admin pages fetch straight from Supabase on mount. A transient failure —
// the auth token expiring right as the page loads (the request races
// through as `anon` and RLS's current_role() call is denied), a cold
// Supabase Free-tier database, a network blip — used to leave the page
// stuck on "Loading…" forever, since the catch only logged.
//
// This retries a few times with a short backoff (usually enough to ride
// out a token refresh or a DB wake-up), then rethrows so the caller can
// show a real "couldn't load — retry" state instead of a spinner that
// never resolves.
export async function loadWithRetry(fn, { tries = 3, baseDelay = 700 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    if (i > 0) await new Promise((r) => { setTimeout(r, baseDelay * i); });
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
