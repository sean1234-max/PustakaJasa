import { shipmentDayOptions } from './shipDate.ts';

// no jsr import: a plain check, so this runs without the network
const same = (got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const TODAY = '2026-11-30';

Deno.test('a day number alone is the next one: this month, else next month', () => {
  same(shipmentDayOptions('28', TODAY), ['2026-12-28']);
  same(shipmentDayOptions('30', TODAY), ['2026-11-30']);
  same(shipmentDayOptions('28hb', '2026-11-20'), ['2026-11-28']);
  same(shipmentDayOptions('31号', TODAY), ['2026-12-31']);
});

Deno.test('today / tomorrow in English, Malay and Chinese', () => {
  same(shipmentDayOptions('today', TODAY), ['2026-11-30']);
  same(shipmentDayOptions('Hari ini', TODAY), ['2026-11-30']);
  same(shipmentDayOptions('明天', TODAY), ['2026-12-01']);
  same(shipmentDayOptions('esok', TODAY), ['2026-12-01']);
});

Deno.test('day/month or month/day: the nearer day first, the other as the second guess', () => {
  same(shipmentDayOptions('2/12/2026', TODAY), ['2026-12-02']); // 12 Feb 2026 has passed
  same(shipmentDayOptions('12/2/2026', TODAY), ['2026-12-02']);
  same(shipmentDayOptions('2/12', TODAY), ['2026-12-02', '2027-02-12']);
  same(shipmentDayOptions('12/2', TODAY), ['2026-12-02', '2027-02-12']);
  same(shipmentDayOptions('5/12/26', TODAY), ['2026-12-05']);
  same(shipmentDayOptions('13/12/2026', TODAY), ['2026-12-13']); // 13 can't be a month
});

Deno.test('month names and Chinese dates', () => {
  same(shipmentDayOptions('2 Dec', TODAY), ['2026-12-02']);
  same(shipmentDayOptions('15 Disember 2026', TODAY), ['2026-12-15']);
  same(shipmentDayOptions('Dec 3', TODAY), ['2026-12-03']);
  same(shipmentDayOptions('12月2号', TODAY), ['2026-12-02']);
  same(shipmentDayOptions('1月5日', TODAY), ['2027-01-05']);
});

Deno.test('past days, nonsense and impossible dates give nothing', () => {
  same(shipmentDayOptions('20/11/2026', TODAY), []);
  same(shipmentDayOptions('31/2/2027', TODAY), []);
  same(shipmentDayOptions('next week', TODAY), []);
  same(shipmentDayOptions('', TODAY), []);
});
