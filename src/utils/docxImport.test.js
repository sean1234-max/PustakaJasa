import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { parseWordingDocx, classifyWordingLines, parseDocxQty, cleanDocxPlakCode, wordingRowsToCategorized, splitRowHeading, kodsAbove } from './docxImport';
import { matchJenisPlakPath } from './excelImport';
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
      ['ANUGERAH KHAS TOKOH', 'PELAJAR LELAKI 2024', ''],
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

  it('keeps single-plaque awards with the same lines below as normal awards', async () => {
    const rows = await csvRows([
      ['1', 'ANUGERAH\nAKADEMIK TERBAIK\nKELAS KHAS\nTAHUN 2025/2026', '1', 'PK 1'],
      ['2', 'ANUGERAH\nSAHSIAH TERPUJI\nKELAS KHAS\nTAHUN 2025/2026', '1', 'PK 1'],
    ]);
    expect(rows.map(({ position, line1, line2 }) => [position, line1, line2])).toEqual([
      ['ANUGERAH\nAKADEMIK TERBAIK', 'KELAS KHAS', 'TAHUN 2025/2026'],
      ['ANUGERAH\nSAHSIAH TERPUJI', 'KELAS KHAS', 'TAHUN 2025/2026'],
    ]);
  });
});

describe('wordingRowsToCategorized — keepOrder (AI reader)', () => {
  const r = (award, line) => ({ lines: [award, line], qty: 1, kod: '' });
  const tabs = (rows) => Object.values(wordingRowsToCategorized(rows, 'MAJLIS', { keepOrder: true }).categorized)
    .map(([s]) => `${s.sourceSheet}: ${s.classes.map((c) => c.namaKelas).join(', ')}`);

  it('gives an award listed again after one that never returns its own tab, so the file order stays', () => {
    expect(tabs([r('MURID CEMERLANG', 'PAGI'), r('RISING STAR', 'SUKAN'), r('MURID CEMERLANG', 'PETANG')])).toEqual([
      'MURID CEMERLANG: PAGI', 'RISING STAR: SUKAN', 'MURID CEMERLANG (2): PETANG',
    ]);
  });

  it('keeps one tab per award when the awards alternate all through (a table)', () => {
    expect(tabs([r('PERTAMA', '4 A'), r('KEDUA', '4 A'), r('PERTAMA', '4 B'), r('KEDUA', '4 B')])).toEqual([
      'PERTAMA: 4 A, 4 B', 'KEDUA: 4 A, 4 B',
    ]);
  });

  it('groups by award as before without keepOrder', () => {
    const rows = [r('MURID CEMERLANG', 'PAGI'), r('RISING STAR', 'SUKAN'), r('MURID CEMERLANG', 'PETANG')];
    expect(Object.values(wordingRowsToCategorized(rows, 'MAJLIS').categorized).map(([s]) => s.sourceSheet))
      .toEqual(['MURID CEMERLANG', 'RISING STAR']);
  });
});

describe('subject short forms', () => {
  it('drops a bracketed note after the award but keeps a bracket-only line', () => {
    const { categorized } = wordingRowsToCategorized([
      { lines: ['ANUGERAH PENDETA ZA’ABA (BM)', 'TAHUN 1'], qty: 1, kod: 'PKC 263' },
      { lines: ['ANUGERAH SAIDINA ABUBAKAR (TERBAIK KESELURUHAN)', 'TAHUN 1'], qty: 1, kod: 'PKC 263' },
      { lines: ['ANUGERAH MURID CEMERLANG', '(KELAB)', 'SESI PAGI'], qty: 1, kod: 'PKC 263' },
    ], 'MAJLIS APRESIASI AKADEMIK');
    const text = JSON.stringify(categorized);
    expect(text).not.toContain('(BM)');
    expect(text).toContain('PENDETA ZA’ABA');
    expect(text).not.toContain('(TERBAIK KESELURUHAN)');
    expect(text).toContain('SAIDINA ABUBAKAR');
    expect(text).toContain('(KELAB)');
  });

  it('engraves (LELAKI) / (PEREMPUAN) on its own line under the award', () => {
    const { categorized } = wordingRowsToCategorized([
      { lines: ['Tokoh Akademik (Lelaki)', 'Tahap 1'], qty: 1, kod: 'W038 / B' },
      { lines: ['Tokoh Akademik (Perempuan)', 'Tahap 1'], qty: 1, kod: 'W038 / B' },
    ], 'HARI ANUGERAH KUALITI 2026');
    const sections = Object.values(categorized).flat();
    expect(sections).toHaveLength(1);
    expect(sections[0].lines[2]).toBe('Tokoh Akademik');
    expect(sections[0].classes.map((c) => [c.namaKelas, c.eline2, c.subjects[0].qty]))
      .toEqual([['Lelaki', 'Tahap 1', 1], ['Perempuan', 'Tahap 1', 1]]);
  });
});

