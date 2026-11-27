import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KertasKerjaIssue from './KertasKerjaIssue';

const plaque = { header: 'MAJLIS ANUGERAH 2026', red: 'TERBAIK PBD MATAPELAJARAN', black: ['TAHAP 2'] };
const html = (issue) => renderToStaticMarkup(createElement(KertasKerjaIssue, { issue, onFix: () => {}, onKeep: () => {} }));

describe('KertasKerjaIssue', () => {
  it('shows the uploaded file beside the plaque, the word marked in both', () => {
    const out = html({ kind: 'extra', where: 'plaque', word: 'PELJARAN', source: 'file', plaque: { ...plaque, red: 'MATA PELJARAN' }, kkText: 'TERBAIK PBD MATAPELAJARAN', count: 30 });
    expect(out).toContain('Is <strong>PELJARAN</strong> right?');
    expect(out).toContain('not in the uploaded file');
    expect(out).toContain('Uploaded file');
    expect(out).toContain('<mark');
    expect(out).toContain('30 plaques');
  });

  it('asks joined or apart, with both answers as buttons', () => {
    const out = html({ kind: 'join', where: 'plaque', word: 'MATAPELAJARAN', kk: 'MATA PELAJARAN', plaque, targets: [{ lineKey: 'x' }], count: 1 });
    expect(out).toContain('<strong>MATA PELAJARAN</strong> or <strong>MATAPELAJARAN</strong>?');
    expect(out).toMatch(/<button[^>]*>MATA PELAJARAN<\/button><button[^>]*>MATAPELAJARAN<\/button>/);
  });

  it('offers the missing level for the later row', () => {
    const out = html({ kind: 'same', where: 'plaque', word: 'X', plaque, rowNos: [6, 8], groups: [{ rowNos: [6, 8], text: 'X' }], count: 2,
      level: { from: 'TAHAP 2', to: 'TAHAP 1', missing: ['TAHAP 1'], rowId: 8 }, targets: [{ rowsKey: 'UMUM::0', rowId: 8, field: 'l2' }] });
    expect(out).toContain('<strong>TAHAP 2</strong> twice — should one be <strong>TAHAP 1</strong>?');
    expect(out).toContain('Rows 6 and 8.');
    expect(out).toContain('Row 8 → TAHAP 1');
    expect(out).toContain('No, both TAHAP 2');
  });

  it('says to edit when a spelling fix has nowhere to go', () => {
    const out = html({ kind: 'typo', where: 'plaque', word: 'MUHAMMAD', kk: 'MUHAMAD', plaque, kkText: 'MUHAMAD', targets: [], count: 1 });
    expect(out).toContain('Keep MUHAMMAD');
    expect(out).toContain('go Back to editing');
    expect(out).not.toMatch(/<button[^>]*>MUHAMAD<\/button>/);
  });

  it('lists a sheet\'s repeated plaques in one question', () => {
    const groups = [{ rowNos: [1, 2, 3], text: 'ANUGERAH / 1 LILY' }, { rowNos: [4, 5, 6], text: 'ANUGERAH / 1 TULIP' }];
    const out = html({ kind: 'same', where: 'plaque', word: 'X_AND_1_MORE', plaque, rowNos: [1, 2, 3], groups, count: 6, level: null, targets: [] });
    expect(out).toContain('These plaques repeat — is that right?');
    expect(out).toContain('Rows 4, 5 and 6');
    expect(out).toContain('Yes, keep them');
  });
});
