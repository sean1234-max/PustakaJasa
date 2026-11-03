import { describe, it, expect } from 'vitest';
import { questionFor, salesmanMessage } from './salesmanMessage';

const order = { id: 'ORD-0230', sekolah: 'SK DESA CEMPAKA', sales: 'Fida' };

describe('salesmanMessage', () => {
  it('asks about a line already in TAJUK BESAR', () => {
    expect(questionFor({ rule: 'D1', sheet: 'ORDER LAIN-LAIN', find: 'PERINGKAT DAERAH', count: 10 }))
      .toBe('Sheet ORDER LAIN-LAIN: "PERINGKAT DAERAH" is already in the TAJUK BESAR. Remove this line ("-") or keep it? (10 plaques)');
  });

  it('gives both numbers when FRONT PG and the order disagree', () => {
    expect(questionFor({ rule: 'I4', find: 'W038 / B', frontQty: 2, orderQty: 1 }))
      .toBe('W038 / B: FRONT PG and the order don\'t match. FRONT PG 2, order 1. Which is correct?');
  });

  it('asks red or black for the words of a sheet', () => {
    expect(questionFor({ rule: 'B1', sheet: 'MP THP 1', wordList: ['BAHASA MELAYU', 'SAINS'] }))
      .toBe('Sheet MP THP 1: BAHASA MELAYU, SAINS — RED or BLACK? (see picture)');
  });

  it('numbers several questions under one greeting', () => {
    const msg = salesmanMessage(order, [{ rule: 'I3', find: 'PKF 265', frontQty: 10 }, { rule: 'E1', sheet: 'TOKOH', find: 'OTHER' }]);
    expect(msg.split('\n')).toEqual([
      'Hi Fida, order ORD-0230 (SK DESA CEMPAKA) — please check with the teacher:',
      '1. FRONT PG has PKF 265 × 10 but the order doesn\'t. Should it be added?',
      '2. Sheet TOKOH: Jenis Plak "OTHER" has no code / price. Please give the code and price.',
      'Thank you!',
    ]);
  });
});