describe('a Word order that repeats the heading in every WORDING cell', () => {
  const H = 'HARI ANUGERAH KUALITI 2026';
  const body = para(H)
    + table([
      ['BIL', 'WORDING', 'BILANGAN', 'JENIS / KOD', 'HARGA'],
      ['1', `${H}\nTerbaik PBD\nTahun 1`, '45', 'CPH C', 'RM7.50'],
      ['2', `${H}\nTerbaik PBD\nTahun 2`, '40', 'CPH C', 'RM7.50'],
      ['', '', 'JUMLAH : 85 PCS', '', ''],
    ])
    + table([
      ['BIL', 'WORDING', 'BILANGAN', 'JENIS', 'HARGA'],
      ['1', `SK PUCHONG UTAMA 2\n${H}\nTokoh NILAM\nTahap 2`, '1', '4942', 'RM59.00'],
      ['2', `${H}\nTokoh Murid\nTahap 2`, '1', 'TSL232#3 (BL)', 'RM45.00'],
      ['', '', 'JUMLAH : 2 PCS', '', ''],
    ]);

  it('reads JENIS / KOD, skips the JUMLAH row, and gives each award its own tab', async () => {
    const res = await parse(await makeDocx(body));
    expect(Object.values(res.categorized).map(([s]) => [s.sourceSheet, s.lines[0], s.jenisPlak])).toEqual([
      ['Terbaik PBD', H, 'CPH C'],
      ['Tokoh NILAM', `SK PUCHONG UTAMA 2\n${H}`, '4942'],
      ['Tokoh Murid', H, 'TSL232#3 BLUE'],
    ]);
    expect(res.categorized[key('Terbaik PBD')][0].classes.map((c) => [c.namaKelas, c.subjects[0].qty])).toEqual([['Tahun 1', 45], ['Tahun 2', 40]]);
    // The JUMLAH row is a total that agrees with the table, so nothing to say.
    expect(res.notes.join(' ')).not.toMatch(/JUMLAH|no plaque code|no wording/);
  });

  it('still says so when a JUMLAH row disagrees with its table', async () => {
    const res = await parse(await makeDocx(para(H) + table([
      ['BIL', 'WORDING', 'BILANGAN', 'JENIS / KOD'],
      ['1', `${H}\nTerbaik PBD\nTahun 1`, '45', 'CPH C'],
      ['', '', 'JUMLAH : 50 PCS', ''],
    ])));
    expect(res.notes.join(' ')).toMatch(/JUMLAH\/TOTAL says 50, but the rows above it add up to 45/);
  });

  it('leaves a cell that is only the heading, or has no heading, as it is', () => {
    expect(splitRowHeading({ lines: [H], qty: 1 }, H)).toEqual({ lines: [H], qty: 1 });
    expect(splitRowHeading({ lines: ['ANUGERAH NILAM', 'TAHUN 1'], qty: 1 }, H)).toEqual({ lines: ['ANUGERAH NILAM', 'TAHUN 1'], qty: 1 });
    expect(splitRowHeading({ lines: ['A', 'B', H, 'X'], qty: 1 }, H).lines).toEqual(['A', 'B', H, 'X']);
  });

  it('spells out a bracketed colour so the catalog option is found', () => {
    const tree = [
      { code: 'SR-116 A', children: [{ code: 'RED' }, { code: 'BLUE' }] },
      { code: 'TSL232#3', children: [{ code: 'RED' }, { code: 'BLUE' }] },
      { code: 'CPH', children: [{ code: 'A' }, { code: 'B' }, { code: 'C' }] },
    ];
    expect(matchJenisPlakPath(cleanDocxPlakCode('SR – 116 A (R)'), tree)).toBe('SR-116 A / RED');
    expect(matchJenisPlakPath(cleanDocxPlakCode('TSL232#3 (BL)'), tree)).toBe('TSL232#3 / BLUE');
    expect(matchJenisPlakPath(cleanDocxPlakCode('CPH C'), tree)).toBe('CPH / C');
  });
});

