import { describe, it, expect } from 'vitest';
import { nextDetailStep, readFieldAnswer, orderRow, showDay, type Session } from './orderFlow.ts';
import { askedDay } from './order.ts';

const TODAY = '2026-11-07';
const base = (over: Partial<Session> = {}, details = {}): Session => ({
  id: 's', school: { id: 'school-1', sekolah: 'SK TAMAN MUDA', schoolLanguage: 'SK' },
  excel: { fileId: 'f', name: 'FORM.xlsx' }, kertas_kerja: [], kertas_asked: false, answers: {}, subs: [], ok_words: [],
  details: { sekolah: 'SK TAMAN MUDA', picName: 'PN AISYAH', phone: '012-3456789', ketuaPanitia: 'EN RAHMAN', terms: 'L/O', shipmentDate: '2026-11-18', functionDate: '2026-11-20', schoolType: 'SK', ...details },
  ...over,
});

describe('nextDetailStep', () => {
  it('asks in Function Details order, then the Excel, then the kertas kerja', () => {
    expect(nextDetailStep(base({ school: null }), TODAY)).toEqual({ kind: 'school' });
    expect(nextDetailStep(base({}, { picName: '' }), TODAY)).toEqual({ kind: 'field', field: 'picName' });
    expect(nextDetailStep(base({}, { phone: 'abc' }), TODAY)?.kind).toBe('field');
    expect(nextDetailStep(base({}, { terms: '' }), TODAY)).toEqual({ kind: 'terms' });
    expect(nextDetailStep(base({}, { schoolType: '' }), TODAY)).toEqual({ kind: 'schoolType' });
    expect(nextDetailStep(base({ excel: null }), TODAY)).toEqual({ kind: 'excel' });
    expect(nextDetailStep(base(), TODAY)).toEqual({ kind: 'kertas' });
    expect(nextDetailStep(base({ kertas_asked: true }), TODAY)).toBeNull();
    expect(nextDetailStep(base({ kertas_kerja: [{ fileId: 'k', name: 'kk.pdf' }] }), TODAY)).toBeNull();
  });
  it('the Function Date rule and a Shipment Date after it', () => {
    const soon = nextDetailStep(base({}, { functionDate: '2026-11-09' }), TODAY);
    expect(soon).toMatchObject({ field: 'functionDate' });
    expect((soon as { why: string }).why).toContain('10 Nov 2026');
    expect(nextDetailStep(base({ kertas_asked: true }, { functionDate: '2026-11-10', shipmentDate: '' }), TODAY)).toBeNull();
    expect(nextDetailStep(base({}, { shipmentDate: '2026-11-25' }), TODAY)).toMatchObject({ field: 'shipmentDate' });
  });
  it('a school with its own logo needs the logo and its remark', () => {
    expect(nextDetailStep(base({}, { schoolType: 'NOT_SK' }), TODAY)).toEqual({ kind: 'logo' });
    expect(nextDetailStep(base({}, { schoolType: 'NOT_SK', logoUrl: 'u' }), TODAY)).toEqual({ kind: 'field', field: 'logoRemark' });
  });
});

describe('readFieldAnswer', () => {
  it('phone, dates, text', () => {
    expect(readFieldAnswer('phone', '012 345 6789', TODAY, askedDay)).toEqual({ value: '0123456789' });
    expect(readFieldAnswer('phone', 'abc', TODAY, askedDay)).toHaveProperty('error');
    expect(readFieldAnswer('functionDate', '23/11', TODAY, askedDay)).toEqual({ value: '2026-11-23' });
    expect(readFieldAnswer('shipmentDate', 'none', TODAY, askedDay)).toEqual({ value: '' });
    expect(readFieldAnswer('picName', 'pn siti', TODAY, askedDay)).toEqual({ value: 'PN SITI' });
  });
});

describe('orderRow', () => {
  it('what the website\'s New Order would insert, made by the salesman for the school', () => {
    const row = orderRow({
      s: base(), salesman: { id: 'sm-1', name: 'ZHI YI' },
      items: [{ jenisPlak: 'PKC 263', qty: '3', harga: 36, categoryKey: 'TOKOH_SHEET' }], total: 36, remark: '',
      datePlaced: showDay(TODAY), excelFile: { path: 'sm-1/x.xlsx', name: 'FORM.xlsx', hash: 'h' }, kertasKerja: [],
      snapshot: { category: 'TOKOH_SHEET' }, duplicateCheck: null,
    });
    expect(row).toMatchObject({
      status: 'Reviewing Order', date_placed: '07 Nov 2026', created_by: 'school-1', created_by_salesman: 'sm-1', salesman_id: 'sm-1',
      sales: 'ZHI YI', function_date: '2026-11-20T00:00:00+08:00', shipment_date: '2026-11-18T00:00:00+08:00',
      import_files: [{ path: 'sm-1/x.xlsx', name: 'FORM.xlsx', hash: 'h' }], school_type: 'SK', logo_data_url: null,
    });
    expect(row.items[0].importFile).toBe('sm-1/x.xlsx');
    expect(row.snapshot).toMatchObject({ placedBy: 'ZHI YI' });
  });
});
