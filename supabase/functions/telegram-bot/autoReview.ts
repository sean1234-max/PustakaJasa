// ReviewAgent reviews every order by itself (Sean, 2026-11-07). The heart of a review is the website's
// order against the teacher's kertas kerja — words, spelling, quantities, Jenis Plak (compareFiles, the
// same compare as "@PjsbReviewAgent check ORD-xxxx") — and then which lines should be red (the website AI
// Review's own program rules B1 / R1 / C3, reviewChecks.js).
//   • An order is reviewed when it comes in for review, and again when it changes (the salesman's Edit
//     Order, Production's Corrected Excel): `version` is the order's items + the files read.
//   • Nothing found: no message — the review list shows 🟢 (telegram-notify).
//   • Something found: asked in the salesman's own group (salesman_groups, "@PjsbReviewAgent link"), the
//     salesman mentioned; his reply to that message is kept (order_auto_reviews.answer) — 💬 on the list.
//     No group for him: asked in the Production group instead.
//   • It never changes an order and never presses Done Review (Sean: not until it has proved itself).
// Run by telegram-notify every 3 minutes (?job=review): one order per run — a compare takes 1–2 minutes.

import { db } from './db.ts';
import { esc } from './telegram.ts';
import { readFile, type FileContent } from './files.ts';
import { compareFiles } from './ai.ts';
import { orderPlaquesText } from './order.ts';
import { teacherFiles, reportHtml, type FileRef, type Diff, type Red } from './reviewReport.ts';
// @ts-ignore a plain JS bundle
import { reviewOrder } from './order.bundle.js';

type Bot = {
  reply: (chatId: number | string, replyTo: number, html: string) => Promise<void>;
  ask: (chatId: number | string, replyTo: number | null, html: string) => Promise<number | null>;
  inAnyGroup: (userId: number, chatIds: string[]) => Promise<boolean>;
};
type Msg = Record<string, any>;
type Order = {
  id: string; sekolah: string; sales: string | null; salesman_id: string | null; items: any[]; created_at: string;
  kertas_kerja_files: FileRef[] | null; import_files: FileRef[] | null; import_file_path: string | null; import_file_name: string | null;
};

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const RED_RULES = ['B1', 'R1', 'C3'];
const STALE_MS = 15 * 60_000;      // a review "running" this long died: try again
const MAX_FILES = 6;               // pages of one kertas kerja read together
const ORDER_FIELDS = 'id, sekolah, sales, salesman_id, items, created_at, kertas_kerja_files, import_files, import_file_path, import_file_name';

const orderLink = (id: string) => `<a href="${SITE_URL}/#/production/orders/${encodeURIComponent(id)}">${esc(id)}</a>`;
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
    .map(({ rule, level, text, sheet, count, sample }) => ({ rule, level, text, sheet, count, sample }));
}

// Where to ask: the salesman's own group (with him mentioned), else the Production group
async function whereToAsk(o: Order) {
  if (o.salesman_id) {
    const { data: g } = await db.from('salesman_groups').select('chat_id').eq('profile_id', o.salesman_id).order('linked_at', { ascending: false }).limit(1).maybeSingle();
    const { data: link } = await db.from('telegram_links').select('telegram_user_id').eq('profile_id', o.salesman_id).maybeSingle();
    const mention = link ? `<a href="tg://user?id=${link.telegram_user_id}">${esc(o.sales || 'Salesman')}</a>` : esc(o.sales || '');
    if (g) return { chatId: g.chat_id as number, mention, inGroup: true };
    return { chatId: CHAT_ID, mention: `${mention} (no group linked for ${esc(o.sales || 'this salesman')} — Sean, please forward)`, inGroup: false };
  }
  return { chatId: CHAT_ID, mention: '', inGroup: false };
}

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
    let report: { chatId: number | string; messageId: number | null } | null = null;
    if (issues) {
      const where = await whereToAsk(o);
      const html = reportHtml(o, files.map((f) => f.name), summary, diffs, red, where.mention) + (note ? `\n\n<i>${esc(note)}</i>` : '');
      report = { chatId: where.chatId, messageId: await bot.ask(where.chatId, null, html) };
    }
    await finish({
      status, compared_with: files.map(({ path, name }) => ({ path, name })), summary, differences: diffs, red_lines: red,
      issue_count: issues, note, report_chat_id: report ? Number(report.chatId) : null, report_message_id: report?.messageId ?? null,
      answer: null, answered_by: null, answered_at: null,
    });
    return { order: o.id, issues, status, asked: !!report };
  } catch (err) {
    console.error('auto review failed:', o.id, err);
    await finish({ status: 'failed', note: String(err).slice(0, 500) });
    return { order: o.id, failed: String(err).slice(0, 200) };
  }
}

