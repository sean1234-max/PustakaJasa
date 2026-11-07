import { describe, it, expect } from 'vitest';
import { teacherFiles, reportHtml } from './reviewReport.ts';

describe('teacherFiles', () => {
  it('the kertas kerja first, else the order file the teacher filled', () => {
    const kk = [{ path: 'a/kk-1.pdf', name: 'kertas kerja.pdf' }];
    const xl = [{ path: 'a/1.xlsx', name: 'FORM.xlsx' }];
    expect(teacherFiles({ kertas_kerja_files: kk, import_files: xl, import_file_path: 'a/1.xlsx', import_file_name: 'FORM.xlsx' })).toBe(kk);
    expect(teacherFiles({ kertas_kerja_files: [], import_files: xl, import_file_path: null, import_file_name: null })).toBe(xl);
    expect(teacherFiles({ kertas_kerja_files: null, import_files: null, import_file_path: 'a/old.xlsx', import_file_name: null })).toEqual([{ path: 'a/old.xlsx', name: 'order.xlsx' }]);
    expect(teacherFiles({ kertas_kerja_files: null, import_files: [], import_file_path: null, import_file_name: null })).toEqual([]);
  });
});

describe('reportHtml', () => {
  it('numbers every question, groups them, mentions the salesman, asks for a reply', () => {
    const html = reportHtml({ id: 'ORD-0300', sekolah: 'SK A & B' }, ['kk.pdf'], 'Mostly matches.', [
      { kind: 'quantity', where: 'PKC 263', inFile: '50', inOrder: '45' },
      { kind: 'wording', where: 'TOKOH SUKAN', inFile: 'TOKOH SUKAN LELAKI', inOrder: 'TOKOH SUKAN' },
    ], [{ rule: 'R1', level: 'fix', text: '"JOHAN" should be the red line', sheet: 'UMUM', count: 3 }], '<a href="tg://user?id=1">ZY</a>');
    expect(html).toContain('ORD-0300');
    expect(html).toContain('SK A &amp; B');
    expect(html.indexOf('Wording')).toBeLessThan(html.indexOf('Quantity'));
    expect(html).toMatch(/1\. TOKOH SUKAN — kertas kerja: "TOKOH SUKAN LELAKI" · order: "TOKOH SUKAN"/);
    expect(html).toMatch(/2\. PKC 263 — kertas kerja: "50" · order: "45"/);
    expect(html).toMatch(/3\. "JOHAN" should be the red line \(3 plaques\)/);
    expect(html).toContain('<a href="tg://user?id=1">ZY</a> please check with the teacher and <b>reply to this message</b>');
  });
});
