import { describe, it, expect } from 'vitest';
import { isAllowedRequest, sanitizeFolderName, PORT } from './ai-file-helper.mjs';

describe('isAllowedRequest', () => {
  const host = `127.0.0.1:${PORT}`;

  it('accepts the School Portal on loopback', () => {
    expect(isAllowedRequest({ host, origin: 'https://pustaka-jasa.vercel.app' })).toBe(true);
    expect(isAllowedRequest({ host: `localhost:${PORT}`, origin: 'http://localhost:5173' })).toBe(true);
  });

  it('refuses any other website', () => {
    expect(isAllowedRequest({ host, origin: 'https://evil.example' })).toBe(false);
  });

  it('refuses a request with no Origin (e.g. a DNS-rebound same-origin page)', () => {
    expect(isAllowedRequest({ host })).toBe(false);
  });

  it('refuses a request whose Host is not loopback (DNS rebinding)', () => {
    expect(isAllowedRequest({ host: `evil.example:${PORT}`, origin: 'https://pustaka-jasa.vercel.app' })).toBe(false);
  });
});

describe('sanitizeFolderName', () => {
  it('matches SEAN.jsx\'s own output-folder naming', () => {
    expect(sanitizeFolderName('(DWI-26090782) - SK TAMAN SERI PAGI')).toBe('(DWI-26090782) - SK TAMAN SERI PAGI');
    expect(sanitizeFolderName('a/b:c*')).toBe('a_b_c_');
    expect(sanitizeFolderName('..')).toBe('UNNAMED');
  });
});

describe('crystals (POST /crystal)', async () => {
  const { checkCrystalJob, crystalOutDir, isOurOriginalUrl, cleanName } = await import('./crystal-job.mjs');
  const { readFileSync } = await import('node:fs');
  const url = 'https://dlzkdkxbnbhgldsvbybt.supabase.co/storage/v1/object/public/crystal/library/orig-mv7gxpvg-fio9at.pdf';
  const row = { row: 1, file: 'R-100.ai', original: 'library/orig-mv7gxpvg-fio9at.pdf', originalUrl: url, name: 'R-100 - TOKOH MURID', qty: 5 };

  it('keeps its Illustrator script identical to the website\'s (public/crystal/js/illustrator.js)', () => {
    const here = readFileSync(new URL('./crystal-illustrator.mjs', import.meta.url), 'utf8');
    const site = readFileSync(new URL('../../public/crystal/js/illustrator.js', import.meta.url), 'utf8');
    expect(here).toBe(site);
  });

  it('only downloads originals from our own Supabase crystal bucket', () => {
    expect(isOurOriginalUrl(url)).toBe(true);
    expect(isOurOriginalUrl(url.replace('dlzkdkxbnbhgldsvbybt', 'ddjgmuvgxywzvhzhrbta'))).toBe(false);
    expect(isOurOriginalUrl('https://evil.example/orig-x.pdf')).toBe(false);
  });

  it('accepts a proper job, keeps a valid platform and cleans the label', () => {
    const c = checkCrystalJob({ job: { rows: [row], platform: { w: 6048, h: 1728, left: 700, right: 276, top: 72, bottom: 184, gapX: 90, gapY: 92 }, label: 'SK TEST (ORD-9008)' } });
    expect(c.rows).toHaveLength(1);
    expect(c.platform.w).toBe(6048);
    expect(c.label).toBe('SK TEST (ORD-9008)');
  });

  it('keeps a crystal\'s own sheet (DTF) when it is numbers and a short name, drops it otherwise', () => {
    const dtf = { name: 'DFT', w: 822, h: 1417, left: 14, right: 14, top: 14, bottom: 14, gapX: 8.5, gapY: 8.5 };
    const c = checkCrystalJob({ job: { rows: [{ ...row, platform: dtf }, { ...row, platform: { ...dtf, w: 'x' } }, { ...row, platform: { ...dtf, name: '<script>' } }] } });
    expect(c.rows[0].platform).toEqual(dtf);
    expect(c.rows[1].platform).toBeUndefined();
    expect(c.rows[2].platform.name).toBeUndefined();
  });

  it('takes the plaques\' folder name (Generate AI File), never a path', () => {
    expect(checkCrystalJob({ job: { rows: [row], folder: '(DWI-26100287) - SK TEST' } }).folder).toBe('(DWI-26100287) - SK TEST');
    expect(checkCrystalJob({ job: { rows: [row], folder: '../../etc' } }).folder).not.toMatch(/[\\/]/);
    expect(checkCrystalJob({ job: { rows: [row] } }).folder).toBe('');
  });

  it('refuses empty jobs, bad template names and originals from elsewhere', () => {
    expect(() => checkCrystalJob({ job: { rows: [] } })).toThrow('Nothing to make');
    expect(() => checkCrystalJob({ job: { rows: [{ ...row, file: '../x.ai' }] } })).toThrow('Bad template name');
    expect(() => checkCrystalJob({ job: { rows: [{ ...row, originalUrl: 'https://evil.example/a.pdf' }] } })).toThrow('import it again');
  });

  it('names the output folder by Malaysia time and the order', () => {
    const dir = crystalOutDir('/NAS/OUTPUT', 'SK TEST (ORD-9008)', new Date('2026-10-14T06:40:17Z'));
    expect(dir.replace(/\\/g, '/')).toBe('/NAS/OUTPUT/CRYSTAL/2026-10-14 14-40-17 - SK TEST (ORD-9008)');
    expect(cleanName('a/b:c*  d.', 80)).toBe('a b c d');
  });
});

