import { describe, it, expect } from 'vitest';
import { getPlakProductionMode, summarizeRowsForManual } from './exportCsv';
import { getManualPlakGroups, buildManualRemarkBlock, checkColumnTotals, checkExpansionTotals } from './importChecks';

// A minimal order — getPlakProductionMode only reads item.jenisPlak + qty.
const order = (items) => ({ id: 'ORD-1', items });

describe('getPlakProductionMode', () => {
  it('marks a Jenis Plak with qty <= 10 as manual, >= 11 as csv', () => {
    const modes = getPlakProductionMode(order([
      { id: 'a', jenisPlak: 'AK-7', qty: 2 },
      { id: 'b', jenisPlak: 'PK 020 A', qty: 30 },
    ]));
    expect(modes.get('AK-7')).toEqual({ mode: 'manual', totalQty: 2 });
    expect(modes.get('PK 020 A')).toEqual({ mode: 'csv', totalQty: 30 });
  });

  it('aggregates qty across every line sharing a Jenis Plak', () => {
    // KOSAS: PK 020 A used in two sections — 30 + 46 = 76, well over the line.
    const modes = getPlakProductionMode(order([
      { id: 'a', jenisPlak: 'PK 020 A', qty: 30 },
      { id: 'b', jenisPlak: 'PK 020 A', qty: 46 },
    ]));
    expect(modes.get('PK 020 A')).toEqual({ mode: 'csv', totalQty: 76 });
  });

  it('two lines of 1 each stay manual (2 total), not promoted to csv', () => {
    // KOSAS TOKOH: AK-7 PUTERI 1 + AK-7 PUTERA 1.
    const modes = getPlakProductionMode(order([
      { id: 'a', jenisPlak: 'AK-7', qty: 1 },
      { id: 'b', jenisPlak: 'AK-7', qty: 1 },
    ]));
    expect(modes.get('AK-7')).toEqual({ mode: 'manual', totalQty: 2 });
  });

  it('exactly 10 is manual, exactly 11 is csv (boundary)', () => {
    const modes = getPlakProductionMode(order([
      { id: 'a', jenisPlak: 'TEN', qty: 10 },
      { id: 'b', jenisPlak: 'ELEVEN', qty: 11 },
    ]));
    expect(modes.get('TEN').mode).toBe('manual');
    expect(modes.get('ELEVEN').mode).toBe('csv');
  });

  it('ignores items with no Jenis Plak', () => {
    const modes = getPlakProductionMode(order([{ id: 'a', jenisPlak: '', qty: 5 }]));
    expect(modes.size).toBe(0);
  });
});

describe('summarizeRowsForManual', () => {
  it('collapses identical plaque texts and counts them, keeping first-seen order', () => {
    const rows = [
      ['H', '', 'TOKOH AKADEMIK PUTERI', '', ''],
      ['H', '', 'TOKOH AKADEMIK PUTERA', '', ''],
      ['H', '', 'TOKOH AKADEMIK PUTERI', '', ''],
    ];
    expect(summarizeRowsForManual(rows)).toEqual([
      { text: 'TOKOH AKADEMIK PUTERI', count: 2 },
      { text: 'TOKOH AKADEMIK PUTERA', count: 1 },
    ]);
  });

  it('joins position + both event lines with a middot separator', () => {
    const rows = [['H', '', 'ANUGERAH CEMERLANG MATA PELAJARAN\nBAHASA MELAYU', 'TAHUN 4', '']];
    expect(summarizeRowsForManual(rows)[0].text)
      .toBe('ANUGERAH CEMERLANG MATA PELAJARAN\nBAHASA MELAYU  ·  TAHUN 4');
  });

  it('collapses all-blank rows into one "(tiada teks)" entry', () => {
    expect(summarizeRowsForManual([['H', '', '', '', ''], ['H', '', '', '', '']]))
      .toEqual([{ text: '(tiada teks)', count: 2 }]);
  });

  it('returns [] for no rows', () => {
    expect(summarizeRowsForManual([])).toEqual([]);
    expect(summarizeRowsForManual(undefined)).toEqual([]);
  });
});

describe('getManualPlakGroups / buildManualRemarkBlock', () => {
  // KOSAS TOKOH sheet, the small-qty mixed-plak block.
  const kosasTokoh = order([
    { id: '1', jenisPlak: 'AK-7', qty: 1 },
    { id: '2', jenisPlak: 'AK-7', qty: 1 },
    { id: '3', jenisPlak: '00S', qty: 2 },
    { id: '4', jenisPlak: 'M1902A', qty: 2 },
    { id: '5', jenisPlak: 'ACC-635 (GOLD)', qty: 2 },
    { id: '6', jenisPlak: 'PK 020 A', qty: 30 },
    { id: '7', jenisPlak: 'SM- 13230 (GOLD)', qty: 15 },
  ]);

  it('returns only the manual Jenis Plak, with combined qty', () => {
    const groups = getManualPlakGroups(kosasTokoh);
    expect(groups.map((g) => [g.jenisPlak, g.totalQty])).toEqual([
      ['AK-7', 2], ['00S', 2], ['M1902A', 2], ['ACC-635 (GOLD)', 2],
    ]);
  });

  it('builds a Malay remark block listing each manual Jenis Plak and the totals', () => {
    const block = buildManualRemarkBlock(kosasTokoh);
    expect(block).toBe([
      '── PERLU BUAT MANUAL (tiada fail CSV) ──',
      '• AK-7 — 2 keping',
      '• 00S — 2 keping',
      '• M1902A — 2 keping',
      '• ACC-635 (GOLD) — 2 keping',
      'Jumlah manual: 8 keping / 4 jenis plak',
    ].join('\n'));
  });

  it('returns an empty string when nothing is manual', () => {
    expect(buildManualRemarkBlock(order([{ id: 'a', jenisPlak: 'PK 020 A', qty: 30 }]))).toBe('');
  });
});

