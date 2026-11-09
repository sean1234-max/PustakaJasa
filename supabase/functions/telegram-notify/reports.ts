// Reports to Sean in the Production group (Sean, 2026-11-05) — straight from the database, no AI:
//   • the morning report (from 08:30): yesterday's orders, where every order stands, what ships today
//     and tomorrow, the problems, and his to-do list (bot_tasks, migration 0110);
//   • the evening summary (from 18:30): what was done today, his list, what ships tomorrow;
//   • questions during the day (08:30–21:30) the moment an order looks wrong — late, about to ship
//     but not approved, waiting days for the salesman. Each asked once (telegram_sent 'ask:…');
//     the morning report marks the ones it already lists as asked.
// Test orders (ORD-90xx) are left out.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type Row = Record<string, any>;
export type ReportDeps = {
  db: SupabaseClient;
  send: (html: string) => Promise<number>;
  esc: (t: unknown) => string;
  orderLink: (id: string) => string;
};

const MORNING = { from: '08:30', to: '11:00' };
const EVENING = { from: '18:30', to: '23:00' };
const ASKING = { from: '08:30', to: '21:30' };
const STUCK_DONE_REVIEW_DAYS = 2;
const SHOWN = 25;
const MS_PER_DAY = 86_400_000;
const TEST_ORDERS = 'ORD-90%';
const CREDIT_LOW_USD = 5;           // warn when the estimated credit left is under this…
const CREDIT_LOW_SHARE = 0.2;       // …or under this share of the balance Sean last gave
const CREDIT_ERROR_WINDOW_MS = 30 * 60_000;
const DEFAULT_USD_TO_MYR = 4.3;

