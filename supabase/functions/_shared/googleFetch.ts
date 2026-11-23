// Every Google call of the Edge Functions (fill-google-form, sync-urgent-order-sheet) — one copy, imported.
// fill-google-form's masterList.ts re-exports it (its vitest test imports it from there).

// Google's Sheets / Forms answer 503 or hang now and then (2026-11-23 morning: a 503, then a 2½-minute hang that
// lost ORD-0572's column I). Each call gets GOOGLE_TIMEOUT_MS and GOOGLE_TRIES tries on a 429 / 5xx or a dead
// line. `safeToRepeat` false (the Form post): a call that timed out may still have gone through, so only one
// Google refused (429 / 5xx) is sent again. What still fails is kept and tried again later by each function's own pg_cron retry.
const GOOGLE_TIMEOUT_MS = 20_000;
const GOOGLE_TRIES = 3;
const GOOGLE_BACKOFF_MS = [1_000, 4_000];
const retryable = (status: number) => status === 429 || status >= 500;
export async function googleFetch(url: string, init: RequestInit = {}, safeToRepeat = true,
  deps = { fetch: (u: string, i: RequestInit) => fetch(u, i), sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)) }): Promise<Response> {
  const where = url.replace(/^https:\/\/([^/?]+)([^?]*).*$/, '$1$2');
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= GOOGLE_TRIES;
    const started = Date.now();
    try {
      const res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
      if (last || !retryable(res.status)) return res;
      await res.body?.cancel();
    } catch (err) {
      // which call and how long — the error lands in master_list_typed.error / the function log
      if (last || !safeToRepeat) throw new Error(`${where} (try ${attempt}, ${Date.now() - started} ms): ${(err as Error)?.message || err}`);
    }
    await deps.sleep(GOOGLE_BACKOFF_MS[attempt - 1] ?? 4_000);
  }
}