describe('a subject in brackets is engraved as the award\'s second line (Sean, 2026-10-22)', () => {
  it('folds (BAHASA MELAYU) into the line above or the same line, brackets off; (BM) stays a dropped note', async () => {
    const { foldBracketSubjects, wordingRowsToCategorized } = await import('./docxImport');
    expect(foldBracketSubjects(['MAJLIS 2026', 'MATA PELAJARAN TERBAIK TAHUN 6', '(BAHASA MELAYU)'])).toEqual(['MAJLIS 2026', 'MATA PELAJARAN TERBAIK TAHUN 6\nBAHASA MELAYU']);
    expect(foldBracketSubjects(['MATA PELAJARAN TERBAIK (PENDIDIKAN JASMANI DAN KESIHATAN)'])).toEqual(['MATA PELAJARAN TERBAIK\nPENDIDIKAN JASMANI DAN KESIHATAN']);
    expect(foldBracketSubjects(["ANUGERAH PENDETA ZA'ABA (BM)"])).toEqual(["ANUGERAH PENDETA ZA'ABA (BM)"]);
    const rows = ['BAHASA MELAYU', 'SAINS'].map((sub) => ({ lines: ['MATA PELAJARAN TERBAIK TAHUN 6', `(${sub})`], qty: 8, kod: 'PK 261 B' }));
    const { categorized } = wordingRowsToCategorized(rows);
    expect(Object.values(categorized).flat().map((sec) => sec.lines[2])).toEqual(['MATA PELAJARAN TERBAIK TAHUN 6\nBAHASA MELAYU', 'MATA PELAJARAN TERBAIK TAHUN 6\nSAINS']);
  });
});

describe("a school's own list in Word (NAMA | CODE | JUMLAH | HARGA)", () => {
  it('reads top to bottom as ORDER LAIN-LAIN, carries the header into the next tables, design from the line above, sashes from one-cell boxes', async () => {
    const head = 'MAJLIS ANUGERAH 2026\n2026';
    const buf = await makeDocx([
      para('TEMPAHAN PLAK MAJLIS ANUGERAH SK CONTOH'),
      para('( WOODEN PLAQE ) PKC 263'),
      table([['NAMA', 'CODE', 'JUMLAH', 'HARGA'], [`${head}\nANUGERAH AKADEMIK TERBAIK\n1 BESTARI`, 'PKC 263', '3 PIECES', '12.00 (SEUNIT)'], [`${head}\nANUGERAH AKADEMIK TERBAIK\n1 BIJAK`, 'PKC 263', '3 PIECES', '12.00 (SEUNIT)']]),
      para('( KRISTAL ) OOS - DESIGN C'),
      table([[`${head}\nTOKOH MURID`, 'OOS', '1 PIECES', '39.00 (SEUNIT)']]),
      para('KAIN SELEMPANG & LOGO SEKOLAH'),
      para('( RM40 X 2 ) CODE 0050'),
      table([['TOKOH MURID 2026']]),
    ].join(''));
    const { categorized } = await parse(buf);
    const umum = categorized.UMUM[0];
    expect(umum.lines).toMatchObject({ 0: head, 1: 'ANUGERAH AKADEMIK TERBAIK', 2: '1 BESTARI', umumRed: '1' });
    expect(umum.umumRows.map((r) => [r.l1, r.l2, r.qty, r.jenisPlak, r.toRemark])).toEqual([
      ['', '', 3, 'PKC 263', 'PKC 263 | 3 | RM12.00 | RM36.00'],
      ['', '1 BIJAK', 3, 'PKC 263', 'PKC 263 | 3 | RM12.00 | RM36.00'],
      ['TOKOH MURID', '-', 1, 'OOS DESIGN C', 'OOS DESIGN C | 1 | RM39.00 | RM39.00'],
    ]);
    expect(categorized.SELEMPANG[0].selempangRows).toEqual([expect.objectContaining({ acara: 'TOKOH MURID 2026', warna: 'MERAH', qty: 1 })]);
  });
});