describe('checkColumnTotals', () => {
  // KOSAS MP THP 2: SEJARAH is 1 in TAHUN 4 and TAHUN 5, but left blank in
  // TAHUN 6 — yet every column's TOTAL row still says 12.
  const subj = (names) => names.map((name) => ({ name, qty: 1 }));
  const twelve = subj([
    'BAHASA MELAYU', 'BAHASA INGGERIS', 'MATEMATIK', 'SAINS', 'PENDIDIKAN ISLAM',
    'BAHASA ARAB', 'PENDIDIKAN SENI VISUAL', 'PENDIDIKAN JASMANI & KESIHATAN',
    'PENDIDIKAN MUZIK', 'PENDIDIKAN MORAL', 'SEJARAH', 'REKA BENTUK & TEKNOLOGI',
  ]);
  const eleven = twelve.filter((s) => s.name !== 'SEJARAH');
  const section = {
    jenisPlak: 'CRYSTAL MEDAL (BIRU GELAP)',
    statedTotals: { 'TAHUN 4': 12, 'TAHUN 5': 12, 'TAHUN 6': 12 },
    classes: [
      { tahunFrom: 'TAHUN 4', tahunTo: 'TAHUN 4', namaKelas: '', subjects: twelve },
      { tahunFrom: 'TAHUN 5', tahunTo: 'TAHUN 5', namaKelas: '', subjects: twelve },
      { tahunFrom: 'TAHUN 6', tahunTo: 'TAHUN 6', namaKelas: '', subjects: eleven },
    ],
  };

  it('flags the one column whose cells do not add up to its TOTAL', () => {
    const issues = checkColumnTotals([section]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      sectionIdx: 0, classLabel: 'TAHUN 6', computed: 11, stated: 12,
      missing: [{ name: 'SEJARAH', qty: 1 }],
    });
  });

  it('offers no "missing" when the gap is not exactly closed by absent siblings', () => {
    const s2 = {
      ...section,
      statedTotals: { 'TAHUN 6': 15 },
      classes: [section.classes[0], section.classes[2]],
    };
    const issues = checkColumnTotals([s2]);
    expect(issues[0].missing).toEqual([]); // gap is 4, SEJARAH alone is 1
  });

  it('says nothing when every column matches its TOTAL', () => {
    const ok = { ...section, classes: [section.classes[0], section.classes[1]] };
    expect(checkColumnTotals([ok])).toEqual([]);
  });

  it('says nothing when the section carries no TOTAL row', () => {
    const noTotals = { ...section, statedTotals: undefined };
    expect(checkColumnTotals([noTotals])).toEqual([]);
  });
});

describe('checkExpansionTotals', () => {
  const cls = (qty) => ({ tahunFrom: '', tahunTo: '', namaKelas: '', subjects: [{ name: 'KUANTITI', qty }] });

  it('flags a plaque code whose sections do not add up to its FRONT PG total', () => {
    const sections = [
      { jenisPlak: 'PKC 253', frontPgQty: 210, classes: [cls(120)] },
    ];
    const issues = checkExpansionTotals(sections);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ jenisPlak: 'PKC 253', computed: 120, stated: 210, sectionIdxs: [0] });
  });

  it('sums sections that share a plaque code before comparing (KOSAS PK 020 A = 30 + 46)', () => {
    const sections = [
      { jenisPlak: 'PK 020 A', frontPgQty: 76, classes: [cls(30)] },
      { jenisPlak: 'PK 020 A', frontPgQty: 76, classes: [cls(46)] },
    ];
    expect(checkExpansionTotals(sections)).toEqual([]); // 30 + 46 === 76
  });

  it('matches loose spacing between a section code and its FRONT PG entry', () => {
    // section "M1902A" vs FRONT PG "M 1902 A" — parser already resolved the
    // qty onto frontPgQty; grouping just needs the two section rows to merge.
    const sections = [
      { jenisPlak: 'M1902A', frontPgQty: 2, classes: [cls(1)] },
      { jenisPlak: 'M 1902 A', frontPgQty: 2, classes: [cls(1)] },
    ];
    expect(checkExpansionTotals(sections)).toEqual([]); // 1 + 1 === 2
  });

  it('stays silent when a section has no FRONT PG total attached', () => {
    expect(checkExpansionTotals([{ jenisPlak: 'X', classes: [cls(5)] }])).toEqual([]);
  });

  it('skips a code already covered by a column-total question', () => {
    const sections = [{ jenisPlak: 'PKC 253', frontPgQty: 210, classes: [cls(120)] }];
    expect(checkExpansionTotals(sections, [0])).toEqual([]);
  });
});
