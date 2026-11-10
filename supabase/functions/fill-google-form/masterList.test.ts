import { assertEquals } from 'jsr:@std/assert@1';
import { findDuplicate } from './masterList.ts';

const NOW = Date.UTC(2026, 10, 10); // 10 Nov 2026
const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
const row = (day: number, school: string, qty: number) => [serial(2026, 11, day), '', '', '', 'ADAM', school, 'SALES', qty];

Deno.test('finds a hand-filled row with the same school (case / spaces ignored) and QTY', () => {
  const rows = [row(3, 'SK DENAI ALAM', 92), row(6, 'sk puchong  jaya 2', 4)];
  assertEquals(findDuplicate(rows, 'SK PUCHONG JAYA 2', 4, NOW), { row: 3, school: 'sk puchong  jaya 2', qty: 4 });
});

Deno.test('a different QTY is not a duplicate', () => {
  assertEquals(findDuplicate([row(6, 'SK KLANG', 20)], 'SK KLANG', 21, NOW), null);
});

Deno.test('rows the website posted itself (W) are ignored', () => {
  assertEquals(findDuplicate([row(6, 'SK KLANG (W)', 20)], 'SK KLANG', 20, NOW), null);
});

Deno.test('rows older than 60 days are ignored', () => {
  const old = [serial(2026, 8, 1), '', '', '', 'ADAM', 'SK KLANG', 'SALES', 20];
  assertEquals(findDuplicate([old], 'SK KLANG', 20, NOW), null);
});

Deno.test('a hand-typed name with extra words or the long form is the same school', () => {
  assertEquals(findDuplicate([row(10, 'Sk Hulu kelang kokurikulum', 153)], 'SK HULU KELANG', 153, NOW)?.row, 2);
  assertEquals(findDuplicate([row(10, 'Sekolah Kebangsaan Taman Pelangi', 5)], 'SK TAMAN PELANGI SEMENYIH', 5, NOW)?.row, 2);
});

Deno.test('a different school with the same QTY is not a duplicate', () => {
  assertEquals(findDuplicate([row(10, 'SK HULU LANGAT', 153)], 'SK HULU KELANG', 153, NOW), null);
});
