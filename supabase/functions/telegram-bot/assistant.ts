// Sean's assistant bot in the Production group (Sean, 2026-11-05): the one bot he talks to, like a boss
// to his manager — questions about orders ("where is ORD-0234?", "how many orders from SK X this
// week?"), his to-do list ("remember me: 1. help Harriet convert the Excel"), and jobs it hands to the
// other bots' work: ExcelFormAgent (a kertas kerja → FORM ANUGERAH, form.ts) and ReviewAgent (a file
// compared with an order; an order's Shipment Date / Function Date / Remark changed — orderEdit.ts,
// only after Sean confirms in a later message). Everything else only READS orders. When it isn't
// sure, it asks.

import type Anthropic from 'npm:@anthropic-ai/sdk';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { anthropic, MODEL } from './ai.ts';
import { orderPlaquesText } from './order.ts';
import { logUsage } from './usage.ts';
import { applyEdit, prepareEdit, type EditAsk } from './orderEdit.ts';

const MAX_TURNS = 8;              // tool round-trips per question
const HISTORY_ROWS = 12;          // what was said before, for follow-ups
const ORDERS_SHOWN = 60;          // rows a find_orders answer lists (the count and total cover all)
const ORDERS_SCANNED = 1000;
const PLAQUES_CHARS = 6000;
const TEXT_CHARS = 2000;

export type AssistantCtx = {
  db: SupabaseClient;
  today: string;                  // Malaysia day, YYYY-MM-DD
  who: string;
  sentAt: Date;                   // when Sean sent this message (a change he confirms must be older)
  fileName: string | null;        // the file sent with (or replied to by) this message
  // the staff's jobs on that file; each sends its own result to the group and says what it sent
  convertForm: (notes: string) => Promise<string>;
  compareFile: (orderId: string) => Promise<string>;
};

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const nullable = (type: string, description: string) => ({ type: [type, 'null'], description });
const DAY = 'YYYY-MM-DD (Malaysia), or null';
const STATUSES = ['Reviewing Order', 'Done Review', 'Salesman Approved', 'In Production', 'Completed', 'Cancelled'];

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: 'find_orders',
    description: 'Search orders. Every filter is optional (null = any). Returns how many match, their total RM, and up to 60 of them (newest first).',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['order_id', 'school', 'salesman', 'status', 'placed_from', 'placed_to', 'shipment_from', 'shipment_to', 'urgent_only'],
      properties: {
        order_id: nullable('string', 'e.g. ORD-0234'),
        school: nullable('string', 'part of the school name, e.g. "TAMAN MELAWATI"'),
        salesman: nullable('string', 'part of the salesman name'),
        // strict tools reject null in an enum: 'any' = no filter
        status: { type: 'string', enum: [...STATUSES, 'any'], description: '"Done Review" = reviewed, waiting for the salesman to approve; "any" = every status' },
        placed_from: nullable('string', `placed on or after, ${DAY}`),
        placed_to: nullable('string', `placed on or before, ${DAY}`),
        shipment_from: nullable('string', `Shipment Date on or after, ${DAY}`),
        shipment_to: nullable('string', `Shipment Date on or before, ${DAY}`),
        urgent_only: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_order',
    description: 'One order in full: dates, status, invoice, remark, Production note, and every plaque\'s wording and quantity.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['order_id'], properties: { order_id: { type: 'string' } } },
  },
  {
    name: 'list_tasks',
    description: 'Sean\'s to-do list: the open tasks, and the ones done in the last 7 days.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    name: 'add_tasks',
    description: 'Add tasks to Sean\'s to-do list (when he says "remember me", "remind me", "记住", "ingat" …). One entry per task.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['text', 'due_date'],
            properties: { text: { type: 'string', description: 'the task in Sean\'s own words' }, due_date: nullable('string', `when it must be done, ${DAY}`) },
          },
        },
      },
    },
  },
  {
    name: 'complete_tasks',
    description: 'Tick tasks off Sean\'s list by their number (from list_tasks).',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } },
  },
  {
    name: 'prepare_order_change',
    description: 'ReviewAgent: get a Shipment Date / Function Date / Remark change of one order ready. Nothing changes yet — show Sean the before → after and ask him to confirm. Remark: "replace" when he says change it to / tukar / 改成, "append" when he says add / tambah / 加.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['order_id', 'shipment_date', 'function_date', 'remark_mode', 'remark_text'],
      properties: {
        order_id: { type: 'string', description: 'e.g. ORD-0234' },
        shipment_date: nullable('string', `new Shipment Date, ${DAY}`),
        function_date: nullable('string', `new Function Date, ${DAY}`),
        remark_mode: { type: 'string', enum: ['replace', 'append', 'none'], description: '"none" = the Remark stays as it is' },
        remark_text: nullable('string', 'the new Remark (replace) or the text to add (append), exactly as Sean wrote it'),
      },
    },
  },
  {
    name: 'confirm_order_change',
    description: 'ReviewAgent: write a prepared change, ONLY after Sean has said yes (ok / yes / 确认 / betul) in a message after you showed it to him.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['request_id'], properties: { request_id: { type: 'string' } } },
  },
  {
    name: 'ai_credit',
    description: 'The Anthropic AI credit (pays for every AI feature of the website and the bots): this month\'s spend and the estimated balance left. When Sean says he topped up or tells you the balance shown in the Claude Console, pass it as balance_usd so the estimate starts from it; otherwise null.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['balance_usd'], properties: { balance_usd: nullable('number', 'the credit balance in US$ now, as Sean gave it') } },
  },
  {
    name: 'convert_kertas_kerja',
    description: 'ExcelFormAgent: turn the file Sean sent (a teacher\'s kertas kerja: PDF, Word, Excel or photo) into FORM ANUGERAH (Excel) and send it to the group. Takes 1-2 minutes.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['notes'], properties: { notes: { type: 'string', description: 'Sean\'s instructions for the form, e.g. "semua PKC 263", or ""' } } },
  },
  {
    name: 'compare_file_with_order',
    description: 'ReviewAgent: compare the file Sean sent with an order and send the differences to the group. Takes about a minute.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['order_id'], properties: { order_id: { type: 'string' } } },
  },
];

