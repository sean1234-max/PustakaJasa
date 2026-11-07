// ExcelFormAgent submits the order (Sean, 2026-11-07). A linked salesman sends the Function Details list
// with the FORM ANUGERAH — as the Excel's caption, as a reply to an Excel (the bot's own filled form or his
// own), or with the Excel and the teacher's kertas kerja sent together — and the bot:
//   1. asks whatever the website's New Order would need that's missing or wrong (one school, Cikgu, phone,
//      Ketua Panitia, Terms, a Function Date at least 4 days away, SK or own logo), one question at a time;
//   2. asks for the kertas kerja when only the Excel came (a form it filled itself already has its source);
//   3. reads the Excel exactly as the website does (order.bundle.js — botOrder.js) and asks what the
//      website would ask on screen: a Jenis Plak the catalog can't place, the import's cross-check
//      questions and notes, UMUM lines, the spelling check, a possible duplicate order;
//   4. shows the order with [✅ Submit] [✖ Cancel]; Submit puts it in as the salesman (bot_submit_order,
//      0118) and answers "✅ Submitted — ORD-xxxx" with its link.
// What the chat can't fix (stock, an OTHER with no price, a category the form leaves incomplete) stops it:
// the salesman fixes the Excel and sends it again, or opens the order on the website.
// Sessions: bot_order_sessions. Buttons: callback data "o:<session id>:<answer>".

import { db } from './db.ts';
import { esc, MAX_FILE_BYTES } from './telegram.ts';
import { formBot } from './formBot.ts';
import { readDraftList } from './orderDraft.ts';
import { askedDay } from './order.ts';
import { anthropic } from './ai.ts';
import { logUsage } from './usage.ts';
import { SYSTEM_PROMPT, buildUserPrompt } from '../check-engraving-text/prompt.ts';
import { ISSUES_TOOL_SCHEMA, validateIssues, type CheckLine } from '../check-engraving-text/schema.ts';
import { nextDetailStep, readFieldAnswer, summaryHtml, orderRow, showDay, FIELD_LABEL, type Session, type FileRef } from './orderFlow.ts';
// @ts-ignore a plain JS bundle
import { readOrderForm, buildPlakTree, isCrystalCode, isCustomPlakCode, setCustomTypoWords } from './order.bundle.js';

type Msg = Record<string, any>;
type Item = { jenisPlak: string; qty: string | number; harga: number; categoryKey: string; categoryLabel?: string };
// what botOrder.js readOrderForm hands back (a plain JS bundle, so typed here)
type ReadResult = {
  error?: string; items: Item[]; total: number; stop: boolean; problems: string[]; remark: string;
  questions: {
    id: string; kind: 'plak' | 'choice' | 'note' | 'typo' | 'extra'; text: string; raw?: string; options?: { key: string; label: string }[];
    blockKey?: string; word?: string; suggestion?: string;
  }[];
  lines: (CheckLine & { blockKey: string; where: string })[]; snapshot: Record<string, unknown>;
};
type AiAllowed = () => Promise<unknown>;
type Row = Session & {
  chat_id: number; telegram_user_id: number; profile_id: string; state: string; media_group_id: string | null;
  pending: Record<string, any> | null; order_id: string | null;
};

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const SPELL_MODEL = Deno.env.get('GRAMMAR_MODEL') ?? 'claude-haiku-4-5-20251001';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ALBUM_WAIT_MS = 2500;        // the other files of an album arrive as their own messages
const SESSION_DAYS = 3;            // an unfinished order is forgotten after this
const SPELL_MAX_LINES = 40;        // as check-engraving-text
const SPELL_MAX_CHARS = 8000;

const todayMy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
const isXlsx = (doc: Msg | undefined) => /\.xlsx$/i.test(doc?.file_name || '');
const fileOf = (m: Msg | undefined): FileRef | null => {
  if (!m) return null;
  if (m.document) return { fileId: m.document.file_id, name: m.document.file_name || 'file' };
  if (Array.isArray(m.photo) && m.photo.length) return { fileId: m.photo[m.photo.length - 1].file_id, name: 'photo.jpg' };
  return null;
};
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ sessions
async function salesmanOf(telegramUserId: number) {
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', telegramUserId).maybeSingle();
  if (!link) return null;
  const { data: p } = await db.from('profiles').select('id, display_name, role, status').eq('id', link.profile_id).maybeSingle();
  return p && p.role === 'salesman' && p.status === 'active' ? { id: p.id as string, name: (p.display_name as string) || 'Salesman' } : null;
}

