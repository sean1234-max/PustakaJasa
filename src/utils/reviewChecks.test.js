import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { aiIssuesToReview, aiPlaquesOf, checkPlaque, checkExcel, merahChoices, reviewOrder, rowWithout } from './reviewChecks';

const plaque = (over = {}) => ({ header: 'HARI ANUGERAH KECEMERLANGAN 2026', position: 'JOHAN', line1: '', line2: '', positionBlack: false, ...over });
const rules = (issues) => issues.map((i) => i.rule);

describe('checkPlaque', () => {
  it('passes a normal plaque', () => {
    expect(checkPlaque(plaque({ line1: 'TAHUN 1' }), { umum: false })).toEqual([]);
  });

  it('flags a template hint left in (J1)', () => {
    const issues = checkPlaque(plaque({ line1: '(IKUT SUBJEK)' }), { umum: false });
    expect(rules(issues)).toEqual(['J1']);
    expect(issues[0].level).toBe('fix');
  });

  it('flags "SEPERTI DI BAWAH" hints too (J1)', () => {
    expect(rules(checkPlaque(plaque({ line2: '(TAHUN SEPERTI DI BAWAH)' }), { umum: false }))).toEqual(['J1']);
  });

  it('flags ANUGERAH on a black line outside ORDER LAIN-LAIN (C3)', () => {
    const issues = checkPlaque(plaque({ position: '', line1: 'ANUGERAH IKON KELAS' }), { umum: false });
    expect(rules(issues)).toEqual(['C3']);
    expect(issues[0].level).toBe('fix');
  });

  it('asks about ANUGERAH on a black line in ORDER LAIN-LAIN (B1)', () => {
    const issues = checkPlaque(plaque({ position: 'ANUGERAH KHAS', positionBlack: true }), { umum: true });
    expect(rules(issues)).toEqual(['B1']);
    expect(issues[0].level).toBe('ask');
  });

  it('asks about a subject that is not red (B1)', () => {
    expect(rules(checkPlaque(plaque({ position: 'ANUGERAH CEMERLANG', line1: 'BAHASA MELAYU' }), { umum: false }))).toEqual(['B1']);
  });

  it('wants the rank red before ANUGERAH / TOKOH (R1)', () => {
    const issues = checkPlaque(plaque({ position: 'ANUGERAH CEMERLANG', line1: 'KEDUA' }), { umum: false });
    expect(rules(issues)).toEqual(['R1']);
    expect(issues[0].level).toBe('fix');
    expect(rules(checkPlaque(plaque({ position: 'TOKOH SUKAN', line1: 'TEMPAT KETIGA' }), { umum: true }))).toEqual(['R1']);
  });

  it('leaves ANUGERAH / TOKOH black when the rank is the red line', () => {
    expect(checkPlaque(plaque({ position: 'JOHAN', line1: 'ANUGERAH PERMATA NILAM' }), { umum: true })).toEqual([]);
    expect(checkPlaque(plaque({ position: 'NAIB JOHAN', line1: 'TOKOH NILAM' }), { umum: false })).toEqual([]);
  });

  it('leaves a red ANUGERAH / rank / subject alone', () => {
    expect(checkPlaque(plaque({ position: 'ANUGERAH BAHASA MELAYU PERTAMA' }), { umum: false })).toEqual([]);
  });

  it('asks when a line repeats words already in TAJUK BESAR (D1)', () => {
    const issues = checkPlaque(plaque({ header: 'MAJLIS GRADUASI PRASEKOLAH 2026', line1: 'PRASEKOLAH' }), { umum: false });
    expect(rules(issues)).toEqual(['D1']);
    expect(issues[0].level).toBe('ask');
  });

  it('does not treat a year or a "-" line as a repeat', () => {
    expect(checkPlaque(plaque({ line1: '2026' }), { umum: false })).toEqual([]);
    expect(checkPlaque(plaque({ line1: '-' }), { umum: false })).toEqual([]);
  });

  it('flags a dictionary typo (F1)', () => {
    const issues = checkPlaque(plaque({ header: 'HARI ANUGERAH KECEMERLANGN 2026' }), { umum: false });
    expect(rules(issues)).toEqual(['F1']);
    expect(issues[0].text).toContain('KECEMERLANGN');
  });

  it('skips a word the teacher confirmed (wordsOk)', () => {
    expect(checkPlaque(plaque({ header: 'HARI ANUGERAH KECEMERLANGN 2026' }), { umum: false, okWords: ['KECEMERLANGN'] })).toEqual([]);
  });
});