const system = (today: string, fileName: string | null) => `You are the assistant of Sean, the boss of Pustaka Jasa / DOUBLE WIN, a Malaysian company that makes school award plaques, medals and crystals. You talk with him in his Telegram group "DOUBLE WIN PRODUCTION". Today is ${today} (Malaysia).
You are the manager of two staff bots and hand them the jobs: ExcelFormAgent turns a teacher's kertas kerja into FORM ANUGERAH (convert_kertas_kerja); ReviewAgent compares a file with an order (compare_file_with_order) and changes an order's Shipment Date / Function Date / Remark (prepare_order_change, confirm_order_change). Say which staff you gave a job to.
${fileName ? `Sean sent a file with this message: "${fileName}". Unless he says to compare it with an order (or it already is a FORM ANUGERAH), hand it to ExcelFormAgent (convert_kertas_kerja) straight away — a file on its own means "convert this".` : 'No file came with this message; for convert / compare, ask Sean to send the file.'}
Work like a good staff member:
- Answer from the tools, never from memory or a guess. Order numbers look like ORD-0234.
- Order stages: Reviewing Order (Production checks it) → Done Review (waiting for the salesman to approve) → Salesman Approved (waiting for the invoice) → In Production → Completed. Orders ORD-90xx are test orders: leave them out unless asked.
- Changing an order: only its Shipment Date, Function Date or Remark. First prepare_order_change and show Sean exactly what it becomes, then ask "确认？". Only when he says yes in his NEXT message, confirm_order_change. Never confirm in the same turn you prepared. Anything else (quantities, wording, Jenis Plak, prices): tell him to use Edit Order on the website.
- Keep Sean's to-do list: add what he asks you to remember, tick off what he says is done, show it when he asks.
- If something is unclear or you're not sure, ASK Sean a short question instead of guessing. If you see a problem (a late order, a missing invoice …), say it.
- Reply in the language Sean writes in (usually Simplified Chinese; keep order numbers, school names, statuses and plaque wording as they are). Short and to the point, like a message to the boss. Plain text only — no Markdown, no HTML; "• " for lists.`;

const ok = (data: unknown) => JSON.stringify(data);

