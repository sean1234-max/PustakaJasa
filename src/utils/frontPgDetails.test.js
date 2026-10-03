import { describe, it, expect } from 'vitest';
import { frontPgToFunctionDetails } from './frontPgDetails';

const today = new Date(2026, 9, 3);
const salesmen = [{ id: 's1', name: 'Sean' }, { id: 's2', name: 'Fida' }];
const fp = { sales: 'SEAN', picName: 'PN AMINAH', phone: '012-3456789', functionDate: new Date(2026, 9, 22), remark: 'HANTAR AWAL' };

describe('frontPgToFunctionDetails — FRONT PG fills Function Details or asks', () => {
  it('fills every blank field', () => {
    const res = frontPgToFunctionDetails(fp, { assignedSalesmen: salesmen }, today);
    expect(res.patch).toEqual({
      picName: 'PN AMINAH', phone: '012-3456789',
      selectedSalesmanId: 's1', sales: 'Sean', funcSelected: new Date(2026, 9, 22),
    });
    expect(res.questions).toEqual([]);
    expect(res.remark).toBe('HANTAR AWAL');
  });

  it('asks when a field already says something else; leaves a match alone', () => {
    const current = {
      picName: 'CIKGU LIM', phone: '012-3456789',
      selectedSalesmanId: 's2', sales: 'Fida', assignedSalesmen: salesmen, funcSelected: new Date(2026, 9, 22),
    };
    const res = frontPgToFunctionDetails(fp, current, today);
    expect(res.patch).toEqual({});
    expect(res.questions.map((q) => [q.id, q.excel.patch, q.current.patch])).toEqual([
      ['picName', { picName: 'PN AMINAH' }, { picName: 'CIKGU LIM' }],
      ['sales', { selectedSalesmanId: 's1', sales: 'Sean' }, { selectedSalesmanId: 's2', sales: 'Fida' }],
    ]);
  });

  it('an unknown salesman or a too-soon Function Date is only a note; a remark already there is not repeated', () => {
    const res = frontPgToFunctionDetails(
      { ...fp, sales: 'NOBODY', functionDate: new Date(2026, 9, 4) },
      { assignedSalesmen: salesmen, remark: 'xx HANTAR AWAL xx' },
      today,
    );
    expect(res.notes).toHaveLength(2);
    expect(res.patch.funcSelected).toBeUndefined();
    expect(res.patch.selectedSalesmanId).toBeUndefined();
    expect(res.remark).toBe('');
  });
});
