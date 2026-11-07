// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { fillOrderTemplate } from './templateExport';
import { readOrderForm, substitute, questionId } from './botOrder';

const catalog = [
  { id: 'a', code: 'PKC 263', price: 12 },
  { id: 'b', code: 'PKF 266', price: 10 },
  { id: 'c', code: 'W038', price: 30, children: [{ id: 'c1', code: 'B', price: 0 }] },
];
const salesman = { id: 'sm-1', name: 'ZHI YI' };
const form = async (plaques) => (await fillOrderTemplate(fs.readFileSync('public/templates/FORM-ANUGERAH.xlsx'), { plaques }, { DOMParser, XMLSerializer })).buffer;
const read = (buffer, extra = {}) => readOrderForm(buffer, { plakCatalog: catalog, schoolLanguage: 'SK', salesman, details: { picName: 'PN AISYAH', phone: '012-3456789' }, ...extra });

describe('readOrderForm', () => {
  it('a filled FORM ANUGERAH becomes the same items the website would add to cart', async () => {
    const buf = await form([
      { heading: 'Hari Anugerah 2026', award: 'TOKOH AKADEMIK', line: 'LELAKI', eline2: 'TAHAP 1', code: 'W038 / B', qty: 1 },
      { heading: 'Hari Anugerah 2026', award: 'TOKOH SUKAN', line: 'PEREMPUAN', eline2: 'TAHAP 2', code: 'W038 / B', qty: 1 },
    ]);
    const r = read(buf);
    expect(r.error).toBeUndefined();
    expect(r.problems).toEqual([]);
    expect(r.questions.filter((q) => q.kind === 'plak')).toEqual([]);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.reduce((s, it) => s + Number(it.qty), 0)).toBe(2);
    expect(r.items.every((it) => it.jenisPlak === 'W038 / B')).toBe(true);
    expect(r.total).toBe(60);
  });

  it('a Jenis Plak the catalog has no place for is asked, and the answer is used', async () => {
    const buf = await form([{ heading: 'H', award: 'TOKOH AKADEMIK', line: 'LELAKI', eline2: '', code: 'ZZ 999', qty: 3 }]);
    const r = read(buf);
    const q = r.questions.find((x) => x.kind === 'plak');
    expect(q?.raw).toBe('ZZ 999');
    const again = read(buf, { subs: [{ from: 'ZZ 999', to: 'PKC 263', whole: true }] });
    expect(again.questions.filter((x) => x.kind === 'plak')).toEqual([]);
    expect(again.items.map((it) => it.jenisPlak)).toEqual(['PKC 263']);
    expect(again.total).toBe(36);
  });

  it('a possible typo is asked; a fix or a kept word both let the order through', async () => {
    const buf = await form([{ heading: 'H', award: 'TOKOH SAINZ', line: 'LELAKI', eline2: '', code: 'PKC 263', qty: 1 }]);
    const q = read(buf).questions.find((x) => x.kind === 'typo');
    expect(q).toMatchObject({ word: 'SAINZ', suggestion: 'SAINS' });
    const fixed = read(buf, { subs: [{ from: 'SAINZ', to: 'SAINS' }] });
    expect(fixed.questions.filter((x) => x.kind === 'typo')).toEqual([]);
    expect(fixed.items).toHaveLength(1);
    const kept = read(buf, { okWords: [{ blockKey: q.blockKey, word: 'SAINZ' }] });
    expect(kept.questions.filter((x) => x.kind === 'typo')).toEqual([]);
    expect(kept.items).toHaveLength(1);
  });

  it('not enough stock is a problem the chat can\'t fix', async () => {
    const low = [{ id: 'a', code: 'PKC 263', price: 12, stockQty: 2, stockBaseline: 100 }];
    const buf = await form([{ heading: 'H', award: 'TOKOH AKADEMIK', line: 'LELAKI', eline2: '', code: 'PKC 263', qty: 50 }]);
    const r = readOrderForm(buf, { plakCatalog: low, salesman, details: {} });
    expect(r.problems.join(' ')).toMatch(/Not enough stock for "PKC 263"/);
  });

  it('a file that isn\'t a FORM ANUGERAH', () => {
    const r = read(new Uint8Array([1, 2, 3]).buffer);
    expect(r.error || r.problems.join(' ')).toBeTruthy();
    expect(r.items || []).toEqual([]);
  });
});

describe('substitute', () => {
  it('whole values and words, case ignored, nothing else touched', () => {
    const subs = [{ from: 'zz 999', to: 'PKC 263', whole: true }, { from: 'AKADEMIK', to: 'AKADEMIK', whole: false }, { from: 'SAINZ', to: 'SAINS' }];
    expect(substitute({ a: 'ZZ 999', b: ['Tokoh SAINZ terbaik', 'SAINZA'], c: 3 }, subs)).toEqual({ a: 'PKC 263', b: ['Tokoh SAINS terbaik', 'SAINZA'], c: 3 });
  });
  it('question ids are stable', () => {
    expect(questionId('note', 'x')).toBe(questionId('note', 'x'));
    expect(questionId('note', 'x')).not.toBe(questionId('note', 'y'));
  });
});