const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
const myDay = (v: unknown) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(String(v))) : '');
// Sean's reports in Chinese, short — the numbers first, the lists folded (Sean, 2026-11-08)
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
const showDay = (day: string) => { const d = new Date(`${day}T00:00:00Z`); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}（${WEEKDAY[d.getUTCDay()]}）`; };
const folded = (lines: string[]) => (lines.length ? `<blockquote expandable>${lines.join('\n')}</blockquote>` : '');
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const within = (time: string, w: { from: string; to: string }) => time >= w.from && time < w.to;
const stage = (o: Row) => (o.status === 'Reviewing Order' && o.reviewed_at ? 'Done Review' : o.status);

async function wasSent(db: SupabaseClient, key: string) {
  const { data } = await db.from('telegram_sent').select('key').eq('key', key).maybeSingle();
  return !!data;
}
const markSent = (db: SupabaseClient, keys: string[]) =>
  keys.length ? db.from('telegram_sent').upsert(keys.map((key) => ({ key })), { ignoreDuplicates: true }) : Promise.resolve();

// Every order not yet Completed (and not cancelled)
async function openOrders(db: SupabaseClient) {
  const { data, error } = await db.from('orders')
    .select('id, sekolah, sales, status, reviewed_at, shipment_date, urgent, invoice_id')
    .is('cancelled_at', null).neq('status', 'Completed').not('id', 'like', TEST_ORDERS)
    .order('shipment_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

// How many orders had `column` set on that Malaysian day (and their total, for created_at)
async function countOn(db: SupabaseClient, column: string, day: string, extra?: (q: any) => any) {
  let q = db.from('orders').select('total_amount').is('cancelled_at', null).not('id', 'like', TEST_ORDERS)
    .gte(column, `${day}T00:00:00+08:00`).lt(column, `${shiftDay(day, 1)}T00:00:00+08:00`);
  if (extra) q = extra(q);
  const { data, error } = await q;
  if (error) throw error;
  return { n: (data || []).length, total: (data || []).reduce((a: number, o: Row) => a + Number(o.total_amount || 0), 0) };
}

async function openTasks(db: SupabaseClient) {
  const { data, error } = await db.from('bot_tasks').select('id, text, due_date').is('done_at', null).order('id');
  if (error) throw error;
  return data || [];
}

// The AI credit as far as we can tell (migration 0113): the balance Sean last gave minus every AI cost since
async function creditEstimate(db: SupabaseClient) {
  const { data, error } = await db.rpc('ai_balance_estimate');
  if (error) throw error;
  const e = Array.isArray(data) ? data[0] : null;
  return e ? { id: Number(e.balance_id), given: Number(e.set_usd), left: Number(e.left_usd) } : null;
}

// What a day of AI costs lately, to say how long the credit lasts
async function dailySpendUsd(db: SupabaseClient) {
  const { data } = await db.rpc('ai_spend_cents_since', { since: new Date(Date.now() - 7 * MS_PER_DAY).toISOString() });
  return Number(data || 0) / 100 / 7;
}

export const creditIsLow = (c: { given: number; left: number }) => c.left < Math.max(CREDIT_LOW_USD, c.given * CREDIT_LOW_SHARE);

// US$ → RM at the website's AI rate (ai_settings.usd_to_myr), so Sean sees both
async function usdToMyr(db: SupabaseClient) {
  const { data } = await db.from('ai_settings').select('usd_to_myr').maybeSingle();
  return Number(data?.usd_to_myr) || DEFAULT_USD_TO_MYR;
}
export const money = (n: number, rate: number) => `$${n.toFixed(2)} (RM${(n * rate).toFixed(2)})`;
const lastsFor = (left: number, perDay: number, rate: number) => (perDay > 0 ? `，大约还够 ${Math.max(0, Math.floor(left / perDay))} 天（每天 ${money(perDay, rate)}）` : '');

// Sean hears at once when the credit is gone (an AI call refused for it), and before, when it runs low
async function creditAlerts(d: ReportDeps, today: string) {
  const sent: string[] = [];
  const { data: refused } = await d.db.rpc('ai_credit_errors_since', { since: new Date(Date.now() - CREDIT_ERROR_WINDOW_MS).toISOString() });
  if (Number(refused || 0) > 0 && !(await wasSent(d.db, `ai-out:${today}`))) {
    await d.send('⚠️ <b>AI 额度用完了</b> — 网站和 bot 的 AI 都停了。\n到 platform.claude.com → Add funds 充值，再告诉我余额（例如「我充值了，余额 $30」）。');
    sent.push(`ai-out:${today}`);
  }
  const c = await creditEstimate(d.db);
  if (c && creditIsLow(c) && !(await wasSent(d.db, `ai-low:${c.id}`))) {
    const rate = await usdToMyr(d.db);
    await d.send(`🔋 <b>AI 额度快用完</b> — 剩大约 ${money(c.left, rate)}${lastsFor(c.left, await dailySpendUsd(d.db), rate)}。\n到 platform.claude.com → Add funds 充值，再告诉我余额。`);
    sent.push(`ai-low:${c.id}`);
  }
  await markSent(d.db, sent);
  return sent.length;
}

// The problems, each with the key it's asked under
export function problemsOf(orders: Row[], today: string, now = Date.now()) {
  const tomorrow = shiftDay(today, 1);
  const out: { key: string; text: (d: ReportDeps) => string }[] = [];
  for (const o of orders) {
    const ship = myDay(o.shipment_date);
    const name = (d: ReportDeps) => `${d.orderLink(o.id)} ${d.esc(o.sekolah)}${o.sales ? ` (${d.esc(o.sales)})` : ''}`;
    if (ship && ship < today) {
      out.push({ key: `ask:late:${o.id}:${ship}`, text: (d) => `${name(d)} — ${showDay(ship)} 应该出货，还在 <b>${d.esc(stage(o))}</b>。出了吗？出了就在网站按 Done，没出的话新日期是？` });
    } else if (ship && ship <= tomorrow && ['Reviewing Order', 'Salesman Approved'].includes(o.status)) {
      out.push({ key: `ask:soon:${o.id}:${ship}`, text: (d) => `${name(d)} — ${ship === today ? '<b>今天</b>' : '明天'}出货，但还在 <b>${d.esc(stage(o))}</b>。赶得及吗？还是要改日期？` });
    } else if (o.status === 'Reviewing Order' && o.reviewed_at && now - Date.parse(o.reviewed_at) > STUCK_DONE_REVIEW_DAYS * MS_PER_DAY) {
      const days = Math.floor((now - Date.parse(o.reviewed_at)) / MS_PER_DAY);
      out.push({ key: `ask:stuck:${o.id}`, text: (d) => `${name(d)} — Done Review 已经 ${days} 天，salesman 还没 approve。要我提醒，还是你自己跟？` });
    }
  }
  return out;
}

function listLines(d: ReportDeps, rows: Row[], line: (o: Row) => string) {
  return [...rows.slice(0, SHOWN).map(line), ...(rows.length > SHOWN ? [`… 还有 ${rows.length - SHOWN} 张`] : [])];
}

function taskLines(d: ReportDeps, tasks: Row[], today: string) {
  if (!tasks.length) return [];
  return tasks.map((t) => `${t.id}. ${d.esc(t.text)}${t.due_date ? (t.due_date < today ? ` ❗ ${showDay(t.due_date)} 到期了` : t.due_date === today ? ' ⏰ 今天' : `（${showDay(t.due_date)} 前）`) : ''}`);
}

const shipLine = (d: ReportDeps) => (o: Row) => `• ${d.orderLink(o.id)} ${d.esc(o.sekolah)} — ${d.esc(stage(o))}${o.urgent ? ' 🔥' : ''}`;

async function morningReport(d: ReportDeps, today: string) {
  const yesterday = shiftDay(today, -1);
  const [orders, placed, tasks, credit, perDay, rate] = await Promise.all([openOrders(d.db), countOn(d.db, 'created_at', yesterday), openTasks(d.db), creditEstimate(d.db).catch(() => null), dailySpendUsd(d.db), usdToMyr(d.db)]);
  const by = (s: string) => orders.filter((o) => stage(o) === s).length;
  const shipsOn = (day: string) => orders.filter((o) => myDay(o.shipment_date) === day);
  const problems = problemsOf(orders, today);
  const today0 = shipsOn(today), tomorrow0 = shipsOn(shiftDay(today, 1));
  const text = [
    `🌅 <b>早安老板 · ${showDay(today)}</b>`,
    `昨天 ${placed.n} 张新单 · ${rm(placed.total)}`,
    `⏳ 待 review ${by('Reviewing Order')} · ✅ 等 salesman ${by('Done Review')} · 🧾 等 invoice ${by('Salesman Approved')} · 🏭 生产中 ${by('In Production')}`,
    `🚚 今天出货 ${today0.length} · 明天 ${tomorrow0.length}`,
    folded([...listLines(d, today0, shipLine(d)), ...(tomorrow0.length ? ['明天：', ...listLines(d, tomorrow0, shipLine(d))] : [])]),
    ...(problems.length ? [`❗ <b>要你回答 ${problems.length} 个</b>`, ...problems.slice(0, 3).map((p) => `• ${p.text(d)}`), folded(problems.slice(3, SHOWN).map((p) => `• ${p.text(d)}`))] : []),
    ...(tasks.length ? [`📝 待办 ${tasks.length} 件`, folded(taskLines(d, tasks, today))] : []),
    credit ? `🤖 AI 额度：剩大约 ${money(credit.left, rate)}${creditIsLow(credit) ? ' ❗' : ''}` : `🤖 AI 额度：不知道余额 — 告诉我 Claude Console 的余额（最近每天 ${money(perDay, rate)}）`,
  ].filter(Boolean).join('\n');
  await d.send(text);
  await markSent(d.db, problems.map((p) => p.key));
}

async function eveningReport(d: ReportDeps, today: string) {
  const [placed, reviewed, invoiced, typed, completed, orders, tasks, doneTasks] = await Promise.all([
    countOn(d.db, 'created_at', today),
    countOn(d.db, 'reviewed_at', today),
    countOn(d.db, 'invoice_set_at', today),
    countOn(d.db, 'typed_at', today),
    countOn(d.db, 'plak_done_at', today, (q) => q.eq('status', 'Completed')),
    openOrders(d.db),
    openTasks(d.db),
    d.db.from('bot_tasks').select('id, text').gte('done_at', `${today}T00:00:00+08:00`).then(({ data }) => data || []),
  ]);
  const tomorrowShips = orders.filter((o) => myDay(o.shipment_date) === shiftDay(today, 1));
  const text = [
    `🌙 <b>今日报告 · ${showDay(today)}</b>`,
    `🆕 新单 ${placed.n}（${rm(placed.total)}）· 🔍 review ${reviewed.n} · 🧾 invoice ${invoiced.n} · ⌨️ typing ${typed.n} · ✅ 完成 ${completed.n}`,
    `📝 待办：今天完成 ${doneTasks.length}，还有 ${tasks.length}`,
    folded([...doneTasks.map((t: Row) => `✔ ${d.esc(t.text)}`), ...taskLines(d, tasks, today)]),
    `🚚 明天出货 ${tomorrowShips.length}`,
    folded(listLines(d, tomorrowShips, shipLine(d))),
  ].filter(Boolean).join('\n');
  await d.send(text);
}

// New problems since the morning report, asked in one message
async function askNewProblems(d: ReportDeps, today: string) {
  const fresh = [];
  for (const p of problemsOf(await openOrders(d.db), today)) if (!(await wasSent(d.db, p.key))) fresh.push(p);
  if (!fresh.length) return 0;
  await d.send([`❓ <b>老板，${fresh.length} 张单要你回答</b>`, ...fresh.slice(0, SHOWN).map((p) => `• ${p.text(d)}`), '<i>回复这则讯息告诉我。</i>'].join('\n'));
  await markSent(d.db, fresh.map((p) => p.key));
  return fresh.length;
}

// One run (every 3 minutes): whatever is due now and not yet sent
export async function runReports(d: ReportDeps, now: { day: string; time: string }) {
  const done: string[] = [];
  if (within(now.time, MORNING) && !(await wasSent(d.db, `morning:${now.day}`))) {
    await morningReport(d, now.day);
    await markSent(d.db, [`morning:${now.day}`]);
    done.push('morning');
  }
  if (within(now.time, EVENING) && !(await wasSent(d.db, `evening:${now.day}`))) {
    await eveningReport(d, now.day);
    await markSent(d.db, [`evening:${now.day}`]);
    done.push('evening');
  }
  // the AI credit, any time of day — a stopped AI can't wait for the morning
  const credit = await creditAlerts(d, now.day).catch((err) => { console.error('credit alert failed:', err); return 0; });
  if (credit) done.push(`credit ${credit}`);
  // questions only once the day's morning report is out (it lists the ones already there)
  if (within(now.time, ASKING) && await wasSent(d.db, `morning:${now.day}`)) {
    const asked = await askNewProblems(d, now.day);
    if (asked) done.push(`asked ${asked}`);
  }
  return done;
}