describe('reviewOrder', () => {
  const item = (over = {}) => ({ id: 'i1', categoryKey: 'TOKOH', blockIdx: 0, jenisPlak: 'PKF 265', unitPrice: 10, detail: { lines: {} }, ...over });
  // a CSV row: event_header, year, position, event_line_1, event_line_2, jenis_plak, category, line_order, position_black
  const csv = (position, line1 = '') => ['HARI ANUGERAH KECEMERLANGAN 2026', '', position, line1, '', 'PKF 265', 'TOKOH', '', ''];
  const rowsOf = (plaques) => () => plaques;

  it('returns nothing for an order with no items', () => {
    expect(reviewOrder({ items: [] })).toEqual([]);
  });

  it('flags an OTHER Jenis Plak with no code or price (E1)', () => {
    const issues = reviewOrder({ items: [item({ jenisPlak: 'OTHER', unitPrice: 0 })] }, rowsOf([]));
    expect(rules(issues)).toEqual(['E1']);
  });

  it('groups the same problem across plaques into one issue with a count', () => {
    const issues = reviewOrder({ items: [item()] }, rowsOf([csv('JOHAN', '(IKUT SUBJEK)'), csv('JOHAN', '(IKUT SUBJEK)'), csv('JOHAN', '(IKUT SUBJEK)')]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'J1', count: 3 });
  });

  it('asks about MERAH once per sheet, listing every word', () => {
    const issues = reviewOrder({ items: [item({ categoryLabel: 'MP THP 1' })] }, rowsOf([csv('ANUGERAH CEMERLANG', 'BAHASA MELAYU'), csv('ANUGERAH CEMERLANG', 'MATEMATIK')]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'B1', count: 2 });
    expect(issues[0].text).toBe('Not red on MP THP 1: BAHASA MELAYU, MATEMATIK — ask the salesman if they should be MERAH');
  });

  it('lists fix issues before ask issues', () => {
    const issues = reviewOrder({ items: [item()] }, rowsOf([csv('ANUGERAH CEMERLANG', 'BAHASA MELAYU'), csv('JOHAN', '(IKUT TAHUN)')]));
    expect(issues.map((i) => i.level)).toEqual(['fix', 'ask']);
  });
});

describe('merahChoices', () => {
  // ORDER LAIN-LAIN: PERTAMA is red by default, so ANUGERAH IKON KELAS prints black
  const umum = (extra = {}) => ({
    items: [{
      id: 'i1', categoryKey: 'UMUM', blockIdx: 0, jenisPlak: 'PKF 265', unitPrice: 10,
      detail: { lines: { 'UMUM::0::0': 'MAJLIS ANUGERAH 2026', 'UMUM::0::1': 'ANUGERAH IKON KELAS', 'UMUM::0::2': 'PERTAMA', ...extra }, rows: [{ id: 'r1', qty: 1 }] },
    }],
  });
  const POSITION = 2;

  it('does not ask about the black ANUGERAH line when the rank (PERTAMA) is red', () => {
    expect(reviewOrder(umum())).toEqual([]);
  });

  it('gives the plaque as it is (black) and with the line red', () => {
    const choices = merahChoices(umum(), 'i1', 'ANUGERAH IKON KELAS');
    expect(choices.key).toBe('UMUM::0::umumRed');
    expect(choices.black.row[POSITION]).toBe('PERTAMA');
    expect(choices.red.row[POSITION]).toBe('ANUGERAH IKON KELAS');
  });

  it('flags the rank once ANUGERAH takes the red line instead (R1)', () => {
    const choices = merahChoices(umum(), 'i1', 'ANUGERAH IKON KELAS');
    expect(reviewOrder(umum({ 'UMUM::0::umumRed': choices.black.value }))).toEqual([]);
    expect(reviewOrder(umum({ 'UMUM::0::umumRed': choices.red.value })).map((i) => i.rule)).toEqual(['R1']);
  });

  it('returns null for an item that is not in the order', () => {
    expect(merahChoices(umum(), 'nope', 'X')).toBeNull();
  });
});