async function openSession(chatId: number, userId: number): Promise<Row | null> {
  const since = new Date(Date.now() - SESSION_DAYS * 86_400_000).toISOString();
  const { data } = await db.from('bot_order_sessions').select('*').eq('chat_id', chatId).eq('telegram_user_id', userId)
    .eq('state', 'open').gte('updated_at', since).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Row) || null;
}

async function save(s: Row, patch: Partial<Row>) {
  Object.assign(s, patch);
  const { error } = await db.from('bot_order_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id);
  if (error) throw error;
}

// ------------------------------------------------------------------ reading the order
let catalogCache: { at: number; tree: unknown } | null = null;
async function plakCatalog() {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.tree;
  const [{ data: rows, error }, { data: groups, error: gErr }, { data: words }] = await Promise.all([
    db.from('plak_catalog_nodes').select('id, parent_id, code, price, hidden, show_when_low, sort_order, stock_qty, stock_baseline, stock_group_key').order('sort_order', { ascending: true }),
    db.from('plak_stock_groups').select('key, stock_qty, stock_baseline'),
    db.from('custom_typo_words').select('word'),
  ]);
  if (error) throw error;
  if (gErr) throw gErr;
  // Admin's own "this word is right" list, as the website loads it at login
  setCustomTypoWords((words || []).map((w) => w.word));
  catalogCache = { at: Date.now(), tree: buildPlakTree(rows || [], groups || []) };
  return catalogCache.tree;
}

async function readOrder(s: Row, salesman: { id: string; name: string }) {
  const bytes = await formBot.downloadFile(s.excel!.fileId);
  const [y, m, d] = s.details.functionDate.split('-').map(Number);
  return readOrderForm(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    plakCatalog: await plakCatalog(), schoolLanguage: s.school?.schoolLanguage || 'SK', salesman,
    details: { picName: s.details.picName, phone: s.details.phone, funcSelected: new Date(y, m - 1, d), remark: s.details.remark || '' },
    subs: s.subs, answers: s.answers, okWords: s.ok_words,
  }) as ReadResult;
}

