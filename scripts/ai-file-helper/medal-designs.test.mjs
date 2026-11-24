import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDAL_DESIGN_FILE, findExportJsx, readDesignExport, writeDesignScript } from './medal-designs.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'medal-designs-test-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const design = (name, extra = {}) => ({
  design: name,
  main: 'T_H_PC_L1_L2',
  thumb: `${name}-thumb.png`,
  picture: { png: `${name}-bg.png`, outline: false, box: [-1, 1, 1, -1] },
  templates: { T_H_PC_L1_L2: { anchor: [106, 106], fields: {}, art: { png: `${name}-art.png`, box: [0, 0, 1, 1] } } },
  ...extra,
});

describe('readDesignExport', () => {
  it('returns each design with every picture it names, as base64', () => {
    writeFileSync(path.join(dir, 'designs.json'), JSON.stringify({ designs: [design('DESIGN-1')] }));
    writeFileSync(path.join(dir, 'export-log.txt'), 'DESIGN 1: 1 layout group(s)\r');
    ['DESIGN-1-thumb.png', 'DESIGN-1-bg.png', 'DESIGN-1-art.png'].forEach((n) => writeFileSync(path.join(dir, n), n));

    const out = readDesignExport(dir);

    expect(out.designs.map((d) => d.design)).toEqual(['DESIGN-1']);
    expect(Object.keys(out.pictures).sort()).toEqual(['DESIGN-1-art.png', 'DESIGN-1-bg.png', 'DESIGN-1-thumb.png']);
    expect(Buffer.from(out.pictures['DESIGN-1-thumb.png'], 'base64').toString()).toBe('DESIGN-1-thumb.png');
    expect(out.log).toEqual(['DESIGN 1: 1 layout group(s)']);
  });

  it('drops a design whose picture is missing and says which', () => {
    writeFileSync(path.join(dir, 'designs.json'), JSON.stringify({ designs: [design('A'), design('B')] }));
    ['A-thumb.png', 'A-bg.png', 'A-art.png', 'B-bg.png', 'B-art.png'].forEach((n) => writeFileSync(path.join(dir, n), 'x'));

    const out = readDesignExport(dir);

    expect(out.designs.map((d) => d.design)).toEqual(['A']);
    expect(out.log).toEqual(['B: FAILED picture(s) missing: B-thumb.png']);
    expect(out.pictures['B-bg.png']).toBeUndefined();
  });

  it('reports no manifest instead of throwing', () => {
    expect(readDesignExport(dir)).toEqual({ designs: [], log: ['Illustrator wrote no designs.json'], pictures: {} });
  });
});

describe('writeDesignScript', () => {
  it('copies E CUT 0 into the work folder and points the export at the copy', () => {
    const aiDir = path.join(dir, 'ai');
    mkdirSync(aiDir);
    writeFileSync(path.join(aiDir, MEDAL_DESIGN_FILE), 'ai');
    const jsx = path.join(dir, 'export.jsx');
    writeFileSync(jsx, '// export');
    const work = path.join(dir, 'work');

    const script = readFileSync(writeDesignScript(aiDir, work, jsx), 'utf8');

    expect(readFileSync(path.join(work, MEDAL_DESIGN_FILE), 'utf8')).toBe('ai');
    expect(script).toContain(`var PRESET_DESIGN_FILE = ${JSON.stringify(path.join(work, MEDAL_DESIGN_FILE))};`);
    expect(script).toContain(`var PRESET_OUT = ${JSON.stringify(path.join(work, 'out'))};`);
    expect(script.endsWith('// export')).toBe(true);
    expect(existsSync(path.join(work, 'out'))).toBe(true);
  });

  it('says so when the folder has no E CUT 0', () => {
    expect(() => writeDesignScript(dir, path.join(dir, 'work'), 'x.jsx')).toThrow(MEDAL_DESIGN_FILE);
  });
});

describe('findExportJsx', () => {
  it('finds the repo copy from scripts/ai-file-helper', () => {
    expect(findExportJsx(path.dirname(fileURLToPath(import.meta.url)))).toMatch(/plak-preview[/\\]export-plak-preview\.jsx$/);
  });

  it('asks for a reinstall when it is missing', () => {
    expect(() => findExportJsx(dir)).toThrow(/installer/);
  });
});