describe('checkExcel', () => {
  const xlsxOf = (sheets) => {
    const wb = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, aoa]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name));
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  };
  const frontPg = [['SALES :', 'SEAN'], [], ['JENIS PLAK', 'QTY'], ['PK 261 / A', 50], ['PKF 265', 10]];
  const order = { items: [{ id: 'i1', categoryKey: 'UMUM', jenisPlak: 'PK 261 / A', qty: 45 }] };

  it('asks when FRONT PG and the order disagree on a Jenis Plak total (I4)', () => {
    const issues = checkExcel(order, xlsxOf({ 'FRONT PG': frontPg }), 'a.xlsx');
    expect(issues.find((i) => i.rule === 'I4')).toMatchObject({ level: 'ask', text: expect.stringContaining('PK 261 / A') });
  });

  it('asks about a FRONT PG Jenis Plak the order does not have (I3)', () => {
    const issues = checkExcel(order, xlsxOf({ 'FRONT PG': frontPg }), 'a.xlsx');
    expect(issues.find((i) => i.rule === 'I3')).toMatchObject({ level: 'ask', text: expect.stringContaining('PKF 265') });
  });

  it('is quiet when FRONT PG matches the order', () => {
    const match = { items: [{ ...order.items[0], qty: 50 }, { id: 'i2', categoryKey: 'UMUM', jenisPlak: 'PKF 265', qty: 10 }] };
    expect(checkExcel(match, xlsxOf({ 'FRONT PG': frontPg }), 'a.xlsx').filter((i) => i.rule.startsWith('I'))).toEqual([]);
  });

  it('matches the website\'s "OTHER - CPH B" to FRONT PG\'s "CPH / B"', () => {
    const other = { items: [{ id: 'i1', categoryKey: 'KEHADIRAN', jenisPlak: 'OTHER - CPH B', qty: 19 }] };
    expect(checkExcel(other, xlsxOf({ 'FRONT PG': [['JENIS PLAK', 'QTY'], ['CPH / B', 19]] }), 'a.xlsx')).toEqual([]);
  });

  it('reads nothing from a file that is not an Excel', () => {
    expect(checkExcel(order, new Uint8Array([1, 2, 3]).buffer, 'a.pdf')).toEqual([]);
  });
});

describe('where an issue is', () => {
  it('names the sheet, the plaque and the words to look for', () => {
    const row = ['MAJLIS GRADUASI PRASEKOLAH 2026', '', 'JOHAN', 'PRASEKOLAH', '', 'PKF 265', 'ORDER LAIN-LAIN', '', ''];
    const [issue] = reviewOrder({ items: [{ id: 'i1', categoryKey: 'UMUM', categoryLabel: 'ORDER LAIN-LAIN', jenisPlak: 'PKF 265', unitPrice: 10, detail: { lines: {} } }] }, () => [row]);
    expect(issue).toMatchObject({ rule: 'D1', sheet: 'ORDER LAIN-LAIN', categoryKey: 'UMUM', find: 'PRASEKOLAH', row });
  });

  it('takes one line off a plaque for the "-" picture', () => {
    const row = ['MAJLIS PRASEKOLAH', '', 'JOHAN', 'PRASEKOLAH', '', 'PKF 265'];
    expect(rowWithout(row, 'PRASEKOLAH')).toEqual(['MAJLIS PRASEKOLAH', '', 'JOHAN', '', '', 'PKF 265']);
  });
});

