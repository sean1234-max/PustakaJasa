import { describe, it, expect } from 'vitest';
import { saleOption, formQty, formBody, formTookIt, dueDateProblem, readQty, ENTRY, formPreviewHtml } from './googleForm.ts';

describe('saleOption', () => {
  it('matches the website name to the form option, case and spaces ignored', () => {
    expect(saleOption('Adam')).toBe('ADAM');
    expect(saleOption('fida ')).toBe('FIDA');
    expect(saleOption('Kent E')).toBe('KENT E');
    expect(saleOption('KentE')).toBe('KENT E');
  });
  it('takes the one option starting with his first name', () => {
    expect(saleOption('Kent')).toBe('KENT E');
    expect(saleOption('Wendy Tan')).toBe('WENDY');
  });
  it('a name not in the form (the test account) is not filled', () => {
    expect(saleOption('LIMZHIYI')).toBeNull();
    expect(saleOption('Lim Zhi Yi')).toBeNull();
    expect(saleOption('')).toBeNull();
  });
});

describe('formQty', () => {
  it('counts every plaque, selempang left out', () => {
    expect(formQty([{ jenisPlak: 'PKC 263', qty: '10' }, { jenisPlak: 'SELEMPANG', qty: 5 }, { jenisPlak: 'PK 262 / A', qty: 3 }])).toBe(13);
  });
});

describe('formBody', () => {
  it('sends every question with its entry id, dates as YYYY-MM-DD', () => {
    const b = formBody({ orderDate: '2026-11-09', dueDate: '2026-11-20', funcDate: '2026-11-25', sale: 'ADAM', school: 'SK PUTRAJAYA PRESINT 14(1)', remark: 'SALES', qty: 13 });
    expect(b.get(ENTRY.orderDate)).toBe('2026-11-09');
    expect(b.get(ENTRY.dueDate)).toBe('2026-11-20');
    expect(b.get(ENTRY.funcDate)).toBe('2026-11-25');
    expect(b.get(ENTRY.sale)).toBe('ADAM');
    expect(b.get(ENTRY.school)).toBe('SK PUTRAJAYA PRESINT 14(1)');
    expect(b.get(ENTRY.remark)).toBe('SALES');
    expect(b.get(ENTRY.qty)).toBe('13');
  });
});

describe('formTookIt', () => {
  it('the recorded page is taken; the form sent back or an error is not', () => {
    expect(formTookIt(200, '<div>Your response has been recorded.</div>')).toBe(true);
    expect(formTookIt(200, '<html>Thanks</html>')).toBe(true);
    expect(formTookIt(200, '<script>var FB_PUBLIC_LOAD_DATA_ = []</script>')).toBe(false);
    expect(formTookIt(400, '')).toBe(false);
  });
});

describe('dueDateProblem / readQty', () => {
  it('a DUE DATE not before today and before the Function Date', () => {
    expect(dueDateProblem('2026-11-20', '2026-11-09', '2026-11-25', 'en')).toBeNull();
    expect(dueDateProblem('2026-11-08', '2026-11-09', '2026-11-25', 'en')).toMatch(/passed/);
    expect(dueDateProblem('2026-11-25', '2026-11-09', '2026-11-25', 'zh')).toMatch(/Function Date/);
  });
  it('QTY is a whole number above 0', () => {
    expect(readQty(' 24 ')).toBe(24);
    expect(readQty('0')).toBeNull();
    expect(readQty('12.5')).toBeNull();
    expect(readQty('abc')).toBeNull();
  });
  it('the preview says when SALE will not be filled', () => {
    expect(formPreviewHtml({ orderDate: '2026-11-09', dueDate: '2026-11-20', funcDate: '2026-11-25', sale: null, school: 'X', remark: 'SALES', qty: 1 }, 'zh')).toMatch(/不会填/);
  });
});
