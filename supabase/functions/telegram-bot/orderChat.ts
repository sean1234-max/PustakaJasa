// ExcelFormAgent submits the order (Sean, 2026-11-07). A linked salesman sends the Function Details list
// with the FORM ANUGERAH — as the Excel's caption, as a reply to an Excel (the bot's own filled form or his
// own), or with the Excel and the teacher's kertas kerja sent together — and the bot:
//   1. asks whatever the website's New Order would need that's missing or wrong (one school, Cikgu, phone,
//      Ketua Panitia, Terms, a Function Date at least 4 days away, SK or own logo), one question at a time;
//   2. asks for the kertas kerja when only the Excel came (a form it filled itself already has its source);
//   3. reads the Excel exactly as the website does (order.bundle.js — botOrder.js) and asks what the
//      website would ask on screen: a Jenis Plak the catalog can't place, the import's cross-check
//      questions and notes, UMUM lines, the spelling check, a possible duplicate order;
//   4. asks the Google Form's REMARK (SALES / SUMBANGAN) and shows what goes into the salesmen's Google Form
//      (googleForm.ts) to confirm, DUE DATE and QTY changeable;
//   5. shows the order with [✅ Submit] [✖ Cancel]; Submit puts it in as the salesman (bot_submit_order,
//      0118), fills the Google Form, and answers "✅ Submitted — ORD-xxxx" with its link.
// What the chat can't fix (stock, an OTHER with no price, a category the form leaves incomplete) stops it:
// the salesman fixes the Excel and sends it again, or opens the order on the website.
// Sessions: bot_order_sessions. Buttons: callback data "o:<session id>:<answer>".

import { db } from './db.ts';
import { esc, MAX_FILE_BYTES } from './telegram.ts';
import { formBot } from './formBot.ts';
import { readDraftList, listTemplate } from './orderDraft.ts';
import { askedDay } from './order.ts';
import { anthropic } from './ai.ts';
import { logUsage } from './usage.ts';
import { SYSTEM_PROMPT, buildUserPrompt } from '../check-engraving-text/prompt.ts';
import { ISSUES_TOOL_SCHEMA, validateIssues, type CheckLine } from '../check-engraving-text/schema.ts';
import { nextDetailStep, readFieldAnswer, summaryHtml, orderRow, showDay, type Session, type FileRef } from './orderFlow.ts';
import { tr, langOfProfile } from './i18n.ts';
import { saleOption, SALE_OPTIONS, formQty, formPreviewHtml, submitGoogleForm, formValuesText, dueDateProblem, readQty, FORM_ID, type FormValues } from './googleForm.ts';
import { matchSchool, schoolKey, type SchoolRow } from './schoolMatch.ts';
// @ts-ignore a plain JS bundle
import { readOrderForm, buildPlakTree, isCrystalCode, isCustomPlakCode, setCustomTypoWords, flattenPlakCatalog } from './order.bundle.js';

