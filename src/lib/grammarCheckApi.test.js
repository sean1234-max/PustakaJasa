import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('./supabaseClient', () => ({ supabase: { functions: { invoke: (...a) => invoke(...a) } } }));

const { checkEngravingText } = await import('./grammarCheckApi');

describe('checkEngravingText', () => {
  beforeEach(() => invoke.mockReset());

  it('never sends the real lineValues key (it embeds the sheet name) and maps issues back to it', async () => {
    const realKey = 'dyn::LONJAKAN::MURID%20TERBIKANG%20KOKURIKULUM::0::2';
    invoke.mockResolvedValue({
      data: { checked: true, issues: [{ lineId: 'L1', original: 'ANIGERAH', suggestion: 'ANUGERAH', kind: 'spelling', note: 'x' }] },
      error: null,
    });
    const res = await checkEngravingText([{ id: realKey, label: 'ACARA', text: 'ANIGERAH MURID TERBILANG' }]);
    const sent = invoke.mock.calls[0][1].body.lines;
    expect(sent).toEqual([{ id: 'L1', label: 'ACARA', text: 'ANIGERAH MURID TERBILANG' }]);
    expect(JSON.stringify(sent)).not.toMatch(/TERBIKANG/);
    expect(res.issues).toEqual([{ lineId: realKey, original: 'ANIGERAH', suggestion: 'ANUGERAH', kind: 'spelling', note: 'x' }]);
  });

  it('drops an issue pointing at an id it never sent', async () => {
    invoke.mockResolvedValue({ data: { checked: true, issues: [{ lineId: 'L9', original: 'A', suggestion: 'B', kind: 'spelling', note: 'x' }] }, error: null });
    const res = await checkEngravingText([{ id: 'k', label: '', text: 'A' }]);
    expect(res.issues).toEqual([]);
  });
});