// The website's spelling check before Add to Cart (check-engraving-text's prompt). Advisory: any failure
// = no issues, as on the website.
async function proofread(lines: (CheckLine & { blockKey: string; where: string })[]) {
  const sent: typeof lines = [];
  let chars = 0;
  for (const l of lines) {
    if (sent.length >= SPELL_MAX_LINES || chars + l.text.length > SPELL_MAX_CHARS) break;
    sent.push({ ...l, text: l.text.slice(0, 600) });
    chars += l.text.length;
  }
  if (!sent.length) return [];
  try {
    const res = await anthropic.messages.create({
      model: SPELL_MODEL, max_tokens: 2000, system: SYSTEM_PROMPT,
      tools: [{ name: 'submit_issues', description: 'Report the engraving-text issues you are confident about.', input_schema: ISSUES_TOOL_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'submit_issues' },
      messages: [{ role: 'user', content: buildUserPrompt(sent.map(({ id, label, text }) => ({ id, label, text }))) }],
    });
    await logUsage('check_engraving', res.model || SPELL_MODEL, res.usage as any);
    const use = res.content.find((c: any) => c.type === 'tool_use') as any;
    const check = validateIssues(use?.input, new Map(sent.map((l) => [l.id, l])));
    if (!check.ok) return [];
    const byId = new Map(sent.map((l) => [l.id, l]));
    // one question per wrong word, however many lines have it
    const seen = new Set<string>();
    return check.issues.flatMap((it) => {
      const key = `${it.original.toUpperCase()}|${it.suggestion}`;
      if (seen.has(key) || it.original === it.suggestion) return [];
      seen.add(key);
      const l = byId.get(it.lineId)!;
      return [{ original: it.original, suggestion: it.suggestion, note: it.note, where: l.where, blockKey: l.blockKey }];
    });
  } catch (err) {
    console.error('spelling check failed:', err);
    await logUsage('check_engraving', SPELL_MODEL, null, null, String(err));
    return [];
  }
}

async function findDuplicates(s: Row) {
  const { data } = await db.from('orders').select('id, status, pic_name, total_amount, function_date')
    .eq('created_by', s.school!.id).neq('status', 'Cancelled').is('parent_order_id', null)
    .like('function_date', `${s.details.functionDate}%`).limit(20);
  return (data || []).filter((o) => norm(o.pic_name) === norm(s.details.picName) && norm(s.details.picName));
}

// ------------------------------------------------------------------ asking
const btn = (s: Row, answer: string, label: string): [string, string] => [label.slice(0, 60), `o:${s.id}:${answer}`.slice(0, 64)];

async function ask(s: Row, html: string, buttons: [string, string][][], pending: Record<string, any>) {
  const id = await formBot.ask(s.chat_id, null, html, [...buttons, [btn(s, 'cancel', '✖ Cancel this order')]]);
  await save(s, { pending: { ...pending, messageId: id } });
}

// Why the chat can't finish it: the order on the website, with what's known so far
async function websiteLink(s: Row) {
  if (!s.excel) return `${SITE_URL}/#/order/step1`;
  const id = crypto.randomUUID();
  const path = `${s.profile_id}/draft-${id}.xlsx`;
  const bytes = await formBot.downloadFile(s.excel.fileId);
  const { error } = await db.storage.from('order-imports').upload(path, bytes, { contentType: XLSX_TYPE });
  if (error) throw error;
  await db.from('order_drafts').insert({ id, profile_id: s.profile_id, fields: s.details, file_path: path, file_name: s.excel.name });
  return `${SITE_URL}/#/order/step1?draft=${id}`;
}

async function stopForWebsite(s: Row, why: string) {
  const link = await websiteLink(s).catch((err) => { console.error('draft for the website failed:', err); return `${SITE_URL}/#/order/step1`; });
  await save(s, { state: 'cancelled', pending: null });
  await formBot.ask(s.chat_id, null, `${why}\n\n👉 <a href="${link}">Open it on the website</a> to finish it there.`);
}

const FIELD_Q: Record<string, string> = {
  picName: 'What is the <b>Cikgu\'s name</b> (PIC)?',
  phone: 'What is the Cikgu\'s <b>phone number</b>?',
  ketuaPanitia: 'Who is the <b>Ketua Panitia</b>?',
  functionDate: 'What is the <b>Function Date</b>? (e.g. 23/11/2026)',
  shipmentDate: 'What is the <b>Shipment Date</b>? (e.g. 20/11/2026 — or "none")',
  logoRemark: 'Describe the <b>logo</b> to use (Remark).',
};

// The next thing the order needs, asked; or the summary with Submit
async function advance(s: Row, salesman: { id: string; name: string }, aiAllowed: AiAllowed): Promise<void> {
  const today = todayMy();
  const step = nextDetailStep(s, today);
  if (step?.kind === 'school') {
    // one school matches: settled without a question, go on
    if (!(await askSchool(s))) return advance(s, salesman, aiAllowed);
    return;
  }
  if (step) return askStep(s, step);

  const read = await readOrder(s, salesman);
  if (read.error) {
    const name = s.excel?.name;
    await save(s, { excel: null });
    return ask(s, `I can't read <b>${esc(name)}</b> as a FORM ANUGERAH: ${esc(read.error)}\nPlease send the FORM ANUGERAH Excel.`, [], { kind: 'excel' });
  }
  if (read.stop) return stopForWebsite(s, 'OK — this one needs to be finished by hand.');
  const q = read.questions[0];
  if (q) {
    if (q.kind === 'plak') {
      const again = s.subs.some((x) => x.whole && norm(x.to) === norm(q.raw));
      return ask(s, `${again ? '⚠ That code isn\'t in the catalog either.\n' : ''}The Jenis Plak <b>${esc(q.raw)}</b> isn't in the catalog. Type the right code (e.g. <b>PKC 263</b>, <b>W038 / B</b>).`, [], { kind: 'plak', raw: q.raw });
    }
    if (q.kind === 'typo') {
      return ask(s, `✏️ Possible typo — ${esc(q.text)}`,
        [[btn(s, 'ty:use', `Use "${q.suggestion}"`), btn(s, 'ty:keep', `Keep "${q.word}"`)]], { kind: 'typo', blockKey: q.blockKey, word: q.word, suggestion: q.suggestion });
    }
    if (q.kind === 'choice') {
      return ask(s, `❓ ${esc(q.text)}`, (q.options || []).map((o) => [btn(s, `q:${o.key}`, o.label)]), { kind: 'question', id: q.id });
    }
    return ask(s, `❓ ${esc(q.text)}`, [[btn(s, 'q:ok', q.kind === 'extra' ? '✅ Yes, engrave it' : '✅ OK, continue'), btn(s, 'q:stop', '✋ Stop — I\'ll do it on the website')]], { kind: 'question', id: q.id });
  }
  if (read.problems.length) {
    await save(s, { excel: null });
    return ask(s, [
      '⚠ This FORM ANUGERAH can\'t go in yet:',
      ...read.problems.map((p: string) => `• ${esc(p)}`),
      '',
      'Fix it in the Excel and send it to me again (the list stays as it is).',
    ].join('\n'), [], { kind: 'excel' });
  }

  // the spelling check, once (as the website's Add to Cart)
  if (!Array.isArray(s.answers._spell)) {
    const issues = (await aiAllowed()) ? await proofread(read.lines) : [];
    await save(s, { answers: { ...s.answers, _spell: issues } });
  }
  const spell = (s.answers._spell as any[]).findIndex((_, i) => !s.answers[`spell:${i}`]);
  if (spell >= 0) {
    const it = s.answers._spell[spell];
    return ask(s, `✏️ Spelling — ${esc(it.where)}:\n<b>${esc(it.original)}</b> → <b>${esc(it.suggestion)}</b>?\n${esc(it.note)}`,
      [[btn(s, `sp:${spell}:use`, `Use "${it.suggestion}"`), btn(s, `sp:${spell}:keep`, `Keep "${it.original}"`)]], { kind: 'spell', index: spell });
  }

  // a possible duplicate (the website's DuplicateOrderModal)
  if (!s.answers._dup) {
    const dups = await findDuplicates(s);
    if (dups.length) {
      await save(s, { answers: { ...s.answers, _dupFound: dups.map((o) => o.id) } });
      return ask(s, [
        `⚠ ${esc(s.school?.sekolah)} already has an order from ${esc(s.details.picName)} for ${showDay(s.details.functionDate)}:`,
        ...dups.map((o) => `• ${esc(o.id)} — ${esc(o.status)} — RM ${Number(o.total_amount).toFixed(2)}`),
        'Is this a separate order?',
      ].join('\n'), [[btn(s, 'dup:yes', '✅ Yes, a separate order'), btn(s, 'dup:no', '✋ No — stop')]], { kind: 'dup' });
    }
    await save(s, { answers: { ...s.answers, _dup: 'none' } });
  }

  const crystal = read.items.some((it: { jenisPlak: string }) => isCrystalCode(it.jenisPlak));
  return ask(s, summaryHtml(s, read.items, read.total, read.remark, crystal), [[btn(s, 'submit', '✅ Submit order')]], { kind: 'confirm' });
}

async function askStep(s: Row, step: Exclude<ReturnType<typeof nextDetailStep>, null | { kind: 'school' }>) {
  if (step.kind === 'field') {
    return ask(s, `${step.why ? `⚠ ${esc(step.why)}\n` : ''}${FIELD_Q[step.field]}`, [], { kind: 'field', field: step.field });
  }
  if (step.kind === 'terms') return ask(s, 'Which <b>Terms</b>?', [[btn(s, 'terms:L/O', 'L/O'), btn(s, 'terms:Cash', 'Cash')]], { kind: 'terms' });
  if (step.kind === 'schoolType') {
    return ask(s, '<b>Logo</b> on the plaques?', [[btn(s, 'type:SK', 'SK logo'), btn(s, 'type:NOT_SK', 'The school\'s own logo')]], { kind: 'schoolType' });
  }
  if (step.kind === 'logo') return ask(s, 'Send me the school\'s <b>logo</b> (a photo or image file).', [], { kind: 'logo' });
  if (step.kind === 'excel') return ask(s, 'Now send me the <b>FORM ANUGERAH</b> Excel (or reply the list to it).', [], { kind: 'excel' });
  return ask(s, 'Do you have the teacher\'s <b>kertas kerja</b>? Send it to me now (any file or photo), or tap below.',
    [[btn(s, 'kk:none', 'No kertas kerja')]], { kind: 'kertas' });
}

// true when it asked; false when one school matched and was taken
async function askSchool(s: Row): Promise<boolean> {
  const name = s.details.sekolah;
  const { data } = await db.from('profiles').select('id, sekolah, school_language').eq('role', 'teacher').eq('status', 'active')
    .ilike('sekolah', `%${name.replace(/[%_]/g, '')}%`).order('sekolah').limit(8);
  const rows = data || [];
  const exact = rows.filter((r) => norm(r.sekolah) === norm(name));
  const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
  if (pick) {
    await save(s, { school: { id: pick.id, sekolah: pick.sekolah, schoolLanguage: pick.school_language || 'SK' }, details: { ...s.details, sekolah: pick.sekolah } });
    return false;
  }
  if (rows.length) {
    await save(s, { answers: { ...s.answers, _schools: rows.map((r) => ({ id: r.id, sekolah: r.sekolah, schoolLanguage: r.school_language || 'SK' })) } });
    await ask(s, `Which school is <b>${esc(name)}</b>?`, rows.map((r, i) => [btn(s, `sch:${i}`, r.sekolah)]), { kind: 'school' });
    return true;
  }
  await ask(s, `I can't find the school <b>${esc(name)}</b>. Type part of its name (e.g. TAMAN MUDA).`, [], { kind: 'school' });
  return true;
}

// ------------------------------------------------------------------ messages
// Files of an album, kept so the message with the list can pick the others up
async function rememberAlbumFile(msg: Msg, withList: boolean) {
  const f = fileOf(msg);
  if (!msg.media_group_id || !f) return;
  await db.from('bot_media_files').upsert({
    chat_id: msg.chat.id, message_id: msg.message_id, media_group_id: msg.media_group_id, file_id: f.fileId, file_name: f.name, with_list: withList,
  });
}

async function albumFiles(chatId: number, group: string) {
  const { data } = await db.from('bot_media_files').select('file_id, file_name, message_id').eq('chat_id', chatId).eq('media_group_id', group).order('message_id');
  return (data || []).map((r) => ({ fileId: r.file_id as string, name: r.file_name as string }));
}

// The Excel and kertas kerja a list comes with: the message's own file(s), the Excel it replies to (and the
// kertas kerja the bot filled that Excel from), or the album it is part of
async function filesFor(msg: Msg) {
  let excel: FileRef | null = null;
  const kk: FileRef[] = [];
  const own = fileOf(msg);
  if (own) (isXlsx(msg.document) ? (excel = own) : kk.push(own));
  if (msg.media_group_id) {
    await sleep(ALBUM_WAIT_MS);
    for (const f of await albumFiles(msg.chat.id, msg.media_group_id)) {
      if (f.fileId === own?.fileId) continue;
      if (!excel && /\.xlsx$/i.test(f.name)) excel = f; else kk.push(f);
    }
  }
  const replied = msg.reply_to_message;
  if (!excel && replied?.document && isXlsx(replied.document)) {
    excel = fileOf(replied);
    const { data: src } = await db.from('bot_form_sources').select('file_id, file_name').eq('chat_id', msg.chat.id).eq('message_id', replied.message_id).maybeSingle();
    if (src) kk.push({ fileId: src.file_id, name: src.file_name });
  }
  return { excel, kk };
}

/** A message for the order chat: true when it was taken (form.ts then does nothing else with it). */
export async function handleOrderMessage(msg: Msg, aiAllowed: AiAllowed): Promise<boolean> {
  const chatId = msg.chat.id;
  const userId = Number(msg.from?.id);
  const text = String(msg.text ?? msg.caption ?? '');
  const list = readDraftList(text, todayMy());
  await rememberAlbumFile(msg, !!list);

  if (list) {
    const salesman = await salesmanOf(userId);
    if (!salesman) {
      await formBot.reply(chatId, msg.message_id, 'I don\'t know which website account you are yet. On the website, press <b>Connect Telegram</b> on your dashboard and send me the 6-digit code it shows.');
      return true;
    }
    const { excel, kk } = await filesFor(msg);
    await db.from('bot_order_sessions').update({ state: 'cancelled' }).eq('chat_id', chatId).eq('telegram_user_id', userId).eq('state', 'open');
    const { data, error } = await db.from('bot_order_sessions').insert({
      chat_id: chatId, telegram_user_id: userId, profile_id: salesman.id,
      details: list.fields, excel, kertas_kerja: kk, kertas_asked: kk.length > 0, media_group_id: msg.media_group_id ?? null,
    }).select('*').single();
    if (error) throw error;
    await formBot.reply(chatId, msg.message_id, `📋 Got it — <b>${esc(list.fields.sekolah)}</b>. Let me check everything…`);
    await advance(data as Row, salesman, aiAllowed);
    return true;
  }

  // another file of an album the list came with: picked up by that message
  if (msg.media_group_id) {
    await sleep(ALBUM_WAIT_MS);
    const { data: withList } = await db.from('bot_media_files').select('message_id').eq('chat_id', chatId)
      .eq('media_group_id', msg.media_group_id).eq('with_list', true).limit(1).maybeSingle();
    if (withList) return true;
  }

  const s = await openSession(chatId, userId);
  if (!s) return false;
  const salesman = await salesmanOf(userId);
  if (!salesman) return false;
  // no question waiting: the bot is still working on this order (e.g. collecting an album's pages)
  const p = s.pending || { kind: 'busy' };
  const file = fileOf(msg);

  if (/^\s*(cancel|batal)\s*$/i.test(text) && !file) {
    await save(s, { state: 'cancelled', pending: null });
    await formBot.reply(chatId, msg.message_id, 'Cancelled — nothing was submitted.');
    return true;
  }
  // While an order is open, an Excel is its FORM ANUGERAH (a newer one replaces it and everything is checked
  // again) and any other file is one more page of its kertas kerja — never a form for the bot to fill.
  if (file && p.kind !== 'logo') {
    if (isXlsx(msg.document)) {
      if ((msg.document.file_size || 0) > MAX_FILE_BYTES) { await formBot.reply(chatId, msg.message_id, 'That file is too big for me (20 MB at most).'); return true; }
      const replacing = !!s.excel;
      if (p.messageId) await formBot.dropButtons(chatId, p.messageId);
      await save(s, { excel: file, pending: null, answers: {}, subs: [], ok_words: [] });
      if (replacing) await formBot.reply(chatId, msg.message_id, `📄 Using <b>${esc(file.name)}</b> for this order — checking it again.`);
      await advance(s, salesman, aiAllowed);
      return true;
    }
    if (p.kind === 'excel') { await formBot.reply(chatId, msg.message_id, 'That isn\'t an Excel (.xlsx) — please send the FORM ANUGERAH.'); return true; }
    // an album's other pages: the page that found the question waiting collects them all (below)
    if (p.kind === 'busy' && msg.media_group_id) return true;
    const kk = [...s.kertas_kerja, file];
    if (msg.media_group_id) {
      await save(s, { pending: null });
      await sleep(ALBUM_WAIT_MS);
      for (const f of await albumFiles(chatId, msg.media_group_id)) {
        if (!/\.xlsx$/i.test(f.name) && !kk.some((k) => k.fileId === f.fileId)) kk.push(f);
      }
    }
    const added = kk.slice(s.kertas_kerja.length);
    await save(s, { kertas_kerja: kk, kertas_asked: true, ...(p.kind === 'kertas' ? { pending: null } : msg.media_group_id ? { pending: p.kind === 'busy' ? null : p } : {}) });
    await formBot.reply(chatId, msg.message_id, `📎 Kertas kerja added to this order: ${added.map((f) => `<b>${esc(f.name)}</b>`).join(', ')}`);
    if (p.kind === 'kertas') {
      if (p.messageId) await formBot.dropButtons(chatId, p.messageId);
      await advance(s, salesman, aiAllowed);
    }
    return true;
  }
  if (p.kind === 'logo' && file) {
    const bytes = await formBot.downloadFile(file.fileId);
    const ext = (file.name.match(/\.(png|jpe?g)$/i)?.[0] || '.jpg').toLowerCase();
    const path = `bot/${crypto.randomUUID()}${ext}`;
    const { error } = await db.storage.from('logos').upload(path, bytes, { contentType: ext === '.png' ? 'image/png' : 'image/jpeg' });
    if (error) throw error;
    const url = db.storage.from('logos').getPublicUrl(path).data.publicUrl;
    await save(s, { details: { ...s.details, logoUrl: url, logoName: file.name }, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (file) return false; // a file for something else: the form bot fills it as before

  const t = text.trim();
  if (!t) return false;
  if (p.kind === 'field') {
    const r = readFieldAnswer(p.field, t, todayMy(), askedDay);
    if ('error' in r) { await formBot.reply(chatId, msg.message_id, `⚠ ${esc(r.error)}`); return true; }
    await save(s, { details: { ...s.details, [p.field]: r.value }, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'school') {
    await save(s, { details: { ...s.details, sekolah: t.toUpperCase() }, school: null, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'plak') {
    await save(s, { subs: [...s.subs.filter((x) => !(x.whole && norm(x.from) === norm(p.raw))), { from: p.raw, to: t.toUpperCase(), whole: true }], pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'kertas' && /^(no|none|tiada|tak ada|takde)$/i.test(t)) {
    await save(s, { kertas_asked: true, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  await formBot.reply(chatId, msg.message_id, p.kind === 'excel'
    ? 'I\'m waiting for the FORM ANUGERAH Excel for this order (or type <b>cancel</b>).'
    : p.kind === 'busy' ? 'One moment — I\'m still checking this order.' : 'Please answer with the buttons above (or type <b>cancel</b>).');
  return true;
}

// ------------------------------------------------------------------ buttons
export async function handleOrderButton(cb: Msg, aiAllowed: AiAllowed) {
  const m = /^o:([0-9a-f-]{36}):(.+)$/.exec(String(cb.data || ''));
  if (!m) return formBot.answerButton(cb.id);
  const { data } = await db.from('bot_order_sessions').select('*').eq('id', m[1]).maybeSingle();
  const s = data as Row | null;
  if (!s || s.telegram_user_id !== Number(cb.from?.id)) return formBot.answerButton(cb.id, 'This isn\'t your order.');
  if (s.state !== 'open') return formBot.answerButton(cb.id, s.state === 'submitted' ? `Already submitted — ${s.order_id}` : 'This order was cancelled.');
  const msgId = cb.message?.message_id;
  if (!s.pending || s.pending.messageId !== msgId) return formBot.answerButton(cb.id, 'That question has been answered already.');
  const salesman = await salesmanOf(s.telegram_user_id);
  if (!salesman) return formBot.answerButton(cb.id, 'Your Telegram is no longer linked to the website.');
  await formBot.answerButton(cb.id);
  await formBot.dropButtons(s.chat_id, msgId);
  const a = m[2];
  const p = s.pending;

  if (a === 'cancel') {
    await save(s, { state: 'cancelled', pending: null });
    return formBot.ask(s.chat_id, msgId, 'Cancelled — nothing was submitted.');
  }
  if (a === 'submit' && p.kind === 'confirm') return submit(s, salesman, aiAllowed);
  if (a.startsWith('terms:')) await save(s, { details: { ...s.details, terms: a.slice(6) as 'L/O' | 'Cash' }, pending: null });
  else if (a.startsWith('type:')) await save(s, { details: { ...s.details, schoolType: a.slice(5) as 'SK' | 'NOT_SK' }, pending: null });
  else if (a === 'kk:none') await save(s, { kertas_asked: true, pending: null });
  else if (a.startsWith('sch:')) {
    const pick = (s.answers._schools || [])[Number(a.slice(4))];
    if (pick) await save(s, { school: pick, details: { ...s.details, sekolah: pick.sekolah }, pending: null });
  } else if (a.startsWith('q:') && p.kind === 'question') {
    const key = a.slice(2);
    if (key === 'stop') return stopForWebsite(s, 'OK — stopped here.');
    await save(s, { answers: { ...s.answers, [p.id]: key }, pending: null });
  } else if (a.startsWith('sp:') && p.kind === 'spell') {
    const [, idx, choice] = a.split(':');
    const it = s.answers._spell?.[Number(idx)];
    if (it) {
      await save(s, {
        answers: { ...s.answers, [`spell:${idx}`]: choice },
        ...(choice === 'use' ? { subs: [...s.subs, { from: it.original, to: it.suggestion }] } : { ok_words: [...s.ok_words, { blockKey: it.blockKey, word: it.original }] }),
        pending: null,
      });
    }
  } else if (a.startsWith('ty:') && p.kind === 'typo') {
    await save(s, a === 'ty:use'
      ? { subs: [...s.subs, { from: p.word, to: p.suggestion }], pending: null }
      : { ok_words: [...s.ok_words, { blockKey: p.blockKey, word: p.word }], pending: null });
  } else if (a.startsWith('dup:') && p.kind === 'dup') {
    if (a === 'dup:no') return stopForWebsite(s, 'OK — not submitted. Check the existing order first.');
    await save(s, { answers: { ...s.answers, _dup: { matches: (s.answers._dupFound || []).map((id: string) => ({ id, reasons: ['same_teacher_function_date'] })), confirmedBy: `salesman ${salesman.name}`, confirmedAt: new Date().toISOString() } }, pending: null });
  } else return;
  return advance(s, salesman, aiAllowed);
}

// ------------------------------------------------------------------ submit
async function upload(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await db.storage.from('order-imports').upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

async function submit(s: Row, salesman: { id: string; name: string }, aiAllowed: AiAllowed) {
  await save(s, { pending: null });
  // read again (the catalog and stock as they are now): anything new goes back to the questions
  const read = await readOrder(s, salesman);
  if (read.error || read.stop || read.questions.length || read.problems.length) return advance(s, salesman, aiAllowed);

  const bytes = await formBot.downloadFile(s.excel!.fileId);
  const excelPath = `${s.profile_id}/${crypto.randomUUID()}.xlsx`;
  await upload(excelPath, bytes, XLSX_TYPE);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const kertasKerja = [];
  for (const f of s.kertas_kerja) {
    const ext = (f.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] || '').toLowerCase();
    const path = `${s.profile_id}/kk-${crypto.randomUUID()}${ext}`;
    await upload(path, await formBot.downloadFile(f.fileId), 'application/octet-stream');
    kertasKerja.push({ path, name: f.name.slice(0, 200) });
  }
  const row = orderRow({
    s, salesman, items: read.items, total: read.total, remark: read.remark, datePlaced: showDay(todayMy()),
    excelFile: { path: excelPath, name: s.excel!.name.slice(0, 200), hash }, kertasKerja, snapshot: read.snapshot,
    duplicateCheck: typeof s.answers._dup === 'object' ? s.answers._dup : null,
  });
  const stock = read.items
    .map((it: { jenisPlak: string; qty: unknown }) => ({ full_path: it.jenisPlak, qty: Number(it.qty) || 0 }))
    .filter((it: { full_path: string; qty: number }) => it.full_path && it.qty > 0 && !isCustomPlakCode(it.full_path));
  const { data: orderId, error } = await db.rpc('bot_submit_order', { p_salesman: salesman.id, p_order: row, p_stock: stock });
  if (error) {
    console.error('bot_submit_order failed:', error);
    const st = /^INSUFFICIENT_STOCK:(.*):(\d+)$/.exec(error.message || '');
    const why = st ? `Not enough stock for "${st[1]}" — only ${st[2]} can be ordered now.` : `The website didn't take the order: ${error.message}`;
    return stopForWebsite(s, `⚠ Not submitted. ${esc(why)}`);
  }
  await save(s, { state: 'submitted', order_id: orderId as string });
  const crystal = read.items.some((it: { jenisPlak: string }) => isCrystalCode(it.jenisPlak));
  const link = `${SITE_URL}/#/sales/orders/${encodeURIComponent(orderId as string)}`;
  await formBot.ask(s.chat_id, null, [
    `✅ <b>Submitted — ${esc(orderId)}</b>`,
    `${esc(s.school?.sekolah)} · ${read.items.reduce((n: number, it: { qty: unknown }) => n + (Number(it.qty) || 0), 0)} pcs · RM ${Number(read.total).toFixed(2)}`,
    `👉 <a href="${link}">Open ${esc(orderId)} on the website</a>`,
    ...(crystal ? ['', `💎 Crystal artwork is <b>not confirmed</b> yet: open the order, check the <b>Crystal Preview</b>, then press <b>Confirm Artwork</b>.`] : []),
  ].join('\n'));
}

