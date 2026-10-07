import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { parseWordingDocx, classifyWordingLines, parseDocxQty, cleanDocxPlakCode } from './docxImport';
import { makeDynamicCategoryKey } from '../data/catalog';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A cell's text: '\n' becomes a separate paragraph (a real line inside one
// Word cell).
const cell = (text) => `<w:tc>${String(text).split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')}</w:tc>`;
const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const table = (rows) => `<w:tbl>${rows.map(row).join('')}</w:tbl>`;
const para = (text) => `<w:p><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;

async function makeDocx(bodyXml) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
const parse = (buf) => parseWordingDocx(buf, { DOMParser });
const key = (label) => makeDynamicCategoryKey('KLAS_MATRIX', label);

describe('parseDocxQty', () => {
  it('reads a leading whole number, with or without a unit', () => {
    expect(parseDocxQty('1')).toBe(1);
    expect(parseDocxQty('30 SET')).toBe(30);
    expect(parseDocxQty(' 2 unit ')).toBe(2);
  });
  it('never guesses an unreadable quantity', () => {
    expect(parseDocxQty('')).toBeNull();
    expect(parseDocxQty('SATU')).toBeNull();
    expect(parseDocxQty('2.5')).toBeNull();
    expect(parseDocxQty('-')).toBeNull();
  });
});

describe('cleanDocxPlakCode', () => {
  it('drops the CODE: prefix and the RM price only', () => {
    expect(cleanDocxPlakCode('CODE: 19540 B RM 33')).toBe('19540 B');
    expect(cleanDocxPlakCode('CODE : SR-116 A BIRU RM 34')).toBe('SR-116 A BIRU');
    expect(cleanDocxPlakCode('PK 020 C')).toBe('PK 020 C');
    expect(cleanDocxPlakCode('TOTE BAG SILKSCREEN RM8')).toBe('TOTE BAG SILKSCREEN');
  });
});

describe('classifyWordingLines', () => {
  it('splits a 3-line cell into title / tahun+class / placing', () => {
    expect(classifyWordingLines(['ANUGERAH KEDUDUKAN KELAS', 'TAHUN 1 MAWAR', 'TEMPAT PERTAMA']))
      .toEqual({ title: 'ANUGERAH KEDUDUKAN KELAS', tahun: 'TAHUN 1', namaKelas: 'MAWAR', subjectName: 'TEMPAT PERTAMA' });
  });
  it('splits a one-line cell only at TAHUN N and an explicit placing', () => {
    expect(classifyWordingLines(['ANUGERAH KEDUDUKAN KELAS TAHUN 1 MAWAR TEMPAT KEDUA']))
      .toEqual({ title: 'ANUGERAH KEDUDUKAN KELAS', tahun: 'TAHUN 1', namaKelas: 'MAWAR', subjectName: 'TEMPAT KEDUA' });
  });
  it('keeps every word after TAHUN N together when there is no explicit placing', () => {
    expect(classifyWordingLines(['ANUGERAH MATAPELAJARAN TERBAIK TAHUN 2 MAWAR ARAB']))
      .toEqual({ title: 'ANUGERAH MATAPELAJARAN TERBAIK', tahun: 'TAHUN 2', namaKelas: 'MAWAR ARAB', subjectName: 'KUANTITI' });
  });
  it('treats TAHUN 2025/2026 as a year, not a Tahun level', () => {
    const label = 'PBD TERBAIK KELAS PENDIDIKAN KHAS TAHUN 2025/2026';
    expect(classifyWordingLines([label])).toEqual({ title: label, tahun: '', namaKelas: '', subjectName: 'KUANTITI' });
    expect(classifyWordingLines(['ANUGERAH X', 'TAHUN 2025'])).toEqual({ title: 'ANUGERAH X', tahun: '', namaKelas: 'TAHUN 2025', subjectName: 'KUANTITI' });
  });
});

describe('parseWordingDocx', () => {
  it('reads a WORDING / KUANTITI / KOD HADIAH table into one active dynamic category per award', async () => {
    const buf = await makeDocx(
      para('MAJLIS ANUGERAH CEMERLANG 2025')
      + table([
        ['BIL', 'WORDING', 'KUANTITI', 'KOD HADIAH', 'WARNA'],
        ['1.', 'ANUGERAH KEDUDUKAN KELAS\nTAHUN 1 MAWAR\nTEMPAT PERTAMA', '1', 'PK 020 C', ''],
        ['', 'ANUGERAH KEDUDUKAN KELAS\nTAHUN 1 MAWAR\nTEMPAT KEDUA', '1', 'PK 020 C', ''],
        ['2.', 'ANUGERAH KEDUDUKAN KELAS\nTAHUN 1 MELUR\nTEMPAT PERTAMA', '1', 'PK 020 C', ''],
      ])
      // Same award continued in a second table after a page break.
      + table([
        ['BIL', 'WORDING', 'KUANTITI', 'KOD HADIAH', 'WARNA'],
        ['3.', 'ANUGERAH KHAS TOKOH\nPELAJAR LELAKI 2024', '1', 'CODE: 4942 RM 59', ''],
        ['', 'ANUGERAH KEDUDUKAN KELAS\nTAHUN 2 MAWAR\nTEMPAT PERTAMA', '1', 'PK 020 C', ''],
      ]),
    );
    const res = await parse(buf);
    expect(res.error).toBeUndefined();
    expect(Object.keys(res.categorized)).toEqual([key('ANUGERAH KEDUDUKAN KELAS'), key('ANUGERAH KHAS TOKOH')]);
    const [kelas] = res.categorized[key('ANUGERAH KEDUDUKAN KELAS')];
    expect(kelas.lines).toEqual({ 0: 'MAJLIS ANUGERAH CEMERLANG 2025', 2: 'ANUGERAH KEDUDUKAN KELAS' });
    expect(kelas.jenisPlak).toBe('PK 020 C');
    expect(kelas.classes).toEqual([
      { tahunFrom: 'TAHUN 1', tahunTo: 'TAHUN 1', namaKelas: 'MAWAR', subjects: [{ name: 'TEMPAT PERTAMA', qty: 1 }, { name: 'TEMPAT KEDUA', qty: 1 }] },
      { tahunFrom: 'TAHUN 1', tahunTo: 'TAHUN 1', namaKelas: 'MELUR', subjects: [{ name: 'TEMPAT PERTAMA', qty: 1 }] },
      { tahunFrom: 'TAHUN 2', tahunTo: 'TAHUN 2', namaKelas: 'MAWAR', subjects: [{ name: 'TEMPAT PERTAMA', qty: 1 }] },
    ]);
    const [tokoh] = res.categorized[key('ANUGERAH KHAS TOKOH')];
    expect(tokoh.jenisPlak).toBe('4942');
    expect(tokoh.classes).toEqual([{ tahunFrom: '', tahunTo: '', namaKelas: 'PELAJAR LELAKI 2024', subjects: [{ name: 'KUANTITI', qty: 1 }] }]);
    expect(res.notes).toEqual([]);
  });

  it('reads a NO. / KOD HADIAH / LABEL / BILANGAN table ("30 SET")', async () => {
    const buf = await makeDocx(
      para('MAJLIS ANUGERAH KECEMERLANGAN 2025')
      + table([
        ['NO.', 'KOD HADIAH', 'LABEL', 'BILANGAN', 'CATATAN'],
        ['1', 'CODE: 19540 B RM 33', 'PBD TERBAIK KELAS KHAS TAHUN 2025/2026', '30 SET', ''],
        ['2', 'CODE: 4943 SOLID GOLD LOVE RM 59', 'ANUGERAH AKADEMIK TERBAIK', '1 SET', ''],
      ]),
    );
    const res = await parse(buf);
    expect(Object.keys(res.categorized)).toEqual([key('PBD TERBAIK KELAS KHAS TAHUN 2025/2026'), key('ANUGERAH AKADEMIK TERBAIK')]);
    const [pbd] = res.categorized[key('PBD TERBAIK KELAS KHAS TAHUN 2025/2026')];
    expect(pbd.jenisPlak).toBe('19540 B');
    expect(pbd.classes).toEqual([{ tahunFrom: '', tahunTo: '', namaKelas: '', subjects: [{ name: 'KUANTITI', qty: 30 }] }]);
  });

  it('keeps one title with two different codes as two awards', async () => {
    const buf = await makeDocx(para('MAJLIS X') + table([
      ['BIL', 'WORDING', 'KUANTITI', 'KOD HADIAH'],
      ['1', 'ANUGERAH KHAS\nTOKOH A', '1', 'PK 1'],
      ['2', 'ANUGERAH KHAS\nTOKOH B', '1', 'PK 2'],
    ]));
    const res = await parse(buf);
    expect(Object.keys(res.categorized)).toEqual([key('ANUGERAH KHAS (PK 1)'), key('ANUGERAH KHAS (PK 2)')]);
    expect(res.categorized[key('ANUGERAH KHAS (PK 2)')][0].jenisPlak).toBe('PK 2');
  });

  it('reports what it cannot place instead of guessing', async () => {
    const buf = await makeDocx(table([
      ['BIL', 'WORDING', 'KUANTITI', 'KOD HADIAH'],
      ['1', 'ANUGERAH A', '2', 'PK 1'],
      ['2', 'ANUGERAH B', 'SATU', 'PK 1'],
      ['3', '', '4', 'BOUQUET'],
      ['', 'JUMLAH', '9', ''],
    ]));
    const res = await parse(buf);
    expect(Object.keys(res.categorized)).toEqual([key('ANUGERAH A')]);
    expect(res.notes).toHaveLength(4);
    expect(res.notes[0]).toMatch(/couldn't read the quantity "SATU"/);
    expect(res.notes[1]).toMatch(/quantity \("4"\) but no wording/);
    expect(res.notes[2]).toMatch(/JUMLAH\/TOTAL says 9, but the rows above it add up to 2/);
    expect(res.notes[3]).toMatch(/No event heading/);
  });

  it('returns an error for a file with no order table, or not a docx at all', async () => {
    expect((await parse(await makeDocx(para('hello')))).error).toMatch(/No recognized/);
    expect((await parse(new TextEncoder().encode('not a zip').buffer)).error).toMatch(/valid \.docx/);
  });
});

describe('Word section -> Step 2 block', () => {
  it('fills the same block shape a renamed PPKI/MP THP sheet does', async () => {
    const { populateMatrixSectionBlock } = await import('./excelImport');
    const buf = await makeDocx(para('MAJLIS ANUGERAH 2025') + table([
      ['BIL', 'WORDING', 'KUANTITI', 'KOD HADIAH'],
      ['1', 'ANUGERAH KEDUDUKAN KELAS\nTAHUN 1 MAWAR\nTEMPAT PERTAMA', '1', ''],
    ]));
    const res = await parse(buf);
    const k = key('ANUGERAH KEDUDUKAN KELAS');
    const dest = { newLineValues: {}, newMatrixValues: {}, newRowsByBlock: {}, newColumnsByBlock: {}, newPlakRows: {} };
    const ids = { nextRowId: 1, nextColumnId: 1, nextPlakRowId: 1 };
    populateMatrixSectionBlock(res.categorized[k][0], `${k}::0`, [], ids, dest, []);
    expect(dest.newLineValues[`${k}::0::0`]).toBe('MAJLIS ANUGERAH 2025');
    expect(dest.newLineValues[`${k}::0::2`]).toBe('ANUGERAH KEDUDUKAN KELAS');
    expect(dest.newLineValues[`${k}::0::3`]).toBe('TAHUN 1 MAWAR');
    expect(dest.newRowsByBlock[`${k}::0`].map((r) => r.desc)).toEqual(['TEMPAT PERTAMA']);
    expect(dest.newColumnsByBlock[`${k}::0`].map((c) => c.namaKelas)).toEqual(['MAWAR']);
    expect(Object.values(dest.newMatrixValues)).toEqual(['1']);
  });
});
