// A tab opened before a deploy still asks for the old build's code files when it needs one (the PDF
// reader, the Excel form …): they're gone, so the button failed with a misleading "Could not read
// this PDF" (Sean, 2026-11-02/03). Vite says so with `vite:preloadError`: the page reloads once to
// get the new build. Not again within a minute, so a real outage shows its error instead of looping.
const KEY = 'reloadedForNewVersion';
export const RELOAD_GUARD_MS = 60_000;

export const shouldReload = (now, last) => !(last > 0 && now - last < RELOAD_GUARD_MS);

export function reloadOnNewVersion(win = window) {
  win.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try { last = Number(win.sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked: reload anyway */ }
    if (!shouldReload(Date.now(), last)) return;
    try { win.sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
    event.preventDefault();
    win.location.reload();
  });
}