describe('KOD MEDAL written above each NO | NAMA ANUGERAH | JUMLAH table (SK ABDUL SAMAT, 2026-10-27)', () => {
  const head = 'Anugerah Gemilang Ko-Kurikulum 2026\nSK Abdul Samat';
  const header = ['NO', 'NAMA ANUGERAH', 'JUMLAH'];
  const doc = (total, penerima) => makeDocx([
    para('HARI ANUGERAH GEMILANG KO-KURIKULUM'),
    para('DAERAH (KOD MEDAL 18059)'),
    table([header,
      ['1.', `${head}\nKEJOHANAN BOLA JARING DAERAH KLANG\nNAIB JOHAN`, '10'],
      ['2.', `${head}\nPERTANDINGAN KUIH TRADISIONAL\nPUTERI ISLAM DAERAH KLANG\nJOHAN`, '3'],
      ['3.', `${head}\nE-PERKHEMAHAN LENCANA KEMAJUAN\nLENCANA KERIS EMAS`, '2']]),
    para(total),
    para('KEBANGSAAN (KOD MEDAL 13228-B)'),
    table([header, ['1.', `${head}\nKAWAD KAKI PERINGKAT KEBANGSAAN\nJOHAN`, '20']]),
    para('TOKOH MURID (KOD MEDAL : (YK628)+(GTS15))'),
    table([header, ['1.', `${head}\nTOKOH KOKURIKULUM 2026`, '2']]),
    para('ANUGERAH GURU (KOD MEDAL (80-B) Design 2)'),
    table([header, ['1.', `${head}\nANUGERAH GURU GEMILANG KOKURIKULUM 2026`, '6']]),
    para(`JUMLAH PENERIMA: ${penerima} ORANG`),
  ].join(''));

  it('reads every table with the code above it, the place line red, a second code as its own row (to the Remark)', async () => {
    const { categorized, notes } = await parse(await doc('15', 43));
    const umum = categorized.UMUM[0];
    expect(umum.lines).toMatchObject({ 0: head, 1: 'KEJOHANAN BOLA JARING DAERAH KLANG', 2: 'NAIB JOHAN', umumRed: '2' });
    expect(umum.umumRows.map((r) => [r.l1, r.l2, r.qty, r.jenisPlak])).toEqual([
      ['', '', 10, '18059'],
      ['PERTANDINGAN KUIH TRADISIONAL\nPUTERI ISLAM DAERAH KLANG', 'JOHAN', 3, '18059'],
      ['E-PERKHEMAHAN LENCANA KEMAJUAN', 'LENCANA KERIS EMAS', 2, '18059'],
      ['KAWAD KAKI PERINGKAT KEBANGSAAN', 'JOHAN', 20, '13228-B'],
      ['-', 'TOKOH KOKURIKULUM 2026', 2, 'YK628'],
      ['-', 'TOKOH KOKURIKULUM 2026', 2, 'GTS15'],
      ['-', 'ANUGERAH GURU GEMILANG KOKURIKULUM 2026', 6, '80-B Design 2'],
    ]);
    expect(notes).toEqual([]);
  });

  it('says so when a table or the whole order disagrees with the totals written under it', async () => {
    const { notes } = await parse(await doc('16', 50));
    expect(notes.join(' ')).toMatch(/total under it says 16, but its rows add up to 15/);
    expect(notes.join(' ')).toMatch(/JUMLAH PENERIMA says 50, but the tables add up to 43/);
  });

  it('reads the codes out of a KOD MEDAL line', () => {
    expect(kodsAbove('DAERAH (KOD MEDAL 18059)')).toEqual(['18059']);
    expect(kodsAbove('TOKOH MURID (KOD MEDAL : (YK628)+(GTS15))')).toEqual(['YK628', 'GTS15']);
    expect(kodsAbove('ANUGERAH GURU (KOD MEDAL (80-B) Design 2)')).toEqual(['80-B Design 2']);
    expect(kodsAbove('( KRISTAL ) OOS - DESIGN C')).toEqual([]);
  });
});

describe('plaques drawn as text boxes (no table)', () => {
  it('reads each box as a plaque, the heading\'s code and PCS shared evenly, "2 PCS" boxes skipped', async () => {
    const box = (text) => `<w:p><w:r><w:txbxContent>${text.split('\n').map((l) => `<w:p><w:r><w:t>${esc(l)}</w:t></w:r></w:p>`).join('')}</w:txbxContent></w:r></w:p>`;
    const buf = await makeDocx([
      para('PRASEKOLAH SK CONTOH'),
      para('WOODEN PLAQUE (PKC 246) – 1 PCS'),
      box('MAJLIS SERAH SIJIL\nIKON MURID CEMERLANG\nKELAS PRA GENIUS'),
      para('WOODEN PLAQUE (P261) – 4 PCS'),
      box('MAJLIS SERAH SIJIL\nIKON KEHADIRAN TERBAIK\nPRASEKOLAH DINAMIK'),
      box('2 PCS'),
      box('MAJLIS SERAH SIJIL\nIKON KEHADIRAN TERBAIK\nPRASEKOLAH GENIUS'),
    ].join(''));
    const { categorized, error } = await parse(buf);
    expect(error).toBeUndefined();
    const umum = categorized.UMUM[0];
    expect(umum.lines).toMatchObject({ 0: 'MAJLIS SERAH SIJIL', 1: 'IKON MURID CEMERLANG', 2: 'KELAS PRA GENIUS' });
    expect(umum.umumRows.map((r) => [r.l1, r.l2, r.qty, r.jenisPlak])).toEqual([
      ['', '', 1, 'PKC 246'],
      ['IKON KEHADIRAN TERBAIK', 'PRASEKOLAH DINAMIK', 2, 'P261'],
      ['IKON KEHADIRAN TERBAIK', 'PRASEKOLAH GENIUS', 2, 'P261'],
    ]);
  });
});
