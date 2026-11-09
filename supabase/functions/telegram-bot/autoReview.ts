// ReviewAgent reviews every order by itself (Sean, 2026-11-07). The heart of a review is the website's
// order against the teacher's kertas kerja — words, spelling, quantities, Jenis Plak (compareFiles, the
// same compare as "@PjsbReviewAgent check ORD-xxxx") — and then which lines should be red (the website AI
// Review's own program rules B1 / R1 / C3, reviewChecks.js).
//   • An order is reviewed when it comes in for review, and again when it changes (the salesman's Edit
//     Order, Production's Corrected Excel): `version` is the order's items + the files read.
//   • Nothing found: no message — the review list shows 🟢 (telegram-notify).
//   • Something found: in the salesman's own group (salesman_groups, "@PjsbReviewAgent link"), in his
//     language (i18n.ts): one short headline (the list folded), then the questions one at a time with
//     buttons — he taps; only "✏️ Neither" asks him to type. When all are answered, one summary for
//     Sean — 💬 on the list. No group for him: asked in the Production group instead.
//   • It never changes an order and never presses Done Review (Sean: not until it has proved itself).
// Run by telegram-notify every 3 minutes (?job=review): one order per run — a compare takes 1–2 minutes.

import { db } from './db.ts';
import { esc } from './telegram.ts';
import { readFile, type FileContent } from './files.ts';
import { compareFiles } from './ai.ts';
import { orderPlaquesText } from './order.ts';
import { teacherFiles, reportHtml, reviewQuestions, questionHtml, answerLabel, summaryHtml, askForWords, type FileRef, type Diff, type Red, type Answer } from './reviewReport.ts';
import { tr, langOfProfile, langOfTelegramUser, type Lang } from './i18n.ts';
// @ts-ignore a plain JS bundle
import { reviewOrder } from './order.bundle.js';

type Bot = {
  reply: (chatId: number | string, replyTo: number, html: string) => Promise<void>;
  ask: (chatId: number | string, replyTo: number | null, html: string, buttons?: [string, string][][]) => Promise<number | null>;
  answerButton: (callbackId: string, note?: string) => Promise<void>;
  editText: (chatId: number | string, messageId: number, html: string) => Promise<void>;
  inAnyGroup: (userId: number, chatIds: string[]) => Promise<boolean>;
};
type Msg = Record<string, any>;
type Order = {
  id: string; sekolah: string; sales: string | null; salesman_id: string | null; items: any[]; created_at: string;
  kertas_kerja_files: FileRef[] | null; import_files: FileRef[] | null; import_file_path: string | null; import_file_name: string | null;
};

const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const RED_RULES = ['B1', 'R1', 'C3'];
const STALE_MS = 15 * 60_000;      // a review "running" this long died: try again
const MAX_FILES = 6;               // pages of one kertas kerja read together
const ORDER_FIELDS = 'id, sekolah, sales, salesman_id, items, created_at, kertas_kerja_files, import_files, import_file_path, import_file_name';

