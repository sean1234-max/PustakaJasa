import { readLookup, orderStatusHtml, stageText, type FoundOrder } from './orderStatus.ts';

const same = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const has = (text: string, part: string) => {
  if (!text.includes(part)) throw new Error(`"${part}" not in:\n${text}`);
};

Deno.test('an order number in any spelling', () => {
  same(readLookup('ORD-0553'), { orderId: 'ORD-0553' });
  same(readLookup('ord 553'), { orderId: 'ORD-0553' });
  same(readLookup('Ord0091'), { orderId: 'ORD-0091' });
});

Deno.test('asking to check, and an invoice number in any spelling', () => {
  same(readLookup('查单'), { ask: true });
  same(readLookup('Check'), { ask: true });
  same(readLookup('DWI-26111377'), { invoice: '26111377' });
  same(readLookup('dwi 26111377'), { invoice: '26111377' });
  same(readLookup('26111377'), { invoice: '26111377' });
  same(readLookup('PJI-26100177'), { invoice: '26100177' });
  same(readLookup('DWI_26101021'), { invoice: '26101021' });
});

Deno.test('a school name gives its words; sentences and Chinese do not', () => {
  same(readLookup('selayang baru'), { words: ['SELAYANG', 'BARU'] });
  same(readLookup('SJKC Selayang Baru'), { words: ['SJKC', 'SELAYANG', 'BARU'] });
  same(readLookup('帮我填form'), { words: ['FORM'] });
  same(readLookup('我想问一下这个单什么时候可以出货因为老师一直在问我'), null);
  same(readLookup('can you please tell me when the order for the school will ship'), null);
});

const order = (over: Partial<FoundOrder>): FoundOrder => ({
  id: 'ORD-0553', sekolah: 'SJKC SELAYANG BARU', status: 'In Production', reviewed_at: '2026-11-01', typed_at: null,
  shipment_date: '2026-12-02', function_date: '2026-12-05T00:00:00+08:00', invoice_id: 'DWI-26111377', urgent: true,
  total_amount: 1234.5, parent_order_id: null, ...over,
});
const NOW = Date.parse('2026-11-30T04:00:00Z');

Deno.test('the stage in the salesman\'s words', () => {
  has(stageText(order({ status: 'Reviewing Order', reviewed_at: null }), 'zh'), 'Production 审核中');
  has(stageText(order({ status: 'Reviewing Order' }), 'zh'), '你 approve');
  has(stageText(order({ status: 'Salesman Approved' }), 'en'), 'waiting for the invoice');
  has(stageText(order({}), 'zh'), '等打字');
  has(stageText(order({ typed_at: '2026-11-29' }), 'zh'), '已打好字');
});

Deno.test('dates, invoice and a passed Shipment Date', () => {
  const html = orderStatusHtml(order({}), 'zh', 'https://x/o', NOW);
  has(html, '<b>02/12/2026</b> ⚠️');
  has(html, 'Function: 05/12/2026');
  has(html, '<b>DWI-26111377</b>');
  has(html, 'RM 1234.50');
  has(orderStatusHtml(order({ shipment_date: '2026-11-20' }), 'zh', 'https://x/o', NOW), '❗已过');
  has(orderStatusHtml(order({ shipment_date: null, invoice_id: null }), 'en', 'https://x/o', NOW), 'not set');
});
