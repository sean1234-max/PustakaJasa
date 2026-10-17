import { describe, expect, it } from 'vitest';
import { applyChatActions, buildChatRequest, buildChatTabs, undoChatChanges } from './aiChat';
import { draftPlaques } from './draftForm';
import { getLineOrder } from './exportCsv';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { resolveCategory } from '../data/catalog';

// "Ask Claude": what Claude is shown, and what of its answer reaches the order.

const draft = (lineValues = {}) => ({
  lineValues: { 'TOKOH_SHEET::0::0': 'MAJLIS ANUGERAH 2026', 'TOKOH_SHEET::0::2': 'TOKOH MURID', ...lineValues },
  matrixValues: {},
  rowsByBlock: { 'TOKOH_SHEET::0': [
    { id: 1, desc: 'TOKOH MURID', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali' },
    { id: 2, desc: 'TOKOH NILAM', qty: '1', jenisPlak: 'MP399', namaMurid: 'Siti' },
  ] },
  plakRows: {},
  columnsByBlock: {},
  visibleBlocksByCategory: {},
  plakCatalog: [{ code: 'MP399', price: 12 }],
  schoolLanguage: 'SK',
  remark: '',
  step2UploadedFiles: [{ name: 'SK TEST.xlsx', categories: ['TOKOH_SHEET'] }],
});

const TAB = 'TOKOH_SHEET::0';
const say = (d, actions, userText) => applyChatActions(d, actions, { tabs: buildChatTabs(d), userText });

describe('what Claude is shown', () => {
  it('lists only the tabs with something in them, rows as on screen', () => {
    const tabs = buildChatTabs(draft());
    expect(tabs.map((t) => t.id)).toEqual([TAB]);
    const [tab] = tabs;
    expect(tab).toMatchObject({ label: 'TOKOH', plaques: 2, draggable: true });
    expect(tab.rows.find((r) => r.slot === '0')).toMatchObject({ text: 'MAJLIS ANUGERAH 2026' });
    expect(tab.rows.find((r) => r.slot === '2')).toMatchObject({ text: 'TOKOH MURID' });
  });

  it('sends the conversation, files, Remark and tabs — never error replies', () => {
    const req = buildChatRequest(draft(), [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello' }]);
    expect(req.messages).toEqual([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello' }]);
    expect(req.files).toEqual(['SK TEST.xlsx']);
    expect(req.tabs[0]).not.toHaveProperty('catKey');
  });
});

describe('applying Claude\'s answer', () => {
  const heading = 'MAJLIS APRESIASI KECEMERLANGAN\nHAL EHWAL MURID, KOKURIKULUM DAN NILAM\nTAHUN 2026';
  const userText = `Tajuk besar:\n${heading}`;

  it('puts the user\'s own multi-line heading on TAJUK BESAR, kept as lines', () => {
    const r = say(draft(), [{ type: 'set-line', tab: TAB, slot: '0', text: heading }], userText);
    expect(r.refused).toEqual([]);
    expect(r.patch.lineValues[`${TAB}::0`]).toBe(heading);
    expect(r.done[0]).toContain('MAJLIS APRESIASI KECEMERLANGAN / HAL EHWAL MURID');
    // The production file engraves it as the event header, three lines.
    const d = { ...draft(), ...r.patch };
    const { items } = buildCategoryCartItems(d, 'TOKOH_SHEET');
    expect(items[0].detail.lines[`${TAB}::0`]).toBe(heading);
  });

  it('never puts in words the user did not type', () => {
    const r = say(draft(), [{ type: 'set-line', tab: TAB, slot: '0', text: 'MAJLIS ANUGERAH CEMERLANG 2027' }], 'make the heading nicer');
    expect(r.patch).toEqual({});
    expect(r.refused[0]).toMatch(/not in your messages/);
  });

  it('may move text that is already in the order', () => {
    const r = say(draft(), [{ type: 'set-line', tab: TAB, slot: '3', text: 'TOKOH MURID' }], 'copy row 2 to row 3');
    expect(r.refused).toEqual([]);
    expect(r.patch.lineValues[`${TAB}::3`]).toBe('TOKOH MURID');
  });

  it('ignores tabs and rows the order does not have', () => {
    const r = say(draft(), [
      { type: 'set-line', tab: 'PPKI::0', slot: '0', text: 'X' },
      { type: 'set-line', tab: TAB, slot: '9', text: 'TOKOH MURID' },
    ], 'X');
    expect(r.patch).toEqual({});
    expect(r.refused).toHaveLength(2);
  });

  it('moves the heading to the bottom — the line order the artwork file uses', () => {
    const d = draft();
    const slots = buildChatTabs(d)[0].rows.map((x) => x.slot);
    const order = [...slots.filter((s) => s !== '0'), '0'];
    const r = say(d, [{ type: 'line-order', tab: TAB, order }], 'tajuk besar at the bottom');
    expect(r.patch.lineValues[`${TAB}::refOrder`]).toBe(order.join(','));
    const items = buildCategoryCartItems({ ...d, ...r.patch }, 'TOKOH_SHEET').items;
    // Fields with no row of their own keep their place at the end.
    const lineOrder = getLineOrder(items[0], resolveCategory('TOKOH_SHEET')).split('|');
    expect(lineOrder.indexOf('event_header')).toBeGreaterThan(lineOrder.indexOf('position'));
    expect(getLineOrder(buildCategoryCartItems(d, 'TOKOH_SHEET').items[0], resolveCategory('TOKOH_SHEET')).split('|')[0]).toBe('event_header');
  });

  it('refuses a row order that drops or repeats a row', () => {
    const r = say(draft(), [{ type: 'line-order', tab: TAB, order: ['2', '0', '0'] }], 'reorder');
    expect(r.patch).toEqual({});
    expect(r.refused[0]).toMatch(/every row once/);
  });

  it('adds notes to Remark once, and undo takes back only its own changes', () => {
    const d = draft();
    const r = say(d, [
      { type: 'set-line', tab: TAB, slot: '0', text: 'MAJLIS BARU' },
      { type: 'note', text: 'Use a bigger font for the heading' },
    ], 'heading MAJLIS BARU, bigger font');
    expect(r.patch.remark).toBe('Arahan khas: Use a bigger font for the heading');
    const after = { ...d, ...r.patch, remark: `${r.patch.remark}\nTeacher's own note` };
    expect(say(after, [{ type: 'note', text: 'Use a bigger font for the heading' }], '').patch).toEqual({});
    // The user edited row 2 by hand meanwhile: undo leaves that alone.
    after.lineValues = { ...after.lineValues, [`${TAB}::2`]: 'TOKOH GURU' };
    const back = undoChatChanges(after, r.undo);
    expect(back.lineValues[`${TAB}::0`]).toBe('MAJLIS ANUGERAH 2026');
    expect(back.lineValues[`${TAB}::2`]).toBe('TOKOH GURU');
    expect(back.remark).toBe("Teacher's own note");
  });

  it('makes no change (and no undo) when Claude only answers', () => {
    const r = say(draft(), [], 'how many plaques?');
    expect(r).toEqual({ patch: {}, done: [], refused: [], undo: null });
  });
});

describe('the FORM ANUGERAH download', () => {
  it('is the order as it is on the page, with the chat\'s changes', () => {
    const d = draft();
    const r = say(d, [{ type: 'set-line', tab: TAB, slot: '0', text: 'MAJLIS BARU 2026' }], 'tajuk MAJLIS BARU 2026');
    const { plaques, skipped } = draftPlaques({ ...d, ...r.patch });
    expect(skipped).toEqual([]);
    expect(plaques.reduce((n, p) => n + p.qty, 0)).toBe(2);
    expect(plaques.every((p) => p.heading === 'MAJLIS BARU 2026' && p.code === 'MP399')).toBe(true);
  });

  it('leaves out a tab that is not ready yet, and says so', () => {
    const d = draft();
    d.rowsByBlock['TOKOH_SHEET::0'][0].jenisPlak = '';
    const { skipped } = draftPlaques(d);
    expect(skipped[0]).toMatch(/^TOKOH: /);
  });
});

describe('the server side of the chat', async () => {
  const { parseChatInput, validateChat, buildChatUserText } = await import('../../supabase/functions/read-order-file/chatSchema.ts');
  const input = parseChatInput(JSON.stringify(buildChatRequest(draft(), [{ role: 'user', text: 'Tajuk besar: MAJLIS BARU' }])));

  it('reads the request, and wants the last message to be the user\'s', () => {
    expect(input.tabs[0].id).toBe(TAB);
    expect(buildChatUserText(input)).toContain('rows can be reordered: yes');
    expect(parseChatInput(JSON.stringify({ messages: [{ role: 'assistant', text: 'hi' }], tabs: [] }))).toBeNull();
  });

  it('keeps only actions on real tabs and rows', () => {
    const c = validateChat({ reply: 'Done.', actions: [
      { type: 'set-line', tab: TAB, slot: '0', text: 'MAJLIS BARU', order: [] },
      { type: 'set-line', tab: 'NOPE::0', slot: '0', text: 'X', order: [] },
      { type: 'note', tab: null, slot: null, text: '  bigger font ', order: [] },
    ] }, input);
    expect(c.ok).toBe(true);
    expect(c.value.actions.map((a) => a.type)).toEqual(['set-line', 'note']);
    expect(validateChat({ reply: '', actions: [] }, input).ok).toBe(false);
  });
});
