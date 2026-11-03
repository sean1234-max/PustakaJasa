import { describe, it, expect, vi } from 'vitest';
import { reloadOnNewVersion, shouldReload, RELOAD_GUARD_MS } from './reloadOnNewVersion';

const fakeWindow = (stored = null) => {
  const handlers = {};
  const store = { reloadedForNewVersion: stored };
  return {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    sessionStorage: { getItem: (k) => store[k], setItem: (k, v) => { store[k] = v; } },
    location: { reload: vi.fn() },
    fire: () => { const e = { preventDefault: vi.fn() }; handlers['vite:preloadError'](e); return e; },
  };
};

describe('reloadOnNewVersion — an old tab after a deploy gets the new build', () => {
  it('reloads once when a code file is gone', () => {
    const win = fakeWindow();
    reloadOnNewVersion(win);
    const e = win.fire();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload again within a minute (a real outage shows its error)', () => {
    const win = fakeWindow(String(Date.now()));
    reloadOnNewVersion(win);
    const e = win.fire();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(shouldReload(10 * RELOAD_GUARD_MS, 0)).toBe(true);
  });
});
