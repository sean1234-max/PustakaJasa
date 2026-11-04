import { describe, it, expect } from 'vitest';
import { applyPlan, dayOf } from './botRequests';

describe('applyPlan', () => {
  it('turns the changes into a Shipment Date and order details', () => {
    const plan = applyPlan([
      { field: 'shipmentDate', from: '2026-11-17', to: '2026-11-19' },
      { field: 'functionDate', from: '2026-11-24', to: '2026-11-26' },
      { field: 'remark', from: 'OLD', to: 'OLD\nNEW' },
    ]);
    expect(plan.shipmentDate).toEqual(new Date(2026, 10, 19));
    expect(plan.details).toEqual({ functionDate: new Date(2026, 10, 26), remark: 'OLD\nNEW' });
  });

  it('leaves out what was not asked', () => {
    expect(applyPlan([{ field: 'remark', from: '', to: 'NOTE' }])).toEqual({ shipmentDate: null, details: { remark: 'NOTE' } });
  });

  it('reads only a real YYYY-MM-DD day', () => {
    expect(dayOf('19/11')).toBeNull();
  });
});
