// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { fillOrderTemplate } from './templateExport';
import { readOrderForm, substitute, questionId, stockAlternatives } from './botOrder';

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

  it('not enough stock: asked, with codes in stock offered, and the swap goes through', async () => {
    const tree = [
      { id: 'a', code: 'PK 261', price: 10, children: [{ id: 'a1', code: 'A', price: 0, stockQty: 0, stockBaseline: 100 }, { id: 'a2', code: 'B', price: 0, stockQty: 50, stockBaseline: 100 }] },
      { id: 'b', code: 'PK 262', price: 11, children: [{ id: 'b1', code: 'A', price: 0, stockQty: 120, stockBaseline: 200 }] },
      { id: 'c', code: 'W038', price: 30, stockQty: 999, stockBaseline: 1000 },
    ];
    const buf = await form([{ heading: 'H', award: 'TOKOH AKADEMIK', line: 'LELAKI', eline2: '', code: 'PK 261 / A', qty: 5 }]);
    const r = readOrderForm(buf, { plakCatalog: tree, salesman, details: {}, lang: 'zh' });
    expect(r.problems).toEqual([]);
    const q = r.questions.find((x) => x.kind === 'stock');
    expect(q).toMatchObject({ code: 'PK 261 / A', qty: 5, left: 0 });
    expect(q.text).toContain('库存不够');
    // same last part (A) first, then the rest of the family; never another family
    expect(q.options.map((o) => o.code)).toEqual(['PK 262 / A', 'PK 261 / B']);
    const swapped = readOrderForm(buf, { plakCatalog: tree, salesman, details: {}, swaps: [{ from: 'PK 261 / A', to: 'PK 262 / A' }] });
    expect(swapped.questions.filter((x) => x.kind === 'stock')).toEqual([]);
    expect(swapped.items.map((it) => [it.jenisPlak, Number(it.qty), it.harga])).toEqual([['PK 262 / A', 5, 55]]);
    expect(swapped.remark).toContain('PK 261 / A → PK 262 / A');
  });

  it('stockAlternatives: enough stock for the quantity only', () => {
    const tree = [
      { id: 'a', code: 'PK 261', children: [{ id: 'a1', code: 'A', stockQty: 0, stockBaseline: 10 }] },
      { id: 'b', code: 'PK 262', children: [{ id: 'b1', code: 'A', stockQty: 3, stockBaseline: 10 }] },
      { id: 'c', code: 'PK 263', children: [{ id: 'c1', code: 'A' }] },
    ];
    expect(stockAlternatives('PK 261 / A', 5, tree).map((o) => o.code)).toEqual(['PK 263 / A']);
    expect(stockAlternatives('PK 261 / A', 2, tree).map((o) => o.code)).toEqual(['PK 262 / A', 'PK 263 / A']);
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
