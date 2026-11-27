import { describe, expect, test } from 'vitest';
import fs from 'fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { fillOrderTemplate } from './templateExport';
import { readOrderForm } from './botOrder';
import { aiPlaquesOf } from './reviewChecks';
import { toFormPlaques } from '../../supabase/functions/telegram-bot/formPlaques.ts';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { checkAgainstLines, checkAgainstReading, issueKey, kkOkLabel, linesCoverage, readingCoverage } from './kertasKerjaCheck';
import { kertasKerjaLines } from './kertasKerjaText';

const heading = 'MAJLIS ANUGERAH KECEMERLANGAN 2026';
const mp = (subject, tahun) => ({ type: 'mp_subject', heading, award: 'ANUGERAH MATA PELAJARAN TERBAIK', subject, tahun, qty: 1 });
const reading = { school: 'SK TAMAN MEGAH', plaques: [
  mp('PENDIDIKAN SENI VISUAL', 5), mp('PENDIDIKAN SENI VISUAL', 6), mp('PENDIDIKAN ISLAM', 6),
  { type: 'umum', heading, award: 'DUTA SAHSIAH', line3: 'NUR SHAFIQAH BINTI MUHAMAD TAUFIQ', qty: 1 },
] };
const plaque = (red, ...black) => ({ header: heading, red, black, count: 1 });

describe('checkAgainstReading', () => {
  test('flags nothing when the plaque matches the kertas kerja, line breaks aside', () => {
    expect(checkAgainstReading([plaque('ANUGERAH MATA PELAJARAN', 'TERBAIK PENDIDIKAN SENI VISUAL', 'TAHUN 6')], [reading])).toEqual([]);
  });

  test('flags a word the kertas kerja has on its closest plaque but this plaque lacks', () => {
    const issues = checkAgainstReading([plaque('ANUGERAH MATA PELAJARAN TERBAIK', 'SENI VISUAL', 'TAHUN 6')], [reading]);
    expect(issues).toEqual([expect.objectContaining({ kind: 'missing', word: 'PENDIDIKAN' })]);
  });

  test('pairs a misspelt name with the kertas kerja spelling', () => {
    const issues = checkAgainstReading([plaque('DUTA SAHSIAH', 'NUR SHAFIQAH BINTI MUHAMMAD TAUFIQ')], [reading]);
    expect(issues).toEqual([expect.objectContaining({ kind: 'typo', word: 'MUHAMMAD', kk: 'MUHAMAD' })]);
    expect(issues[0].kkText).toBe(`${heading} / DUTA SAHSIAH / NUR SHAFIQAH BINTI MUHAMAD TAUFIQ`);
  });

  test('flags a word the kertas kerja never has, unless it is the order school', () => {
    const p = plaque('DUTA SAHSIAH', 'NUR SHAFIQAH BINTI MUHAMAD TAUFIQ', 'SK LINGGI');
    expect(checkAgainstReading([p], [reading]).map((i) => `${i.kind} ${i.word}`)).toEqual(['extra LINGGI']);
    expect(checkAgainstReading([p], [reading], ['SK LINGGI'])).toEqual([]);
  });

  test('counts one issue over every plaque that has it', () => {
    const p = { ...plaque('ANUGERAH MATA PELAJARAN TERBAIK', 'SENI VISUAL', 'TAHUN 6'), count: 3 };
    expect(checkAgainstReading([p, p], [reading])[0].count).toBe(6);
  });

  test('flags a TAJUK word of the kertas kerja that no plaque carries', () => {
    const withSchool = { ...reading, plaques: reading.plaques.map((p) => ({ ...p, heading: `${heading} SK TAMAN MEGAH` })) };
    const issues = checkAgainstReading([plaque('ANUGERAH MATA PELAJARAN TERBAIK', 'PENDIDIKAN ISLAM', 'TAHUN 6')], [withSchool]);
    expect(issues.map((i) => `${i.where} ${i.kind} ${i.word}`)).toEqual(['header missing TAMAN', 'header missing MEGAH']);
  });

  test('says nothing without a reading', () => {
    expect(checkAgainstReading([plaque('ANYTHING')], [])).toEqual([]);
  });
});

describe('readingCoverage', () => {
  test('is the share of plaques with a close kertas kerja plaque', () => {
    expect(readingCoverage([plaque('DUTA SAHSIAH', 'NUR SHAFIQAH BINTI MUHAMAD TAUFIQ'), plaque('JOHAN', 'PERTANDINGAN BERCERITA')], [reading])).toBe(0.5);
  });
});