type Msg = Record<string, any>;
type Item = { jenisPlak: string; qty: string | number; harga: number; categoryKey: string; categoryLabel?: string };
// what botOrder.js readOrderForm hands back (a plain JS bundle, so typed here)
type ReadResult = {
  error?: string; items: Item[]; total: number; stop: boolean; problems: string[]; remark: string;
  questions: {
    id: string; kind: 'plak' | 'choice' | 'note' | 'typo' | 'extra' | 'stock'; text: string; raw?: string; options?: any[];
    code?: string; qty?: number; left?: number;
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
async function salesmanById(profileId: string | null | undefined) {
  if (!profileId) return null;
  const { data: p } = await db.from('profiles').select('id, display_name, role, status').eq('id', profileId).maybeSingle();
  return p && p.role === 'salesman' && p.status === 'active' ? { id: p.id as string, name: (p.display_name as string) || 'Salesman' } : null;
}

async function salesmanOf(telegramUserId: number) {
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', telegramUserId).maybeSingle();
  return salesmanById(link?.profile_id);
}

// Production's own groups (as form.ts): only their people may put an order in for a salesman
const PRODUCTION_GROUPS = (Deno.env.get('FORM_BOT_GROUP_IDS') ?? Deno.env.get('TELEGRAM_CHAT_ID') ?? '').split(',').map((x) => x.trim()).filter(Boolean);

// Whose order this is (Sean, 2026-11-10): the sender's own salesman account; or — Sean / Production in a
// salesman's own group — that group's salesman (ReviewAgent's link, else the one linked salesman in it).
// `onBehalf`: someone else is putting it in for him.
async function orderSalesman(msg: Msg) {
  const own = await salesmanOf(Number(msg.from?.id));
  if (own) return { ...own, onBehalf: false };
  if (msg.chat?.type === 'private' || !(await formBot.inAnyGroup(Number(msg.from?.id), PRODUCTION_GROUPS))) return null;
  const { data: g } = await db.from('salesman_groups').select('profile_id').eq('chat_id', msg.chat.id).maybeSingle();
  if (g) { const sm = await salesmanById(g.profile_id); if (sm) return { ...sm, onBehalf: true }; }
  const { data: links } = await db.from('telegram_links').select('telegram_user_id, profile_id');
  const here = [];
  for (const l of links || []) {
    if (Number(l.telegram_user_id) === Number(msg.from?.id)) continue;
    if (await formBot.inAnyGroup(Number(l.telegram_user_id), [String(msg.chat.id)])) { const sm = await salesmanById(l.profile_id); if (sm) here.push(sm); }
  }
  return here.length === 1 ? { ...here[0], onBehalf: true } : null;
}

// Neither a salesman nor in his group: what to do (instead of a bare "connect Telegram")
const NOT_A_SALESMAN = 'This Telegram isn\'t a salesman account — the salesman sends it himself, or Production sends it in his group. / 这个 Telegram 不是 salesman 帐号 — 请 salesman 自己发，或由 Production 在他的群里发。';

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
    // a code swapped for one in stock (the 'stock' question) is applied to the order, not to the file's words
    subs: s.subs.filter((x) => !x.stock), swaps: s.subs.filter((x) => x.stock), answers: s.answers, okWords: s.ok_words,
    lang: await langOfProfile(db, s.profile_id),
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

// the salesman's language (i18n.ts): tr('English', '中文')
const T = async (s: { profile_id: string }) => tr(await langOfProfile(db, s.profile_id));

// ------------------------------------------------------------------ asking
const btn = (s: Row, answer: string, label: string): [string, string] => [label.slice(0, 60), `o:${s.id}:${answer}`.slice(0, 64)];

async function ask(s: Row, html: string, buttons: [string, string][][], pending: Record<string, any>) {
  const t = await T(s);
  const id = await formBot.ask(s.chat_id, null, html, [...buttons, [btn(s, 'cancel', t('✖ Cancel', '✖ 取消'))]]);
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
  const t = await T(s);
  await formBot.ask(s.chat_id, null, `${why}\n👉 <a href="${link}">${t('Finish it on the website', '在网站完成')}</a>`);
}

const FIELD_Q: Record<string, [string, string]> = {
  picName: ['<b>Cikgu\'s name</b>?', '<b>老师名字</b>？'],
  phone: ['Cikgu\'s <b>phone number</b>?', '老师<b>电话</b>？'],
  ketuaPanitia: ['<b>Ketua Panitia</b>?', '<b>Ketua Panitia</b> 是谁？'],
  functionDate: ['<b>Function Date</b>? (e.g. 23/11/2026)', '<b>Function Date</b>？（例如 23/11/2026）'],
  shipmentDate: ['<b>Shipment Date</b>? (e.g. 20/11/2026, or "none")', '<b>Shipment Date</b>？（例如 20/11/2026，没有就打 "none"）'],
  logoRemark: ['Describe the <b>logo</b> (Remark).', '<b>Logo</b> 说明（Remark）？'],
};

const DUE_Q: [string, string] = ['Google Form <b>DUE DATE</b>? (the Shipment Date too — e.g. 20/11/2026)', 'Google Form 的 <b>DUE DATE</b>？（也是 Shipment Date — 例如 20/11/2026）'];

// The form's SALE options as buttons, three a row; typing one works too
function askSale(s: Row, name: string, t: ReturnType<typeof tr>) {
  const rows: [string, string][][] = [];
  SALE_OPTIONS.forEach((o, i) => { if (i % 3 === 0) rows.push([]); rows[rows.length - 1].push(btn(s, `sale:${i}`, o)); });
  return ask(s, t(`Google Form <b>SALE</b> has no "${esc(name)}" — which one? (tap, or type it)`, `Google Form 的 <b>SALE</b> 没有「${esc(name)}」— 选哪个？（按下面，或打出来）`), rows, { kind: 'sale' });
}

// What goes into the Google Form: ORDER DATE today, DUE DATE the Shipment Date, SALE his name as the form
// lists it (none: not filled), the website's school name, QTY every plaque but selempang (or his own number)
function formValues(s: Row, salesman: { name: string }, items: Item[]): FormValues {
  return {
    orderDate: todayMy(), dueDate: s.details.shipmentDate || '', funcDate: s.details.functionDate, sale: s.answers._sale || saleOption(salesman.name),
    school: s.school?.sekolah || s.details.sekolah, remark: s.answers._remark || '', qty: Number(s.answers._formQty) || formQty(items),
  };
}

// The next thing the order needs, asked; or the summary with Submit
async function advance(s: Row, salesman: { id: string; name: string }, aiAllowed: AiAllowed): Promise<void> {
  const today = todayMy();
  const lang = await langOfProfile(db, s.profile_id);
  const t = tr(lang);
  const step = nextDetailStep(s, today, lang);
  if (step?.kind === 'school') {
    // one school matches: settled without a question, go on
    if (!(await askSchool(s))) return advance(s, salesman, aiAllowed);
    return;
  }
  if (step) return askStep(s, step, t);

  const read = await readOrder(s, salesman);
  if (read.error) {
    const name = s.excel?.name;
    await save(s, { excel: null });
    return ask(s, t(`❌ Can't read <b>${esc(name)}</b> as FORM ANUGERAH. Send the FORM ANUGERAH Excel.`, `❌ <b>${esc(name)}</b> 读不到 FORM ANUGERAH。请发 FORM ANUGERAH 的 Excel。`), [], { kind: 'excel' });
  }
  if (read.stop) return stopForWebsite(s, t('OK — finish this one by hand.', '好 — 这张请手动完成。'));
  const q = read.questions[0];
  if (q) {
    if (q.kind === 'plak') {
      const again = s.subs.some((x) => x.whole && norm(x.to) === norm(q.raw));
      return ask(s, `${again ? t('⚠️ Not in the catalog either.\n', '⚠️ 这个也不在目录里。\n') : ''}${t(`Jenis Plak <b>${esc(q.raw)}</b> isn't in the catalog — type the right code (e.g. PKC 263).`, `Jenis Plak <b>${esc(q.raw)}</b> 不在目录里 — 请打正确的代码（例如 PKC 263）。`)}`, [], { kind: 'plak', raw: q.raw });
    }
    if (q.kind === 'stock') {
      // the codes in stock as buttons; "✏️ another code" to type one (Sean, 2026-11-10)
      const opts = (q.options || []) as { code: string; left: number | null }[];
      return ask(s, `⚠️ ${esc(q.text)}`, [
        ...opts.map((o, i) => [btn(s, `sw:${i}`, `${o.code}${o.left != null ? t(` (${o.left} left)`, `（剩 ${o.left}）`) : ''}`)]),
        [btn(s, 'sw:other', t('✏️ Another code', '✏️ 打别的代码'))],
      ], { kind: 'stock', code: q.code, options: opts.map((o) => o.code) });
    }
    if (q.kind === 'typo') {
      return ask(s, `✏️ ${t('Typo?', '错字？')} <b>${esc(q.word)}</b> → <b>${esc(q.suggestion)}</b>\n${esc(q.text)}`,
        [[btn(s, 'ty:use', `✅ ${q.suggestion}`), btn(s, 'ty:keep', t(`Keep ${q.word}`, `保留 ${q.word}`))]], { kind: 'typo', blockKey: q.blockKey, word: q.word, suggestion: q.suggestion });
    }
    if (q.kind === 'choice') {
      return ask(s, `❓ ${esc(q.text)}`, (q.options || []).map((o) => [btn(s, `q:${o.key}`, o.label)]), { kind: 'question', id: q.id });
    }
    return ask(s, `❓ ${esc(q.text)}`, [[btn(s, 'q:ok', q.kind === 'extra' ? t('✅ Yes, engrave', '✅ 要刻') : t('✅ OK', '✅ 好')), btn(s, 'q:stop', t('✋ Stop (website)', '✋ 停（去网站做）'))]], { kind: 'question', id: q.id });
  }
  if (read.problems.length) {
    await save(s, { excel: null });
    return ask(s, [
      t('⚠️ <b>Can\'t submit yet</b> — fix in the Excel, then send it again:', '⚠️ <b>还不能 submit</b> — 在 Excel 改好后再发给我：'),
      ...read.problems.slice(0, 5).map((p: string, i: number) => `${i + 1}. ${esc(p)}`),
      ...(read.problems.length > 5 ? [t(`+${read.problems.length - 5} more`, `还有 ${read.problems.length - 5} 个`)] : []),
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
    return ask(s, `✏️ ${t('Spelling?', '拼写？')} <b>${esc(it.original)}</b> → <b>${esc(it.suggestion)}</b>\n${esc(it.where)}`,
      [[btn(s, `sp:${spell}:use`, `✅ ${it.suggestion}`), btn(s, `sp:${spell}:keep`, t(`Keep ${it.original}`, `保留 ${it.original}`))]], { kind: 'spell', index: spell });
  }

  // a possible duplicate (the website's DuplicateOrderModal)
  if (!s.answers._dup) {
    const dups = await findDuplicates(s);
    if (dups.length) {
      await save(s, { answers: { ...s.answers, _dupFound: dups.map((o) => o.id) } });
      return ask(s, [
        t(`⚠️ Same Cikgu & Function Date already ordered:`, `⚠️ 同一位老师、同一个 Function Date 已经有单：`),
        ...dups.map((o) => `• ${esc(o.id)} · ${esc(o.status)} · RM ${Number(o.total_amount).toFixed(2)}`),
        t('Is this a separate order?', '这是另一张单吗？'),
      ].join('\n'), [[btn(s, 'dup:yes', t('✅ Yes, separate', '✅ 是，另一张')), btn(s, 'dup:no', t('✋ No, stop', '✋ 不是，停'))]], { kind: 'dup' });
    }
    await save(s, { answers: { ...s.answers, _dup: 'none' } });
  }

  // the Google Form (Sean, 2026-11-10): its REMARK, a DUE DATE (the Shipment Date), then its values checked
  if (!s.answers._remark) {
    return ask(s, t('<b>REMARK</b> for the Google Form?', 'Google Form 的 <b>REMARK</b>？'), [[btn(s, 'rm:SALES', 'SALES'), btn(s, 'rm:SUMBANGAN', 'SUMBANGAN')]], { kind: 'remark' });
  }
  // a name the form's SALE doesn't list (Sean, 2026-11-10): the salesman picks it
  if (!s.answers._sale && !saleOption(salesman.name)) return askSale(s, salesman.name, t);
  if (!s.details.shipmentDate) return ask(s, t(...DUE_Q), [], { kind: 'due' });
  if (!s.answers._formOk) {
    return ask(s, formPreviewHtml(formValues(s, salesman, read.items), lang), [
      [btn(s, 'fo:ok', t('✅ Right', '✅ 对'))],
      [btn(s, 'fo:due', t('✏️ Change DUE DATE', '✏️ 改 DUE DATE')), btn(s, 'fo:qty', t('✏️ Change QTY', '✏️ 改 QTY'))],
      [btn(s, 'fo:sale', t('✏️ Change SALE', '✏️ 改 SALE'))],
    ], { kind: 'form' });
  }

  const crystal = read.items.some((it: { jenisPlak: string }) => isCrystalCode(it.jenisPlak));
  return ask(s, summaryHtml(s, read.items, read.total, read.remark, crystal, lang, today), [[btn(s, 'submit', '✅ Submit')]], { kind: 'confirm' });
}

async function askStep(s: Row, step: Exclude<ReturnType<typeof nextDetailStep>, null | { kind: 'school' }>, t: ReturnType<typeof tr>) {
  if (step.kind === 'field') {
    return ask(s, `${step.why ? `⚠️ ${esc(step.why)}\n` : ''}${t(...FIELD_Q[step.field])}`, [], { kind: 'field', field: step.field });
  }
  if (step.kind === 'urgent') {
    return ask(s, t(`⚡ Ships ${showDay(s.details.shipmentDate)} — in ${step.days} day(s). That makes it an <b>URGENT</b> order. Right?`,
      `⚡ ${showDay(s.details.shipmentDate)} 出货 — ${step.days} 天内，这是 <b>URGENT</b> 订单。确定吗？`),
    [[btn(s, 'urg:yes', t('⚡ Yes, urgent', '⚡ 是，urgent')), btn(s, 'urg:change', t('✏️ Change the date', '✏️ 改 Shipment Date'))]], { kind: 'urgent' });
  }
  if (step.kind === 'terms') return ask(s, '<b>Terms</b>?', [[btn(s, 'terms:L/O', 'L/O'), btn(s, 'terms:Cash', 'Cash')]], { kind: 'terms' });
  if (step.kind === 'schoolType') {
    return ask(s, t('<b>Logo</b>?', '<b>Logo</b> 用哪个？'), [[btn(s, 'type:SK', t('SK logo', 'SK logo')), btn(s, 'type:NOT_SK', t('School\'s own logo', '学校自己的 logo'))]], { kind: 'schoolType' });
  }
  if (step.kind === 'logo') return ask(s, t('Send the school\'s <b>logo</b> (photo or image).', '请发学校的 <b>logo</b>（照片或图片）。'), [], { kind: 'logo' });
  if (step.kind === 'excel') return ask(s, t('Send the <b>FORM ANUGERAH</b> Excel.', '请发 <b>FORM ANUGERAH</b> 的 Excel。'), [], { kind: 'excel' });
  return ask(s, t('Teacher\'s <b>kertas kerja</b>? Send it now, or tap below.', '有老师的 <b>kertas kerja</b> 吗？现在发给我，或按下面。'),
    [[btn(s, 'kk:none', t('No kertas kerja', '没有 kertas kerja'))]], { kind: 'kertas' });
}

// Every school on the website (the active teacher accounts), kept a minute
let schoolsCache: { at: number; rows: SchoolRow[] } | null = null;
async function allSchools() {
  if (schoolsCache && Date.now() - schoolsCache.at < 60_000) return schoolsCache.rows;
  const rows: SchoolRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('profiles').select('id, sekolah, school_language').eq('role', 'teacher').eq('status', 'active')
      .not('sekolah', 'is', null).order('sekolah').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  schoolsCache = { at: Date.now(), rows };
  return rows;
}

const schoolOf = (r: SchoolRow) => ({ id: r.id, sekolah: r.sekolah, schoolLanguage: r.school_language || 'SK' });

// A school picked for a short form: remembered, next time it is taken without asking
async function rememberAlias(typed: string, profileId: string, by: string) {
  const key = schoolKey(typed);
  if (!key) return;
  const { error } = await db.from('school_aliases').upsert({ alias_key: key, profile_id: profileId, created_by: by });
  if (error) console.error('school alias not saved:', error);
}

// The school the salesman typed (schoolMatch.ts): the same name, a short form picked before, a name containing
// it, else the closest few as buttons with [None of these]. true when it asked; false when one was taken.
async function askSchool(s: Row): Promise<boolean> {
  const t = await T(s);
  const name = s.details.sekolah;
  const schools = await allSchools();
  const take = async (r: SchoolRow) => { await save(s, { school: schoolOf(r), details: { ...s.details, sekolah: r.sekolah } }); return false; };
  const found = matchSchool(name, schools);
  if ('pick' in found) return take(found.pick);
  const { data: alias } = await db.from('school_aliases').select('profile_id').eq('alias_key', schoolKey(name)).maybeSingle();
  const known = alias && schools.find((r) => r.id === alias.profile_id);
  if (known) return take(known);
  if (found.choices.length) {
    await save(s, { answers: { ...s.answers, _schoolTyped: name, _schools: found.choices.map(schoolOf) } });
    await ask(s, t(`Which school is <b>${esc(name)}</b>?`, `<b>${esc(name)}</b> 是哪一间？`),
      [...found.choices.map((r, i) => [btn(s, `sch:${i}`, r.sekolah)]), [btn(s, 'sch:none', t('None of these', '都不是'))]], { kind: 'school' });
    return true;
  }
  return notOnWebsite(s, name);
}

// not on the website at all (Sean, 2026-11-10): Admin adds the school, then the list is sent again
async function notOnWebsite(s: Row, name: string) {
  const t = await T(s);
  await save(s, { state: 'cancelled', pending: null });
  await formBot.ask(s.chat_id, null, t(
    `❌ <b>${esc(name)}</b> isn't on the website. Please ask Admin to add the school, then send the list again.`,
    `❌ 网站找不到 <b>${esc(name)}</b> 这间学校。请联系 admin 加这间学校，加好后再发一次清单。`));
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
    const salesman = await orderSalesman(msg);
    if (!salesman) {
      await formBot.reply(chatId, msg.message_id, NOT_A_SALESMAN);
      return true;
    }
    let { excel, kk } = await filesFor(msg);
    // no Excel with the list: the FORM ANUGERAH the bot is waiting for a list for (startFromForm)
    if (!excel) {
      const waiting = await openSession(chatId, userId);
      if (waiting?.pending?.kind === 'list' && waiting.excel) { excel = waiting.excel; kk = [...waiting.kertas_kerja, ...kk]; }
    }
    await db.from('bot_order_sessions').update({ state: 'cancelled' }).eq('chat_id', chatId).eq('telegram_user_id', userId).eq('state', 'open');
    const { data, error } = await db.from('bot_order_sessions').insert({
      chat_id: chatId, telegram_user_id: userId, profile_id: salesman.id,
      details: list.fields, excel, kertas_kerja: kk, kertas_asked: kk.length > 0, media_group_id: msg.media_group_id ?? null,
    }).select('*').single();
    if (error) throw error;
    await formBot.reply(chatId, msg.message_id, tr(await langOfProfile(db, salesman.id))(
      `📋 <b>${esc(list.fields.sekolah)}</b>${salesman.onBehalf ? ` · for ${esc(salesman.name)}` : ''} — checking…`,
      `📋 <b>${esc(list.fields.sekolah)}</b>${salesman.onBehalf ? ` · 代 ${esc(salesman.name)} 下单` : ''} — 检查中…`));
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
  const salesman = await salesmanById(s.profile_id);
  if (!salesman) return false;
  // no question waiting: the bot is still working on this order (e.g. collecting an album's pages)
  const p = s.pending || { kind: 'busy' };
  const lang = await langOfProfile(db, s.profile_id);
  const t = tr(lang);
  const file = fileOf(msg);

  // waiting only for the list: a new file is a new order (form.ts fills it / hands out a new list), and
  // ordinary chat in a group is left alone
  if (p.kind === 'list' && (file || (msg.chat?.type !== 'private' && msg.reply_to_message?.from?.is_bot !== true))) {
    if (!(/^\s*(cancel|batal)\s*$/i.test(text) && !file)) return false;
  }
  if (/^\s*(cancel|batal)\s*$/i.test(text) && !file) {
    await save(s, { state: 'cancelled', pending: null });
    await formBot.reply(chatId, msg.message_id, t('✖ Cancelled — nothing submitted.', '✖ 已取消 — 没有 submit。'));
    return true;
  }
  // While an order is open, an Excel is its FORM ANUGERAH (a newer one replaces it and everything is checked
  // again) and any other file is one more page of its kertas kerja — never a form for the bot to fill.
  if (file && p.kind !== 'logo') {
    if (isXlsx(msg.document)) {
      if ((msg.document.file_size || 0) > MAX_FILE_BYTES) { await formBot.reply(chatId, msg.message_id, t('❌ Too big (20 MB max).', '❌ 文件太大（最多 20 MB）。')); return true; }
      const replacing = !!s.excel;
      if (p.messageId) await formBot.dropButtons(chatId, p.messageId);
      await save(s, { excel: file, pending: null, answers: {}, subs: [], ok_words: [] });
      if (replacing) await formBot.reply(chatId, msg.message_id, t(`📄 Using <b>${esc(file.name)}</b> — checking again.`, `📄 改用 <b>${esc(file.name)}</b> — 重新检查。`));
      await advance(s, salesman, aiAllowed);
      return true;
    }
    if (p.kind === 'excel') { await formBot.reply(chatId, msg.message_id, t('❌ Not an Excel (.xlsx) — send the FORM ANUGERAH.', '❌ 这不是 Excel (.xlsx) — 请发 FORM ANUGERAH。')); return true; }
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
    await formBot.reply(chatId, msg.message_id, `📎 ${t('Kertas kerja added', '已加 kertas kerja')}: ${added.map((f) => esc(f.name)).join(', ')}`);
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

  const typed = text.trim();
  if (!typed) return false;
  if (p.kind === 'field') {
    const r = readFieldAnswer(p.field, typed, todayMy(), askedDay, lang);
    if ('error' in r) { await formBot.reply(chatId, msg.message_id, `⚠️ ${esc(r.error)}`); return true; }
    await save(s, { details: { ...s.details, [p.field]: r.value }, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'due') {
    const day = askedDay(typed, todayMy());
    const why = day ? dueDateProblem(day, todayMy(), s.details.functionDate, lang) : t('Can\'t read that date — e.g. 20/11/2026.', '看不懂这个日期 — 例如 20/11/2026。');
    if (why) { await formBot.reply(chatId, msg.message_id, `⚠️ ${esc(why)}`); return true; }
    // the order's Shipment Date too (Sean, 2026-11-10); a new date may be urgent, asked again in advance
    const { _formOk, ...answers } = s.answers;
    await save(s, { details: { ...s.details, shipmentDate: day }, answers, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'sale') {
    const sale = saleOption(typed);
    if (!sale) { await formBot.reply(chatId, msg.message_id, t(`⚠️ "${esc(typed)}" isn't a SALE option — tap one above.`, `⚠️「${esc(typed)}」不是 SALE 的选项 — 请按上面的。`)); return true; }
    const { _formOk, ...answers } = s.answers;
    await save(s, { answers: { ...answers, _sale: sale }, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'formqty') {
    const qty = readQty(typed);
    if (!qty) { await formBot.reply(chatId, msg.message_id, t('⚠️ Type a number, e.g. 24.', '⚠️ 请打数字，例如 24。')); return true; }
    const { _formOk, ...answers } = s.answers;
    await save(s, { answers: { ...answers, _formQty: qty }, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'school') {
    await save(s, { details: { ...s.details, sekolah: typed.toUpperCase() }, school: null, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'stockcode') {
    // the code typed must be one the catalog sells (spaces / case ignored)
    const key = (c: string) => c.replace(/\s+/g, '').toUpperCase();
    const found = (flattenPlakCatalog(await plakCatalog()) as { code: string }[]).find((x) => key(x.code) === key(typed));
    if (!found) { await formBot.reply(chatId, msg.message_id, t(`❌ <b>${esc(typed)}</b> isn't in the catalog — type it as on the website (e.g. PK 262 / A).`, `❌ 目录里没有 <b>${esc(typed)}</b> — 请照网站的写法打（例如 PK 262 / A）。`)); return true; }
    await save(s, { subs: [...s.subs.filter((x) => !(x.stock && x.from === p.code)), { from: p.code, to: found.code, stock: true }], pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'plak') {
    await save(s, { subs: [...s.subs.filter((x) => !(x.whole && norm(x.from) === norm(p.raw))), { from: p.raw, to: typed.toUpperCase(), whole: true }], pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  if (p.kind === 'kertas' && /^(no|none|tiada|tak ada|takde|没有|无)$/i.test(typed)) {
    await save(s, { kertas_asked: true, pending: null });
    await advance(s, salesman, aiAllowed);
    return true;
  }
  await formBot.reply(chatId, msg.message_id, p.kind === 'excel'
    ? t('Waiting for the FORM ANUGERAH Excel (or type <b>cancel</b>).', '在等 FORM ANUGERAH 的 Excel（或打 <b>cancel</b>）。')
    : p.kind === 'busy' ? t('One moment — still checking.', '请稍等 — 还在检查。')
    : p.kind === 'list' ? t('Copy the list above, fill it in and send it to me.', '请复制上面的清单，填好后发给我。')
    : t('Please tap a button above (or type <b>cancel</b>).', '请按上面的按钮（或打 <b>cancel</b>）。'));
  return true;
}

// ------------------------------------------------------------------ buttons
export async function handleOrderButton(cb: Msg, aiAllowed: AiAllowed) {
  const m = /^o:([0-9a-f-]{36}):(.+)$/.exec(String(cb.data || ''));
  if (!m) return formBot.answerButton(cb.id);
  const { data } = await db.from('bot_order_sessions').select('*').eq('id', m[1]).maybeSingle();
  const s = data as Row | null;
  if (!s || s.telegram_user_id !== Number(cb.from?.id)) return formBot.answerButton(cb.id, 'Not your order. / 这不是你的单。');
  const t = await T(s);
  if (s.state !== 'open') return formBot.answerButton(cb.id, s.state === 'submitted' ? t(`Already submitted — ${s.order_id}`, `已经 submit 了 — ${s.order_id}`) : t('This order was cancelled.', '这张单已取消。'));
  const msgId = cb.message?.message_id;
  if (!s.pending || s.pending.messageId !== msgId) return formBot.answerButton(cb.id, t('Already answered.', '已经回答过了。'));
  const salesman = await salesmanById(s.profile_id);
  if (!salesman) return formBot.answerButton(cb.id, t('Your Telegram is no longer linked.', '你的 Telegram 已经没有连接网站。'));
  await formBot.answerButton(cb.id);
  await formBot.dropButtons(s.chat_id, msgId);
  const a = m[2];
  const p = s.pending;

  if (a === 'cancel') {
    await save(s, { state: 'cancelled', pending: null });
    return formBot.ask(s.chat_id, msgId, t('✖ Cancelled — nothing submitted.', '✖ 已取消 — 没有 submit。'));
  }
  if (a === 'submit' && p.kind === 'confirm') return submit(s, salesman, aiAllowed);
  if (a === 'urg:yes' && p.kind === 'urgent') await save(s, { answers: { ...s.answers, _urgentOk: s.details.shipmentDate }, pending: null });
  else if (a === 'urg:change' && p.kind === 'urgent') {
    await save(s, { details: { ...s.details, shipmentDate: '' }, pending: null });
    return ask(s, t(...FIELD_Q.shipmentDate), [], { kind: 'field', field: 'shipmentDate' });
  } else if (a.startsWith('terms:')) await save(s, { details: { ...s.details, terms: a.slice(6) as 'L/O' | 'Cash' }, pending: null });
  else if (a.startsWith('type:')) await save(s, { details: { ...s.details, schoolType: a.slice(5) as 'SK' | 'NOT_SK' }, pending: null });
  else if (a === 'kk:none') await save(s, { kertas_asked: true, pending: null });
  else if (a === 'sch:none' && p.kind === 'school') return notOnWebsite(s, s.answers._schoolTyped || s.details.sekolah);
  else if (a.startsWith('sch:')) {
    const pick = (s.answers._schools || [])[Number(a.slice(4))];
    if (pick) {
      if (s.answers._schoolTyped) await rememberAlias(s.answers._schoolTyped, pick.id, salesman.id);
      await save(s, { school: pick, details: { ...s.details, sekolah: pick.sekolah }, pending: null });
    }
  } else if (a.startsWith('rm:') && p.kind === 'remark') await save(s, { answers: { ...s.answers, _remark: a.slice(3) }, pending: null });
  else if (a.startsWith('sale:') && p.kind === 'sale') {
    const sale = SALE_OPTIONS[Number(a.slice(5))];
    if (!sale) return;
    const { _formOk, ...answers } = s.answers;
    await save(s, { answers: { ...answers, _sale: sale }, pending: null });
  } else if (a.startsWith('fo:') && p.kind === 'form') {
    if (a === 'fo:due') return ask(s, t(...DUE_Q), [], { kind: 'due' });
    if (a === 'fo:sale') return askSale(s, salesman.name, t);
    if (a === 'fo:qty') return ask(s, t('Google Form <b>QTY</b>? Type the number.', 'Google Form 的 <b>QTY</b>？请打数字。'), [], { kind: 'formqty' });
    await save(s, { answers: { ...s.answers, _formOk: true }, pending: null });
  } else if (a.startsWith('q:') && p.kind === 'question') {
    const key = a.slice(2);
    if (key === 'stop') return stopForWebsite(s, t('OK — stopped.', '好 — 已停。'));
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
  } else if (a.startsWith('sw:') && p.kind === 'stock') {
    if (a === 'sw:other') return ask(s, t(`Which code instead of <b>${esc(p.code)}</b>? Type it (e.g. PK 262 / A).`, `<b>${esc(p.code)}</b> 换成哪个代码？请打出来（例如 PK 262 / A）。`), [], { kind: 'stockcode', code: p.code });
    const to = p.options?.[Number(a.slice(3))];
    if (to) await save(s, { subs: [...s.subs.filter((x) => !(x.stock && x.from === p.code)), { from: p.code, to, stock: true }], pending: null });
  } else if (a.startsWith('ty:') && p.kind === 'typo') {
    await save(s, a === 'ty:use'
      ? { subs: [...s.subs, { from: p.word, to: p.suggestion }], pending: null }
      : { ok_words: [...s.ok_words, { blockKey: p.blockKey, word: p.word }], pending: null });
  } else if (a.startsWith('dup:') && p.kind === 'dup') {
    if (a === 'dup:no') return stopForWebsite(s, t('OK — not submitted. Check the existing order first.', '好 — 没有 submit。请先看看已有的那张单。'));
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
    const t = await T(s);
    const why = st ? t(`Not enough stock for "${st[1]}" — only ${st[2]} left.`, `「${st[1]}」库存不够 — 只剩 ${st[2]}。`) : t(`The website refused it: ${error.message}`, `网站没收这张单：${error.message}`);
    return stopForWebsite(s, `⚠️ ${t('Not submitted.', '没有 submit。')} ${esc(why)}`);
  }
  await save(s, { state: 'submitted', order_id: orderId as string });
  const crystal = read.items.some((it: { jenisPlak: string }) => isCrystalCode(it.jenisPlak));
  const link = `${SITE_URL}/#/sales/orders/${encodeURIComponent(orderId as string)}`;
  const t = await T(s);
  const pcs = read.items.reduce((n: number, it: { qty: unknown }) => n + (Number(it.qty) || 0), 0);
  // then the Google Form (googleForm.ts); the order is in whatever happens to it
  const v = formValues(s, salesman, read.items);
  const formUrl = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;
  const filled = v.sale ? await submitGoogleForm(v) : false;
  await save(s, { answers: { ...s.answers, _googleForm: !v.sale ? 'no_sale' : filled ? 'filled' : 'failed' } });
  const formLine = filled ? t('📝 Google Form filled too.', '📝 Google Form 也填好了。')
    : !v.sale ? t(`📝 SALE has no "${esc(salesman.name)}" — fill the <a href="${formUrl}">Google Form</a> by hand.`, `📝 SALE 选项里没有 ${esc(salesman.name)} — <a href="${formUrl}">Google Form</a> 请手动填。`)
    : `${t('⚠️ Google Form not filled — please fill it by hand', '⚠️ Google Form 没填到，请手动填')}: <a href="${formUrl}">Google Form</a>\n<pre>${esc(formValuesText(v))}</pre>`;
  await formBot.ask(s.chat_id, null, [
    `✅ <b>${t('Order submitted successfully', '订单已成功 submit')} · ${esc(orderId)}</b>`,
    `${esc(s.school?.sekolah)} · ${t(`${pcs} pcs`, `${pcs} 块`)} · RM ${Number(read.total).toFixed(2)}`,
    `👉 <a href="${link}">${t('Open on the website', '在网站打开')}</a>`,
    formLine,
    ...(crystal ? [t('💎 Crystal artwork not confirmed — check Crystal Preview, then Confirm Artwork.', '💎 Crystal 的图还没确认 — 打开订单看 Crystal Preview，再按 Confirm Artwork。')] : []),
  ].join('\n'));
}


// ------------------------------------------------------------------ the list, handed out
// The list to fill (Sean, 2026-11-10): the bot hands it out — copy, fill in, send back — with what it already
// knows filled in (the school and teacher it read from the kertas kerja).
export function listPromptHtml(lang: 'en' | 'zh', known: { sekolah?: string; cikgu?: string } = {}) {
  return [
    tr(lang)('📋 <b>To submit:</b> copy this list, fill it in and send it to me (as a reply to the Excel).', '📋 <b>要 submit：</b>复制下面的清单，填好后发给我（回复那份 Excel）。'),
    `<pre>${esc(listTemplate(known))}</pre>`,
  ].join('\n');
}

/**
 * A FORM ANUGERAH with no list yet — sent by the salesman, or just filled by the bot (form.ts): kept as this
 * chat's order waiting for its list, and the list handed out. `kertasKerja`: the teacher's file it came from.
 */
export async function startFromForm(msg: Msg, excel: FileRef, kertasKerja: FileRef[], known: { sekolah?: string; cikgu?: string } = {}) {
  const chatId = msg.chat.id;
  const userId = Number(msg.from?.id);
  const salesman = await orderSalesman(msg);
  const lang = salesman ? await langOfProfile(db, salesman.id) : 'zh';
  const promptId = await formBot.ask(chatId, msg.message_id, listPromptHtml(lang, known));
  if (!salesman) {
    await formBot.ask(chatId, null, NOT_A_SALESMAN);
    return;
  }
  await db.from('bot_order_sessions').update({ state: 'cancelled' }).eq('chat_id', chatId).eq('telegram_user_id', userId).eq('state', 'open');
  const { error } = await db.from('bot_order_sessions').insert({
    chat_id: chatId, telegram_user_id: userId, profile_id: salesman.id, details: {}, excel,
    kertas_kerja: kertasKerja, kertas_asked: kertasKerja.length > 0, pending: { kind: 'list', messageId: promptId },
  });
  if (error) throw error;
}
