import { describe, expect, test } from 'vitest';
import fs from 'fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { fillOrderTemplate } from './templateExport';
import { readOrderForm } from './botOrder';
import { aiPlaquesOf } from './reviewChecks';
import { toFormPlaques } from '../../supabase/functions/telegram-bot/formPlaques.ts';
import { checkAgainstReading, issueKey, kkOkLabel, readingCoverage } from './kertasKerjaCheck';

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
    expect(kkOkLabel(issueKey({ where: 'plaque', kind: 'typo', word: 'MUHAMMAD', kk: 'MUHAMAD' }))).toBe('MUHAMMAD (kertas kerja: MUHAMAD)');
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