// ------------------------------------------------------------------ the salesman's group
const who = (msg: Msg) => [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Telegram';

/** A message to ReviewAgent in a group other than Production's: "link", or a reply to its review. */
export async function handleSalesmanGroup(msg: Msg, bot: Bot, botName: string) {
  const text = String(msg.text ?? msg.caption ?? '');
  const repliedTo = msg.reply_to_message as Msg | undefined;
  const toBot = repliedTo?.from?.username?.toLowerCase() === botName;

  // the salesman answers a review: kept with it (several replies add up)
  if (toBot && text.trim()) {
    const { data: r } = await db.from('order_auto_reviews').select('order_id, answer')
      .eq('report_chat_id', msg.chat.id).eq('report_message_id', repliedTo!.message_id).maybeSingle();
    if (!r) return;
    const answer = [r.answer, `${who(msg)}: ${text.trim()}`].filter(Boolean).join('\n');
    await db.from('order_auto_reviews').update({ answer, answered_by: who(msg), answered_at: new Date().toISOString() }).eq('order_id', r.order_id);
    return bot.reply(msg.chat.id, msg.message_id, `📝 Noted for ${orderLink(r.order_id)} — Production will see it when they review the order.`);
  }

  if (!new RegExp(`@${botName}\\b`, 'i').test(text) || !/\blink\b/i.test(text)) return;
  // only Production links a group (the person must be in the Production group)
  if (!CHAT_ID || !(await bot.inAnyGroup(Number(msg.from?.id), [CHAT_ID]))) {
    return bot.reply(msg.chat.id, msg.message_id, 'Only Production can link a group.');
  }
  const { data: links } = await db.from('telegram_links').select('telegram_user_id, profile_id');
  const { data: people } = await db.from('profiles').select('id, display_name').eq('role', 'salesman').eq('status', 'active')
    .in('id', (links || []).map((l) => l.profile_id));
  const salesmen = (links || []).filter((l) => (people || []).some((p) => p.id === l.profile_id));
  const here: { telegram_user_id: number; profile_id: string }[] = [];
  for (const l of salesmen) if (await bot.inAnyGroup(Number(l.telegram_user_id), [String(msg.chat.id)])) here.push(l);
  if (here.length !== 1) {
    return bot.reply(msg.chat.id, msg.message_id, here.length
      ? 'There is more than one salesman in this group — a salesman\'s group has just one.'
      : 'No salesman here has connected his Telegram yet (website dashboard → Connect Telegram, then send the code to ExcelFormAgent).');
  }
  const name = (people || []).find((p) => p.id === here[0].profile_id)?.display_name || 'the salesman';
  const { error } = await db.from('salesman_groups').upsert({ chat_id: msg.chat.id, profile_id: here[0].profile_id, title: msg.chat.title ?? null, linked_at: new Date().toISOString() });
  if (error) throw error;
  return bot.reply(msg.chat.id, msg.message_id, `✅ This is <b>${esc(name)}</b>'s group — I'll ask about ${esc(name)}'s orders here when a review finds something.`);
}
