import { useEffect, useState } from 'react';

// A dashboard's search / filters / tab and scroll position, kept for this browser tab (Sean, 2026-11-06):
// opening an order and coming back shows the list as the person left it. sessionStorage is per tab and
// gone when the tab closes; the key carries the account so another login in the same tab starts fresh.
const PREFIX = 'pj:view:';

function read(key, fallback) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode / full: just not kept */ }
}

// useState that survives leaving the page and coming back in the same tab.
export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => read(key, typeof initial === 'function' ? initial() : initial));
  useEffect(() => { write(key, value); }, [key, value]);
  return [value, setValue];
}

const MAX_RESTORE_FRAMES = 60; // ~1 s for the list to grow tall enough

// Puts the page back where it was scrolled to, once the list is tall enough to get there.
export function useRestoreScroll(key) {
  useEffect(() => {
    const target = read(`${key}:scroll`, 0);
    let frame = 0;
    let raf = 0;
    const restore = () => {
      const reachable = document.documentElement.scrollHeight - window.innerHeight >= target;
      if (reachable || frame >= MAX_RESTORE_FRAMES) { window.scrollTo(0, target); return; }
      frame += 1;
      raf = requestAnimationFrame(restore);
    };
    if (target > 0) raf = requestAnimationFrame(restore);
    const save = () => write(`${key}:scroll`, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', save); };
  }, [key]);
}