export async function orderVersion(o: Order) {
  const text = JSON.stringify({ items: o.items || [], files: teacherFiles(o).map((f) => f.path) });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The next order to review: waiting for review, never reviewed in this state (or a review that died)
async function nextOrder() {
  const { data: orders, error } = await db.from('orders').select(ORDER_FIELDS)
    .eq('status', 'Reviewing Order').is('reviewed_at', null).is('cancelled_at', null)
    .not('id', 'like', 'ORD-TEST-%').order('created_at', { ascending: true }).limit(60);
  if (error) throw error;
  if (!orders?.length) return null;
  const { data: reviews } = await db.from('order_auto_reviews').select('order_id, version, status, started_at').in('order_id', orders.map((o) => o.id));
  const byId = new Map((reviews || []).map((r) => [r.order_id, r]));
  for (const o of orders as Order[]) {
    const v = await orderVersion(o);
    const r = byId.get(o.id);
    if (!r) return { o, v };
    if (r.status === 'running') { if (Date.now() - Date.parse(r.started_at) > STALE_MS) return { o, v }; continue; }
    if (r.version !== v) return { o, v };
  }
  return null;
}

async function readTeacherFiles(files: FileRef[]) {
  const read: { content: FileContent; name: string; path: string }[] = [];
  for (const f of files.slice(0, MAX_FILES)) {
    const { data, error } = await db.storage.from('order-imports').download(f.path);
    if (error || !data) { console.error('auto review: download failed', f.path, error?.message); continue; }
    const content = readFile(new Uint8Array(await data.arrayBuffer()), f.name || f.path);
    if (content) read.push({ content, name: f.name || f.path, path: f.path });
  }
  return read;
}

// The red-line questions: the website AI Review's program rules, nothing the model has to judge
export function redLines(order: { items: any[] }): Red[] {
  return (reviewOrder(order) as Red[]).filter((i) => RED_RULES.includes(i.rule))
    .map(({ rule, level, text, sheet, count, find, wordList, word }) => ({ rule, level, text, sheet, count, find, wordList, word }));
}

// Where to ask: the salesman's own group (with him mentioned), else the Production group
async function whereToAsk(o: Order, lang: Lang) {
  const t = tr(lang);
  const { data: link } = o.salesman_id ? await db.from('telegram_links').select('telegram_user_id').eq('profile_id', o.salesman_id).maybeSingle() : { data: null };
  const name = esc(o.sales || 'Salesman');
  const mention = link ? `<a href="tg://user?id=${link.telegram_user_id}">${name}</a>` : name;
  if (o.salesman_id) {
    const { data: g } = await db.from('salesman_groups').select('chat_id').eq('profile_id', o.salesman_id).order('linked_at', { ascending: false }).limit(1).maybeSingle();
    if (g) return { chatId: g.chat_id as number, mention };
  }
  return { chatId: CHAT_ID, mention: `${mention} ${t('(no group linked — please forward)', '（还没 link 群 — 请转发）')}` };
}

const buttonsFor = (orderId: string, x: { n: number; options: { key: string; label: string }[] }): [string, string][][] =>
  [x.options.map((o) => [o.label, `r:${orderId}:${x.n}:${o.key}`.slice(0, 64)] as [string, string])];

/** One order reviewed (or nothing to do). Returns what happened, for the caller's log. */
export async function runReviewJob(bot: Bot, aiAllowed: () => Promise<unknown>) {
  const next = await nextOrder();
  if (!next) return { idle: true };
  if (!(await aiAllowed())) return { budget: 'used up' };
  const { o, v } = next;
  const started = { order_id: o.id, version: v, status: 'running', started_at: new Date().toISOString(), finished_at: null };
  const { error: claimError } = await db.from('order_auto_reviews').upsert(started);
  if (claimError) throw claimError;
  const finish = (fields: Record<string, unknown>) => db.from('order_auto_reviews').update({ ...fields, finished_at: new Date().toISOString() }).eq('order_id', o.id);

  try {
    const files = await readTeacherFiles(teacherFiles(o));
    const red = redLines(o);
    let diffs: Diff[] = [];
    let summary = '';
    let note: string | null = null;
    if (files.length) {
      const result = await compareFiles(files.map(({ content, name }) => ({ content, name })), o.id, orderPlaquesText(o.items || []));
      if (!result) note = 'The compare with the teacher\'s file gave no answer.';
      else { diffs = (result.input.differences as Diff[]) || []; summary = String(result.input.summary || ''); }
    } else {
      note = teacherFiles(o).length ? 'The teacher\'s file could not be read.' : 'No teacher\'s file on this order to compare with.';
    }
    const issues = diffs.length + red.length;
    const status = !files.length || note ? (issues ? 'done' : 'skipped') : 'done';
    const fields: Record<string, unknown> = {
      status, compared_with: files.map(({ path, name }) => ({ path, name })), summary, differences: diffs, red_lines: red,
      issue_count: issues, note, report_chat_id: null, report_message_id: null,
      answer: null, answered_by: null, answered_at: null, answers: {}, asking: null, asking_message_id: null,
    };
    if (issues) {
      const lang = await langOfProfile(db, o.salesman_id);
      const questions = reviewQuestions(diffs, red, lang);
      const where = await whereToAsk(o, lang);
      const head = await bot.ask(where.chatId, null, reportHtml(o, questions, files.map((f) => f.name), where.mention, lang));
      const first = await bot.ask(where.chatId, head, questionHtml(questions[0], questions.length), buttonsFor(o.id, questions[0]));
      Object.assign(fields, { report_chat_id: Number(where.chatId), report_message_id: head, asking: 1, asking_message_id: first });
    }
    await finish(fields);
    return { order: o.id, issues, status, asked: issues > 0 };
  } catch (err) {
    console.error('auto review failed:', o.id, err);
    await finish({ status: 'failed', note: String(err).slice(0, 500) });
    return { order: o.id, failed: String(err).slice(0, 200) };
  }
}

// ------------------------------------------------------------------ answers
type Review = {
  order_id: string; differences: Diff[]; red_lines: Red[]; answers: Record<string, Answer>; asking: number | null;
  asking_message_id: number | null; report_chat_id: number | null; report_message_id: number | null;
};
const REVIEW_FIELDS = 'order_id, differences, red_lines, answers, asking, asking_message_id, report_chat_id, report_message_id';
const who = (from: Msg | undefined) => [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Telegram';

// An answer kept; the next question asked, or — all answered — the summary for Sean
async function recordAnswer(bot: Bot, r: Review, n: number, a: Answer, by: string) {
  const { data: order } = await db.from('orders').select('id, sekolah, salesman_id').eq('id', r.order_id).maybeSingle();
  const lang = await langOfProfile(db, order?.salesman_id);
  const questions = reviewQuestions(r.differences || [], r.red_lines || [], lang);
  const x = questions[n - 1];
  if (!x) return;
  const answers: Record<string, Answer> = { ...(r.answers || {}), [n]: a };
  if (r.asking_message_id && r.report_chat_id) {
    await bot.editText(r.report_chat_id, r.asking_message_id, `${questionHtml(x, questions.length)}\n👉 <b>${answerLabel(x, a, lang)}</b>`);
  }
  const nextQ = questions.find((q) => !answers[q.n]);
  const answerText = questions.filter((q) => answers[q.n]).map((q) => `${q.n}. ${answerLabel(q, answers[q.n], lang)}`).join('\n');
  if (nextQ) {
    const id = await bot.ask(r.report_chat_id!, r.report_message_id, questionHtml(nextQ, questions.length), buttonsFor(r.order_id, nextQ));
    await db.from('order_auto_reviews').update({ answers, asking: nextQ.n, asking_message_id: id, answer: answerText, answered_by: by }).eq('order_id', r.order_id);
    return;
  }
  await db.from('order_auto_reviews').update({ answers, asking: null, asking_message_id: null, answer: answerText, answered_by: by, answered_at: new Date().toISOString() }).eq('order_id', r.order_id);
  await bot.ask(r.report_chat_id!, r.report_message_id, summaryHtml({ id: r.order_id, sekolah: order?.sekolah || '' }, questions, answers, by, lang));
}

/** A tapped answer: callback data "r:<order id>:<question>:<option>". */
export async function handleReviewButton(cb: Msg, bot: Bot) {
  const m = /^r:([^:]+):(\d+):(\w+)$/.exec(String(cb.data || ''));
  if (!m) return bot.answerButton(cb.id);
  const { data } = await db.from('order_auto_reviews').select(REVIEW_FIELDS).eq('order_id', m[1]).maybeSingle();
  const r = data as Review | null;
  const n = Number(m[2]);
  const lang = await langOfTelegramUser(db, Number(cb.from?.id));
  const t = tr(lang);
  if (!r || r.asking !== n || r.asking_message_id !== cb.message?.message_id) return bot.answerButton(cb.id, t('Already answered.', '已经回答过了。'));
  if (m[3] === 'other') {
    await db.from('order_auto_reviews').update({ answers: { ...(r.answers || {}), [`${n}_pending`]: { pick: 'other' } } }).eq('order_id', r.order_id);
    await bot.answerButton(cb.id);
    return bot.ask(r.report_chat_id!, cb.message.message_id, askForWords(lang));
  }
  await bot.answerButton(cb.id, '✅');
  return recordAnswer(bot, r, n, { pick: m[3] }, who(cb.from));
}

// ------------------------------------------------------------------ the salesman's group
/** A message to ReviewAgent in a group other than Production's: "link", or the words for "✏️ Neither". */
export async function handleSalesmanGroup(msg: Msg, bot: Bot, botName: string) {
  const text = String(msg.text ?? msg.caption ?? '').trim();
  const repliedTo = msg.reply_to_message as Msg | undefined;
  const toBot = repliedTo?.from?.username?.toLowerCase() === botName;

  // the words after "✏️ Neither" (a reply to the question, or to the bot asking for them)
  if (toBot && text) {
    const { data } = await db.from('order_auto_reviews').select(REVIEW_FIELDS).eq('report_chat_id', msg.chat.id).not('asking', 'is', null);
    // waiting for words: the question replied to, else the only one waiting in this group
    const waiting = ((data || []) as Review[]).filter((x) => x.answers?.[`${x.asking}_pending`]);
    const r = waiting.find((x) => x.asking_message_id === repliedTo!.message_id) || (waiting.length === 1 ? waiting[0] : null);
    if (!r) return;
    const answers = { ...(r.answers || {}) };
    delete answers[`${r.asking}_pending`];
    return recordAnswer(bot, { ...r, answers }, r.asking!, { pick: 'other', text }, who(msg.from));
  }

  if (!new RegExp(`@${botName}\\b`, 'i').test(text) || !/\blink\b/i.test(text)) return;
  // only Production links a group (the person must be in the Production group)
  if (!CHAT_ID || !(await bot.inAnyGroup(Number(msg.from?.id), [CHAT_ID]))) {
    return bot.reply(msg.chat.id, msg.message_id, 'Only Production can link a group. / 只有 Production 可以 link 群。');
  }
  const { data: links } = await db.from('telegram_links').select('telegram_user_id, profile_id');
  const { data: people } = await db.from('profiles').select('id, display_name').eq('role', 'salesman').eq('status', 'active')
    .in('id', (links || []).map((l) => l.profile_id));
  const salesmen = (links || []).filter((l) => (people || []).some((p) => p.id === l.profile_id));
  const here: { telegram_user_id: number; profile_id: string }[] = [];
  for (const l of salesmen) if (await bot.inAnyGroup(Number(l.telegram_user_id), [String(msg.chat.id)])) here.push(l);
  if (here.length !== 1) {
    return bot.reply(msg.chat.id, msg.message_id, here.length
      ? 'More than one salesman in this group. / 这个群有超过一位 salesman。'
      : 'No salesman here has connected Telegram yet (website → Connect Telegram). / 这个群的 salesman 还没连接 Telegram（网站 → Connect Telegram）。');
  }
  const name = (people || []).find((p) => p.id === here[0].profile_id)?.display_name || 'the salesman';
  const { error } = await db.from('salesman_groups').upsert({ chat_id: msg.chat.id, profile_id: here[0].profile_id, title: msg.chat.title ?? null, linked_at: new Date().toISOString() });
  if (error) throw error;
  const lang = await langOfProfile(db, here[0].profile_id);
  return bot.reply(msg.chat.id, msg.message_id, tr(lang)(`✅ <b>${esc(name)}</b>'s group — I'll ask about his orders here.`, `✅ 这是 <b>${esc(name)}</b> 的群 — 他的订单有问题时，我会在这里问。`));
}
