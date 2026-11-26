import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseHelperVersion, isHelperFile, shouldUpdate, copyHelperFiles, loadError } from './launcher.mjs';

describe('parseHelperVersion', () => {
  it('reads the helper\'s VERSION line', () => {
    expect(parseHelperVersion('// 9: launcher\nconst VERSION = 9;\nconst X = 1;')).toBe(9);
  });
  it('is 0 when the file has none (missing / half-copied)', () => {
    expect(parseHelperVersion('')).toBe(0);
    expect(parseHelperVersion('// const VERSION = 12; only in a comment')).toBe(0);
  });
});

describe('isHelperFile', () => {
  it('copies the modules and the preview export', () => {
    expect(['ai-file-helper.mjs', 'medal-designs.mjs', 'export-plak-preview.jsx'].every(isHelperFile)).toBe(true);
  });
  it('leaves out tests, the launcher, macOS ._ files and .bak copies', () => {
    expect(['ai-file-helper.test.mjs', 'launcher.mjs', '._ai-file-helper.mjs', 'ai-file-helper.mjs.bak-2026-10-14', '安装说明.txt', 'install-windows.ps1'].some(isHelperFile)).toBe(false);
  });
});

describe('shouldUpdate', () => {
  it('only moves up, and never to a version that failed here', () => {
    expect(shouldUpdate(10, 9, new Set())).toBe(true);
    expect(shouldUpdate(9, 9, new Set())).toBe(false);
    expect(shouldUpdate(8, 9, new Set())).toBe(false);
    expect(shouldUpdate(0, 9, new Set())).toBe(false);
    expect(shouldUpdate(10, 9, new Set([10]))).toBe(false);
  });
});

describe('copyHelperFiles + loadError', () => {
  const dir = (name) => mkdtempSync(path.join(tmpdir(), `launcher-${name}-`));

  it('loads a complete version, and names the problem in a half-copied one', async () => {
    const good = dir('good');
    writeFileSync(path.join(good, 'ai-file-helper.mjs'), "import { a } from './part.mjs';\nconst VERSION = 10;\nexport const b = a;\n");
    writeFileSync(path.join(good, 'part.mjs'), 'export const a = 1;\n');
    writeFileSync(path.join(good, 'ai-file-helper.test.mjs'), 'nope');
    const next = dir('next');
    expect((await copyHelperFiles(good, next)).sort()).toEqual(['ai-file-helper.mjs', 'part.mjs']);
    expect(readdirSync(next).sort()).toEqual(['ai-file-helper.mjs', 'part.mjs']);
    expect(await loadError(next)).toBe('');

    // the new main arrived but its new part.mjs export didn't yet
    writeFileSync(path.join(next, 'ai-file-helper.mjs'), "import { c } from './part.mjs';\nconst VERSION = 11;\n");
    expect(await loadError(next)).toMatch(/does not provide an export named 'c'/);
    [good, next].forEach((d) => rmSync(d, { recursive: true, force: true }));
  });
});