describe('copy to the school folder (Sean, 2026-10-21)', async () => {
  const { findSchoolFolder, copyToSchool, schoolKey } = await import('./school-folder.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const names = ['SK KUANG', 'SJKC KUANG', 'SK PUTRAJAYA PRESINT 16 (2)', 'SK PUTRAJAYA PRESINT 16 (1)', 'SK TAMAN SERI PAGI', 'SK SEKSYEN 7'];

  it('keeps schoolKey identical to Crystal Studio\'s (public/crystal/js/logos.js)', () => {
    const fn = (src) => src.slice(src.indexOf('export function schoolKey'), src.indexOf('\nconst WORDS'));
    const words = (src) => src.match(/^const WORDS = .*$/m)[0];
    const here = fs.readFileSync(new URL('./school-folder.mjs', import.meta.url), 'utf8');
    const site = fs.readFileSync(new URL('../../public/crystal/js/logos.js', import.meta.url), 'utf8');
    expect(fn(here)).toBe(fn(site));
    expect(words(here)).toBe(words(site));
  });

  it('finds the one folder with the same name, written either way', () => {
    expect(findSchoolFolder('/r', 'SK PUTRAJAYA PRESINT 16(2)', names).name).toBe('SK PUTRAJAYA PRESINT 16 (2)');
    expect(findSchoolFolder('/r', 'SK TMN SERI PAGI', names).name).toBe('SK TAMAN SERI PAGI');
    expect(findSchoolFolder('/r', 'SJK (C) KUANG', names).name).toBe('SJKC KUANG');
  });

  it('copies nothing when no folder, or more than one, has that name', () => {
    expect(findSchoolFolder('/r', 'SK SEKSYEN 7 B.B.BANGI', names).error).toMatch(/no school folder/);
    expect(findSchoolFolder('/r', 'SJK (C) KUANG', [...names, 'SJK(C) KUANG']).error).toMatch(/more than one/);
    // …unless the website names one of them exactly (src/data/schoolFolders.js)
    expect(findSchoolFolder('/r', 'SJK(C) KUANG', [...names, 'SJK(C) KUANG']).name).toBe('SJK(C) KUANG');
    expect(schoolKey('SK KUANG')).not.toBe(schoolKey('SJKC KUANG'));
  });

  it('copies the .ai files into <school>/<output folder name>, leaving OUTPUT as it is', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-school-'));
    const out = path.join(tmp, 'OUTPUT', '(DWI-1) - SK KUANG');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'a.ai'), 'x');
    fs.writeFileSync(path.join(out, 'log.txt'), 'x');
    fs.mkdirSync(path.join(tmp, 'SCHOOLS', 'SK KUANG'), { recursive: true });
    const msg = copyToSchool(out, 'SK KUANG', path.join(tmp, 'SCHOOLS'));
    expect(msg).toMatch(/Copied 1 file/);
    expect(fs.readdirSync(path.join(tmp, 'SCHOOLS', 'SK KUANG', '(DWI-1) - SK KUANG'))).toEqual(['a.ai']);
    expect(fs.existsSync(path.join(out, 'a.ai'))).toBe(true);
    expect(copyToSchool(out, 'SK NOWHERE', path.join(tmp, 'SCHOOLS'))).toMatch(/Not copied/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
