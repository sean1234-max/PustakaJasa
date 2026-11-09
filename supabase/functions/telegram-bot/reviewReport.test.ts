import { describe, it, expect } from 'vitest';
import { teacherFiles, reportHtml, reviewQuestions, answerLabel, summaryHtml } from './reviewReport.ts';

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

describe('the review questions', () => {
  const diffs = [
    { kind: 'wording', where: 'TOKOH SUKAN', inFile: 'TOKOH SUKAN LELAKI', inOrder: 'TOKOH SUKAN' },
    { kind: 'missing_in_order', where: 'PKC 263', inFile: 'ANUGERAH KHAS', inOrder: '' },
  ];
  const red = [{ rule: 'R1', level: 'fix', text: 'x', sheet: 'UMUM', count: 3, find: 'JOHAN' }];

  it('one question each, numbered, with buttons — Chinese', () => {
    const qs = reviewQuestions(diffs, red, 'zh');
    expect(qs.map((q) => q.n)).toEqual([1, 2, 3]);
    expect(qs[0].html).toContain('老师');
    expect(qs[0].options.map((o) => o.key)).toEqual(['file', 'order', 'other']);
    expect(qs[0].options[0].label).toBe('📄 老师的对');
    expect(qs[1].options.map((o) => o.key)).toEqual(['add', 'skip', 'other']);
    expect(qs[2].html).toContain('这个要红色吗？');
    expect(qs[2].options.map((o) => o.label)).toEqual(['🔴 红色', '⚫ 黑色']);
  });

  it('English for Fida / Nazrin / Wendy', () => {
    const qs = reviewQuestions(diffs, red, 'en');
    expect(qs[0].options[0].label).toBe('📄 Teacher is right');
    expect(qs[2].html).toContain('Should this be RED?');
  });

  it('the headline is short; the list is folded', () => {
    const qs = reviewQuestions(diffs, red, 'zh');
    const html = reportHtml({ id: 'ORD-0300', sekolah: 'SK A & B' }, qs, ['kk.pdf'], '<a href="tg://user?id=1">ZY</a>', 'zh');
    const [first, second] = html.split('\n');
    expect(first).toContain('ORD-0300');
    expect(first).toContain('SK A &amp; B');
    expect(second).toContain('有 3 个要和老师确认');
    expect(html).toContain('<blockquote expandable>');
  });

  it('answers read back, and the summary lists them', () => {
    const qs = reviewQuestions(diffs, red, 'zh');
    expect(answerLabel(qs[0], { pick: 'file' }, 'zh')).toBe('📄 老师的对');
    expect(answerLabel(qs[0], { pick: 'other', text: 'TOKOH SUKAN (L)' }, 'zh')).toBe('✏️ 都不对: 「TOKOH SUKAN (L)」');
    const sum = summaryHtml({ id: 'ORD-0300', sekolah: 'SK A' }, qs, { 1: { pick: 'file' }, 2: { pick: 'skip' }, 3: { pick: 'red' } }, 'Keith', 'zh');
    expect(sum).toContain('Keith 已全部回答');
    expect(sum).toContain('3. 🔴 红色');
  });
});