async function findOrders(db: SupabaseClient, f: Record<string, unknown>) {
  let q = db.from('orders')
    .select('id, sekolah, sales, status, reviewed_at, cancelled_at, total_amount, created_at, shipment_date, function_date, urgent, invoice_id, parent_order_id, items')
    .order('created_at', { ascending: false }).limit(ORDERS_SCANNED);
  const like = (v: unknown) => `%${String(v).replace(/[%_,()]/g, ' ').trim()}%`;
  if (f.order_id) q = q.ilike('id', like(f.order_id));
  if (f.school) q = q.ilike('sekolah', like(f.school));
  if (f.salesman) q = q.ilike('sales', like(f.salesman));
  if (f.status === 'Cancelled') q = q.not('cancelled_at', 'is', null);
  else {
    q = q.is('cancelled_at', null);
    if (f.status === 'Done Review') q = q.eq('status', 'Reviewing Order').not('reviewed_at', 'is', null);
    else if (f.status === 'Reviewing Order') q = q.eq('status', 'Reviewing Order').is('reviewed_at', null);
    else if (f.status && f.status !== 'any') q = q.eq('status', f.status);
  }
  if (f.placed_from) q = q.gte('created_at', `${f.placed_from}T00:00:00+08:00`);
  if (f.placed_to) q = q.lt('created_at', `${nextDay(String(f.placed_to))}T00:00:00+08:00`);
  if (f.shipment_from) q = q.gte('shipment_date', String(f.shipment_from));
  if (f.shipment_to) q = q.lt('shipment_date', nextDay(String(f.shipment_to)));
  if (f.urgent_only) q = q.eq('urgent', true);
  const { data, error } = await q;
  if (error) return ok({ error: error.message });
  const rows = data || [];
  return ok({
    matching: rows.length, totalRM: rows.reduce((a, o) => a + Number(o.total_amount || 0), 0).toFixed(2),
    orders: rows.slice(0, ORDERS_SHOWN).map((o) => ({
      id: o.id, school: o.sekolah, salesman: o.sales,
      status: o.cancelled_at ? 'Cancelled' : o.status === 'Reviewing Order' && o.reviewed_at ? 'Done Review' : o.status,
      totalRM: Number(o.total_amount || 0), placed: o.created_at, shipment: o.shipment_date?.slice(0, 10) ?? null,
      function: o.function_date?.slice(0, 10) ?? null, urgent: !!o.urgent, invoice: o.invoice_id, tambahanOf: o.parent_order_id,
      plaques: (Array.isArray(o.items) ? o.items : []).reduce((n: number, it: Record<string, unknown>) => n + (Number(it?.qty) || 0), 0),
    })),
  });
}

async function getOrder(db: SupabaseClient, orderId: string) {
  const { data: o, error } = await db.from('orders')
    .select('id, sekolah, sales, pic_name, status, reviewed_at, cancelled_at, cancel_reason, total_amount, created_at, shipment_date, function_date, urgent, invoice_id, invoice_set_at, typed_at, plak_done_at, parent_order_id, remark, production_note, items')
    .ilike('id', orderId.trim()).maybeSingle();
  if (error) return ok({ error: error.message });
  if (!o) return ok({ error: `no order ${orderId}` });
  const { items, ...rest } = o;
  let plaques = '';
  try { plaques = orderPlaquesText(items || []).slice(0, PLAQUES_CHARS); } catch (err) { plaques = `(couldn't list the plaques: ${String(err).slice(0, 100)})`; }
  return ok({ ...rest, remark: String(o.remark || '').slice(0, TEXT_CHARS), production_note: String(o.production_note || '').slice(0, TEXT_CHARS), plaques });
}

export async function openTasks(db: SupabaseClient) {
  const { data, error } = await db.from('bot_tasks').select('id, text, due_date, created_at').is('done_at', null).order('id');
  if (error) throw error;
  return data || [];
}

async function listTasks(db: SupabaseClient) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: done } = await db.from('bot_tasks').select('id, text, done_at').gte('done_at', weekAgo).order('done_at');
  return ok({ open: await openTasks(db), doneLast7Days: done || [] });
}

// The credit as far as we can tell: Anthropic doesn't let a program read the balance, so it is the
// balance Sean last gave minus every AI cost logged since (migration 0113)
async function aiCredit(db: SupabaseClient, balanceUsd: number | null, who: string) {
  if (balanceUsd != null) {
    if (!(balanceUsd >= 0)) return { error: 'the balance must be a number of US$, 0 or more' };
    const { error } = await db.from('ai_balance').insert({ amount_usd: balanceUsd, set_by: who });
    if (error) return { error: error.message };
  }
  const [{ data: est }, { data: month }, { data: settings }] = await Promise.all([
    db.rpc('ai_balance_estimate'), db.rpc('ai_month_spend_cents'), db.from('ai_settings').select('usd_to_myr').maybeSingle(),
  ]);
  const e = Array.isArray(est) ? est[0] : null;
  const rate = Number(settings?.usd_to_myr) || 4.3;
  const both = (usd: number) => ({ usd: Math.round(usd * 100) / 100, rm: Math.round(usd * rate * 100) / 100 });
  return {
    usdToRm: rate,
    spentThisMonth: both(Number(month || 0) / 100),
    balance: e ? { given: both(Number(e.set_usd)), givenAt: e.set_at, spentSince: both(Number(e.spent_usd)), estimatedLeft: both(Number(e.left_usd)) } : 'unknown — ask Sean for the balance shown in the Claude Console',
    note: 'estimate from logged costs; the Claude Console (platform.claude.com) has the real balance. Always tell Sean both US$ and RM.',
  };
}