describe('the AI half', () => {
  const order = { items: [{ id: 'i1', categoryKey: 'TOKOH', categoryLabel: 'TOKOH', jenisPlak: 'PKF 265', unitPrice: 10, detail: { lines: {} } }] };
  const row = (red, black) => ['HARI ANUGERAH KECEMERLANGAN 2026', '', red, black, '', 'PKF 265', 'TOKOH', '', ''];

  it('sends each distinct plaque once, counting the repeats', () => {
    const items = order.items.map((it) => ({ ...it, detail: { lines: {} } }));
    const plaques = aiPlaquesOf({ items }, () => [row('JOHAN', 'ALI'), row('JOHAN', 'ALI'), row('NAIB JOHAN', 'ABU')]);
    expect(plaques.map((p) => [p.id, p.red, p.count])).toEqual([['P1', 'JOHAN', 2], ['P2', 'NAIB JOHAN', 1]]);
  });

  it('turns the model\'s answer into issues placed on the first plaque', () => {
    const plaques = aiPlaquesOf(order, () => [row('JOHAN', 'ALI'), row('NAIB JOHAN', 'ABU')]);
    const [issue] = aiIssuesToReview([{ rule: 'I5', plaqueIds: ['P1', 'P2', 'P9'], message: 'Has a student name', suggestion: '' }], plaques);
    expect(issue).toMatchObject({ rule: 'I5', level: 'fix', ai: true, count: 2, sheet: 'TOKOH', categoryKey: 'TOKOH', find: 'JOHAN' });
  });

  it('drops an answer on an unknown rule or plaque', () => {
    const plaques = aiPlaquesOf(order, () => [row('JOHAN', 'ALI')]);
    expect(aiIssuesToReview([{ rule: 'X9', plaqueIds: ['P1'], message: 'x' }, { rule: 'F2', plaqueIds: ['P7'], message: 'y' }], plaques)).toEqual([]);
  });
});

describe('I5 name charge', () => {
  const rowOf = (jenisPlak) => ['ANUGERAH INSPIRASI GURU 2026', '', 'KEHADIRAN TERBAIK', 'NORAZAM B. AHMAD', '', jenisPlak, 'X', '', ''];
  const plaques = [
    { id: 'P1', sheet: 'X', header: '', red: 'A', black: [], count: 1, categoryKey: 'X', row: rowOf('CRYSTAL / 80-B / DESIGN 1') },
    { id: 'P2', sheet: 'X', header: '', red: 'B', black: [], count: 1, categoryKey: 'X', row: rowOf('SONGKET / A / RED') },
    { id: 'P3', sheet: 'X', header: '', red: 'C', black: [], count: 2, categoryKey: 'X', row: rowOf('PKF 265') },
  ];
  const nameIssue = (ids) => [{ rule: 'I5', plaqueIds: ids, message: 'Has a name', suggestion: '' }];

  it('leaves out crystals and songkets — their price includes the name', () => {
    expect(aiIssuesToReview(nameIssue(['P1', 'P2']), plaques)).toEqual([]);
  });

  it('leaves out VB, 57166 A, SHINING STICKER A, ALUMINIUM PLATE A, WOOD ENGRAVED A too', () => {
    const more = ['VB 12', '57166 / A', 'SHINING STICKER A', 'ALUMINIUM PLATE A', 'WOOD ENGRAVED A']
      .map((code, i) => ({ id: `Q${i}`, sheet: 'X', header: '', red: 'A', black: [], count: 1, categoryKey: 'X', row: rowOf(code) }));
    expect(aiIssuesToReview(nameIssue(more.map((p) => p.id)), more)).toEqual([]);
  });

  it('still asks for the RM1 on a plaque', () => {
    expect(aiIssuesToReview(nameIssue(['P1', 'P3']), plaques)).toMatchObject([{ rule: 'I5', count: 2, find: 'C' }]);
  });
});
