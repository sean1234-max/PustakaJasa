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
    // Line 2 -> EVENT LINE 1 (namaKelas), line 3 -> EVENT LINE 2 (eline2).
    const col = (namaKelas, eline2, qty) => ({ tahunFrom: '', tahunTo: '', namaKelas, eline2, subjects: [{ name: 'KUANTITI', qty }] });
    expect(kelas.classes).toEqual([
      col('TAHUN 1 MAWAR', 'TEMPAT PERTAMA', 1),
      col('TAHUN 1 MAWAR', 'TEMPAT KEDUA', 1),
      col('TAHUN 1 MELUR', 'TEMPAT PERTAMA', 1),
      col('TAHUN 2 MAWAR', 'TEMPAT PERTAMA', 1),
    ]);
    const [tokoh] = res.categorized[key('ANUGERAH KHAS TOKOH')];
    expect(tokoh.jenisPlak).toBe('4942');
    expect(tokoh.classes).toEqual([col('PELAJAR LELAKI 2024', '', 1)]);
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
    expect(pbd.classes).toEqual([{ tahunFrom: '', tahunTo: '', namaKelas: '', eline2: '', subjects: [{ name: 'KUANTITI', qty: 30 }] }]);
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

  it('flags rows with no plaque code, and a likely leftover copy of coded rows', async () => {
    const buf = await makeDocx(para('MAJLIS X') + table([
      ['BIL', 'WORDING', 'KUANTITI', 'KOD HADIAH'],
      ['1', 'ANUGERAH MP\nTAHUN 5\nSAINS', '1', ''],
      ['2', 'ANUGERAH MP\nTAHUN 5\nJAWI', '1', ''],
      ['3', 'ANUGERAH MP\nTAHUN 5\nSAINS', '1', 'CIRCLE'],
      ['4', 'ANUGERAH LAIN', '2', ''],
    ]));
    const res = await parse(buf);
    expect(res.notes).toEqual([
      '"ANUGERAH MP": 2 plaque(s) have no plaque code (KOD) — please pick the Jenis Plak by hand. The same wording is also listed with code CIRCLE — it may be a leftover copy; delete whichever is not needed.',
      '"ANUGERAH LAIN": 2 plaque(s) have no plaque code (KOD) — please pick the Jenis Plak by hand.',
    ]);
  });

  it('returns an error for a file with no order table, or not a docx at all', async () => {
    expect((await parse(await makeDocx(para('hello')))).error).toMatch(/No recognized/);
    expect((await parse(new TextEncoder().encode('not a zip').buffer)).error).toMatch(/valid \.docx/);
  });
});

describe('Word section -> engraved fields', () => {
  // Word wording -> Step 2 block -> production CSV, the same path a real
  // import and export take.
  async function csvRows(rowsXml, heading = 'MAJLIS ANUGERAH 2025') {
    const { populateMatrixSectionBlock } = await import('./excelImport');
    const { buildCsvRows } = await import('./exportCsv');
    const res = await parse(await makeDocx(para(heading) + table([['BIL', 'WORDING', 'KUANTITI', 'KOD HADIAH'], ...rowsXml])));
    return Object.entries(res.categorized).flatMap(([k, [section]]) => {
      const dest = { newLineValues: {}, newMatrixValues: {}, newRowsByBlock: {}, newColumnsByBlock: {}, newPlakRows: {} };
      populateMatrixSectionBlock(section, `${k}::0`, [], { nextRowId: 1, nextColumnId: 1, nextPlakRowId: 1 }, dest, []);
      const item = { id: k, categoryKey: k, blockIdx: 0, jenisPlak: 'X', detail: { lines: dest.newLineValues, rows: dest.newRowsByBlock[`${k}::0`], columns: dest.newColumnsByBlock[`${k}::0`], matrix: dest.newMatrixValues } };
      return buildCsvRows({ items: [item] }, k, [item]).rows.map((r) => ({ tajuk: r[0], position: r[2], line1: r[3], line2: r[4], order: r[7] }));
    });
  }

  it('engraves line 1 / 2 / 3 as POSITION / EVENT LINE 1 / EVENT LINE 2, in that order', async () => {
    const rows = await csvRows([
      ['1', 'ANUGERAH KEDUDUKAN KELAS\nTAHUN 1 MAWAR\nTEMPAT PERTAMA', '2', 'PK 1'],
      ['2', 'PBD TERBAIK\nKELAS KHAS\nTAHUN 2025/2026', '1', 'PK 2'],
    ]);
    const one = { tajuk: 'MAJLIS ANUGERAH 2025', order: 'event_header|position|event_line_1|event_line_2' };
    // "ANUGERAH ..." POSITION gets the house two-line break (acaraBreak.js),
    // as every order's ACARA does.
    expect(rows).toEqual([
      { ...one, position: 'ANUGERAH\nKEDUDUKAN KELAS', line1: 'TAHUN 1 MAWAR', line2: 'TEMPAT PERTAMA' },
      { ...one, position: 'ANUGERAH\nKEDUDUKAN KELAS', line1: 'TAHUN 1 MAWAR', line2: 'TEMPAT PERTAMA' },
      { ...one, position: 'PBD TERBAIK', line1: 'KELAS KHAS', line2: 'TAHUN 2025/2026' },
    ]);
  });

  it('keeps a 4-line cell in order: the first two lines are a two-line POSITION', async () => {
    const rows = await csvRows([
      ['1', 'ANUGERAH\nAKADEMIK TERBAIK\nKELAS KHAS\nTAHUN 2025/2026', '1', 'PK 1'],
      ['2', 'ANUGERAH KHAS TOKOH\nPELAJAR LELAKI 2024', '1', 'PK 1'],
    ]);
    expect(rows.map(({ position, line1, line2 }) => [position, line1, line2])).toEqual([
      ['ANUGERAH\nAKADEMIK TERBAIK', 'KELAS KHAS', 'TAHUN 2025/2026'],
      ['ANUGERAH\nKHAS TOKOH', 'PELAJAR LELAKI 2024', ''],
    ]);
  });

  it('puts a name list on one tab: shared award lines, then name, then the rest', async () => {
    const rows = await csvRows([
      ['1', 'ANUGERAH\nKEPIMPINAN MURID\nMURID SATU\nKETUA PENGAWAS\nLEMBAGA PENGAWAS', '1', 'PK 1'],
      ['2', 'ANUGERAH\nKEPIMPINAN MURID\nMURID DUA\nPENGERUSI\nPRS', '1', 'PK 1'],
      ['3', 'ANUGERAH\nKHIDMAT BAKTI\nMURID TIGA\nBENDAHARI\nBADAR', '1', 'PK 1'],
    ]);
    expect(rows.map(({ position, line1, line2 }) => [position, line1, line2])).toEqual([
      ['ANUGERAH\nKEPIMPINAN MURID', 'MURID SATU', 'KETUA PENGAWAS\nLEMBAGA PENGAWAS'],
      ['ANUGERAH\nKEPIMPINAN MURID', 'MURID DUA', 'PENGERUSI\nPRS'],
      ['ANUGERAH\nKHIDMAT BAKTI', 'MURID TIGA', 'BENDAHARI\nBADAR'],
    ]);
  });
});