describe('kkOkLabel', () => {
  test('reads a remembered answer back in words', () => {
    expect(kkOkLabel(issueKey({ where: 'plaque', kind: 'typo', word: 'MUHAMMAD', kk: 'MUHAMAD' }))).toBe('MUHAMMAD (the file: MUHAMAD)');
    expect(kkOkLabel(issueKey({ where: 'plaque', kind: 'missing', word: 'PENDIDIKAN' }))).toBe('plaque without PENDIDIKAN');
    expect(kkOkLabel(issueKey({ where: 'header', kind: 'extra', word: 'LINGGI' }))).toBe('LINGGI added to the TAJUK');
  });
});

// The whole way round, as it runs live: the bot's reading → FORM ANUGERAH filled the bot's way → read back
// the website's way (botOrder.readOrderForm = Add to Cart's items) → the plaques checked against the reading.
describe('a bot-filled FORM ANUGERAH read back on the website', () => {
  const catalog = [{ id: 'a', code: 'PKC 263', price: 12 }];
  const kk = {
    school: 'SK TAMAN MEGAH', teacher: 'PN AISYAH',
    plaques: [
      { type: 'umum', heading: 'HARI ANUGERAH 2026', award: 'TOKOH AKADEMIK', line3: 'NUR SHAFIQAH BINTI MUHAMAD TAUFIQ', line4: '', subject: '', tahun: null, kelas: '', qty: 1, code: 'PKC 263' },
      ...[4, 5, 6].map((tahun) => ({ type: 'mp_subject', heading: 'HARI ANUGERAH 2026', award: '', line3: '', line4: '', subject: 'PENDIDIKAN SENI VISUAL', tahun, kelas: '', qty: 1, code: 'PKC 263' })),
    ],
  };
  const issuesOf = async (reading, edit = (p) => p) => {
    const buffer = (await fillOrderTemplate(fs.readFileSync('public/templates/FORM-ANUGERAH.xlsx'), { plaques: toFormPlaques(reading.plaques).map(edit) }, { DOMParser, XMLSerializer })).buffer;
    const { items } = readOrderForm(buffer, { plakCatalog: catalog, schoolLanguage: 'SK', salesman: { id: 's', name: 'S' }, details: {} });
    return checkAgainstReading(aiPlaquesOf({ schoolLanguage: 'SK', items }), [kk], [kk.school, kk.teacher]);
  };

  test('asks nothing when the salesman changed nothing', async () => {
    expect(await issuesOf(kk)).toEqual([]);
  });

  test('catches a name retyped wrong and a subject that lost a word', async () => {
    const issues = await issuesOf(kk, (p) => ({
      ...p,
      line: p.line.replace('MUHAMAD', 'MUHAMMAD'),
      ...(p.eline2 === 'TAHUN 6' ? { line: 'SENI VISUAL' } : {}),
    }));
    expect(issues.map((i) => `${i.kind} ${i.word}${i.kk ? `>${i.kk}` : ''}`).sort()).toEqual(['missing PENDIDIKAN', 'typo MUHAMMAD>MUHAMAD']);
  });
});