async function runTool(ctx: AssistantCtx, name: string, input: Record<string, unknown>) {
  const { db } = ctx;
  if (name === 'find_orders') return findOrders(db, input);
  if (name === 'get_order') return getOrder(db, String(input.order_id || ''));
  if (name === 'list_tasks') return listTasks(db);
  if (name === 'add_tasks') {
    const rows = ((input.tasks as { text: string; due_date: string | null }[]) || [])
      .filter((t) => t.text?.trim())
      .map((t) => ({ text: t.text.trim().slice(0, TEXT_CHARS), due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due_date || '') ? t.due_date : null, created_by: ctx.who }));
    if (!rows.length) return ok({ error: 'no task text' });
    const { data, error } = await db.from('bot_tasks').insert(rows).select('id, text, due_date');
    return ok(error ? { error: error.message } : { added: data });
  }
  if (name === 'complete_tasks') {
    const ids = ((input.ids as number[]) || []).filter(Number.isInteger);
    const { data, error } = await db.from('bot_tasks').update({ done_at: new Date().toISOString() }).in('id', ids).is('done_at', null).select('id, text');
    return ok(error ? { error: error.message } : { done: data, notFoundOrAlreadyDone: ids.filter((id) => !(data || []).some((t) => t.id === id)) });
  }
  if (name === 'prepare_order_change') return ok(await prepareEdit(db, input as unknown as EditAsk, ctx.who));
  if (name === 'confirm_order_change') return ok(await applyEdit(db, String(input.request_id || ''), ctx.sentAt, ctx.who));
  if (name === 'ai_credit') return ok(await aiCredit(db, input.balance_usd as number | null, ctx.who));
  if (name === 'convert_kertas_kerja') return ok(ctx.fileName ? { result: await ctx.convertForm(String(input.notes || '')) } : { error: 'no file with this message — ask Sean to send it' });
  if (name === 'compare_file_with_order') return ok(ctx.fileName ? { result: await ctx.compareFile(String(input.order_id || '')) } : { error: 'no file with this message — ask Sean to send it' });
  return ok({ error: `unknown tool ${name}` });
}

// The conversation so far as alternating turns, oldest first, starting with Sean
async function history(db: SupabaseClient): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const { data } = await db.from('bot_chat').select('role, text').order('id', { ascending: false }).limit(HISTORY_ROWS);
  const turns: Anthropic.Beta.BetaMessageParam[] = [];
  // an empty row (a failed file message, 2026-11-05) would make the API reject the whole history
  for (const row of (data || []).reverse().filter((r) => String(r.text || '').trim())) {
    const last = turns[turns.length - 1];
    if (last?.role === row.role) last.content = `${last.content}\n\n${row.text}`;
    else turns.push({ role: row.role as 'user' | 'assistant', content: row.text });
  }
  while (turns[0]?.role === 'assistant') turns.shift();
  return turns;
}

const remember = (db: SupabaseClient, role: 'user' | 'assistant', text: string) =>
  db.from('bot_chat').insert({ role, text: text.slice(0, TEXT_CHARS) }).then(({ error }) => { if (error) console.error('bot_chat insert failed:', error.message); });

// Sean's message → the reply text (plain text)
export async function askAssistant(ctx: AssistantCtx, text: string) {
  const past = await history(ctx.db);
  const messages: Anthropic.Beta.BetaMessageParam[] = [...past];
  if (messages[messages.length - 1]?.role === 'user') messages.push({ role: 'assistant', content: '(no reply)' });
  messages.push({ role: 'user', content: text });
  await remember(ctx.db, 'user', text);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic.beta.messages.create({
      model: MODEL, max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
      system: system(ctx.today, ctx.fileName), tools: TOOLS, messages,
    }).catch(async (err) => { await logUsage('assistant', MODEL, null, ctx.fileName, String(err)); throw err; });
    await logUsage('assistant', res.model || MODEL, res.usage, ctx.fileName);
    if (res.stop_reason === 'refusal') return 'Sorry, I can\'t help with that one.';
    const uses = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      const reply = res.content.filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === 'text').map((c) => c.text).join('\n').trim()
        || (res.stop_reason === 'max_tokens' ? 'Sorry, that answer got too long — please ask a smaller question.' : 'OK.');
      await remember(ctx.db, 'assistant', reply);
      return reply;
    }
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      let content: string;
      try {
        content = await runTool(ctx, use.name, (use.input || {}) as Record<string, unknown>);
      } catch (err) {
        console.error(`assistant tool ${use.name} failed:`, err);
        content = ok({ error: String(err).slice(0, 300) });
      }
      results.push({ type: 'tool_result', tool_use_id: use.id, content });
    }
    messages.push({ role: 'user', content: results });
  }
  return 'Sorry, that took too many steps — please ask it more simply.';
}