// The salesman's own kertas kerja: only its printed lines (kertasKerjaText.js)
describe('checkAgainstLines', () => {
  const kk = [
    'MAJLIS ANUGERAH KECEMERLANGAN 2026',
    'BIL | ANUGERAH | KUANTITI | KOD',
    '1 | PENDIDIKAN SENI VISUAL | TAHUN 1-6 | 6 | PKC 263',
    '2 | TOKOH AKADEMIK | NUR SHAFIQAH BINTI MUHAMAD TAUFIQ | 1 | GOLD',
  ];
  const codes = ['PKC 263', '18093 GOLD'];
  const issues = (p) => checkAgainstLines([p], kk, ['SK TAMAN MEGAH'], codes).map((i) => `${i.where} ${i.kind} ${i.word}${i.kk ? `>${i.kk}` : ''}`);

  test('asks nothing when the plaque has the line\'s words, the Jenis Plak code aside', () => {
    expect(issues(plaque('TOKOH AKADEMIK', 'NUR SHAFIQAH BINTI MUHAMAD TAUFIQ'))).toEqual([]);
    // the award and "TAHUN 6" are the website's own words on a subject plaque
    expect(issues(plaque('ANUGERAH MATA PELAJARAN TERBAIK', 'PENDIDIKAN SENI VISUAL', 'TAHUN 6'))).toEqual([]);
  });

  test('a word the line has and the plaque lost', () => {
    expect(issues({ ...plaque('ANUGERAH', 'SENI VISUAL', 'TAHUN 6'), header: heading })).toEqual(['plaque missing PENDIDIKAN']);
  });

  test('a name spelt differently from the kertas kerja', () => {
    expect(issues(plaque('TOKOH AKADEMIK', 'NUR SHAFIQAH BINTI MUHAMMAD TAUFIQ'))).toEqual(['plaque typo MUHAMMAD>MUHAMAD']);
  });

  test('a TAJUK word the kertas kerja never has', () => {
    expect(issues({ ...plaque('TOKOH AKADEMIK', 'NUR SHAFIQAH BINTI MUHAMAD TAUFIQ'), header: 'HARI APRESIASI 2026' })).toEqual(['header extra HARI', 'header extra APRESIASI']);
  });

  test('a word the website spells right and the file wrong is not asked about', () => {
    const file = ['② | ANUGERAH SASIAH TERPUJI | MERAH'];
    const got = checkAgainstLines([{ ...plaque('ANUGERAH SAHSIAH TERPUJI', 'NUR KHAIRA'), header: '' }], file, [], [], { wholePlaque: true });
    expect(got.map((i) => `${i.kind} ${i.word}`)).toEqual(['extra NUR', 'extra KHAIRA']);
  });

  test('a listed word against another listed word is still asked (TAHAP / TAHUN)', () => {
    const got = checkAgainstLines([{ ...plaque('TOKOH NILAM', 'TAHAP 1'), header: '' }], ['TOKOH NILAM | TAHUN 1 | 1'], [], [], { wholePlaque: true });
    expect(got.map((i) => `${i.kind} ${i.word}${i.kk ? `>${i.kk}` : ''}`)).toEqual(['typo TAHAP>TAHUN']);
  });

  test('the order\'s own Excel: a word is missing only where its line holds the whole plaque', () => {
    const file = ['② | MURID TERBAIK ALIRAN', '1 | MURID TERBAIK ALIRAN | TAHUN SATU | 59 | PKF 265', '③ | TERBAIK DI DALAM KELAS TEMPAT PERTAMA | MERAH'];
    const own = (p) => checkAgainstLines([{ ...p, header: '' }], file, [], ['PKF 265'], { wholePlaque: true }).map((i) => `${i.kind} ${i.word}`);
    expect(own(plaque('MURID TERBAIK', 'TAHUN SATU'))).toEqual(['missing ALIRAN']);
    // ORD-0542: "MURID TERBAIK TAHUN 1" — TAHUN is the website's own word, the line still holds the plaque
    expect(own(plaque('MURID TERBAIK TAHUN 1'))).toEqual(['missing ALIRAN']);
    // TEMPAT KEDUA's closest line is its sibling's (TEMPAT PERTAMA): PERTAMA isn't missing
    expect(own(plaque('TERBAIK DI DALAM KELAS', 'TEMPAT KEDUA'))).not.toContain('missing PERTAMA');
  });

  test('another event\'s file covers little of the order', () => {
    const p = plaque('JOHAN', 'PERTANDINGAN BERCERITA BAHASA INGGERIS');
    expect(linesCoverage([p], kk)).toBeLessThan(0.5);
    expect(linesCoverage([plaque('TOKOH AKADEMIK', 'NUR SHAFIQAH BINTI MUHAMAD TAUFIQ')], kk)).toBe(1);
  });
});

describe('kertasKerjaLines', () => {
  test('reads an Excel kertas kerja row by row', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['BIL', 'ANUGERAH', 'KUANTITI'], [1, 'PENDIDIKAN SENI VISUAL', 6], [], [2, 'TOKOH AKADEMIK', 1]]), 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    expect(await kertasKerjaLines(buffer, 'kk.xlsx')).toEqual(['BIL | ANUGERAH | KUANTITI', '1 | PENDIDIKAN SENI VISUAL | 6', '2 | TOKOH AKADEMIK | 1']);
  });

  test('reads a Word table row as one line', async () => {
    const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>MAJLIS ANUGERAH 2026</w:t></w:r></w:p>
      <w:tbl><w:tr>${cell('1')}${cell('PENDIDIKAN SENI VISUAL')}${cell('6')}</w:tr></w:tbl></w:body></w:document>`;
    const zip = new JSZip();
    zip.file('word/document.xml', xml);
    const buffer = await zip.generateAsync({ type: 'uint8array' });
    expect(await kertasKerjaLines(buffer, 'kk.docx', { DOMParser })).toEqual(['MAJLIS ANUGERAH 2026', '1 | PENDIDIKAN SENI VISUAL | 6']);
  });

  test('a photo has no lines', async () => {
    expect(await kertasKerjaLines(new Uint8Array([1, 2, 3]), 'page.jpg')).toBeNull();
  });
});
