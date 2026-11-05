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

const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
const myDay = (v: unknown) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(String(v))) : '');
const showDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
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

// The problems, each with the key it's asked under
export function problemsOf(orders: Row[], today: string, now = Date.now()) {
  const tomorrow = shiftDay(today, 1);
  const out: { key: string; text: (d: ReportDeps) => string }[] = [];
  for (const o of orders) {
    const ship = myDay(o.shipment_date);
    const name = (d: ReportDeps) => `${d.orderLink(o.id)} ${d.esc(o.sekolah)}${o.sales ? ` (${d.esc(o.sales)})` : ''}`;
    if (ship && ship < today) {
      out.push({ key: `ask:late:${o.id}:${ship}`, text: (d) => `${name(d)} — Shipment Date was ${showDay(ship)} but it's still <b>${d.esc(stage(o))}</b>. Has it gone out? If yes, press Done on the website; if not, what's the new date?` });
    } else if (ship && ship <= tomorrow && ['Reviewing Order', 'Salesman Approved'].includes(o.status)) {
      out.push({ key: `ask:soon:${o.id}:${ship}`, text: (d) => `${name(d)} — ships ${ship === today ? 'TODAY' : 'tomorrow'} but is only <b>${d.esc(stage(o))}</b>. Can we make it, or should the date move?` });
    } else if (o.status === 'Reviewing Order' && o.reviewed_at && now - Date.parse(o.reviewed_at) > STUCK_DONE_REVIEW_DAYS * MS_PER_DAY) {
      const days = Math.floor((now - Date.parse(o.reviewed_at)) / MS_PER_DAY);
      out.push({ key: `ask:stuck:${o.id}`, text: (d) => `${name(d)} — Done Review ${days} days ago, the salesman still hasn't approved. Shall I remind them, or chase it yourself?` });
    }
  }
  return out;
}

function listLines(d: ReportDeps, rows: Row[], line: (o: Row) => string) {
  return [...rows.slice(0, SHOWN).map(line), ...(rows.length > SHOWN ? [`… and ${rows.length - SHOWN} more`] : [])];
}

function taskLines(d: ReportDeps, tasks: Row[], today: string) {
  if (!tasks.length) return ['Nothing on your list.'];
  return tasks.map((t) => `${t.id}. ${d.esc(t.text)}${t.due_date ? (t.due_date < today ? ` ❗ was due ${showDay(t.due_date)}` : t.due_date === today ? ' ⏰ today' : ` (by ${showDay(t.due_date)})`) : ''}`);
}

const shipLine = (d: ReportDeps) => (o: Row) => `• ${d.orderLink(o.id)} ${d.esc(o.sekolah)} — ${d.esc(stage(o))}${o.urgent ? ' 🔥' : ''}`;

async function morningReport(d: ReportDeps, today: string) {
  const yesterday = shiftDay(today, -1);
  const [orders, placed, tasks] = await Promise.all([openOrders(d.db), countOn(d.db, 'created_at', yesterday), openTasks(d.db)]);
  const by = (s: string) => orders.filter((o) => stage(o) === s).length;
  const shipsOn = (day: string) => orders.filter((o) => myDay(o.shipment_date) === day);
  const problems = problemsOf(orders, today);
  const text = [
    `🌅 <b>Good morning boss — ${showDay(today)}</b>`,
    `Yesterday: ${placed.n} new order(s), ${rm(placed.total)}`,
    '',
    `⏳ To review: ${by('Reviewing Order')}`,
    `✅ Done Review, waiting for the salesman: ${by('Done Review')}`,
    `🧾 Salesman Approved, waiting for the invoice: ${by('Salesman Approved')}`,
    `🏭 In Production: ${by('In Production')}`,
    '',
    `🚚 <b>Shipping today (${shipsOn(today).length})</b>`, ...listLines(d, shipsOn(today), shipLine(d)),
    `🚚 <b>Shipping tomorrow (${shipsOn(shiftDay(today, 1)).length})</b>`, ...listLines(d, shipsOn(shiftDay(today, 1)), shipLine(d)),
    ...(problems.length ? ['', `❗ <b>Need your answer (${problems.length})</b>`, ...problems.slice(0, SHOWN).map((p) => `• ${p.text(d)}`)] : []),
    '',
    '📝 <b>Your list</b>', ...taskLines(d, tasks, today),
  ].join('\n');
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
    `🌙 <b>Today's report — ${showDay(today)}</b>`,
    `🆕 New orders: ${placed.n} (${rm(placed.total)})`,
    `🔍 Reviewed: ${reviewed.n}`,
    `🧾 Invoiced: ${invoiced.n}`,
    `⌨️ Typed: ${typed.n}`,
    `✅ Completed: ${completed.n}`,
    '',
    `📝 <b>Your list</b> — ${doneTasks.length} done today`,
    ...doneTasks.map((t: Row) => `✔ ${d.esc(t.text)}`),
    ...taskLines(d, tasks, today),
    '',
    `🚚 <b>Shipping tomorrow (${tomorrowShips.length})</b>`, ...listLines(d, tomorrowShips, shipLine(d)),
  ].join('\n');
  await d.send(text);
}

// New problems since the morning report, asked in one message
async function askNewProblems(d: ReportDeps, today: string) {
  const fresh = [];
  for (const p of problemsOf(await openOrders(d.db), today)) if (!(await wasSent(d.db, p.key))) fresh.push(p);
  if (!fresh.length) return 0;
  await d.send([`❓ <b>Boss, I need your answer on ${fresh.length} order(s)</b>`, ...fresh.slice(0, SHOWN).map((p) => `• ${p.text(d)}`), '', '<i>Reply to this message and tell me.</i>'].join('\n'));
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
  // questions only once the day's morning report is out (it lists the ones already there)
  if (within(now.time, ASKING) && await wasSent(d.db, `morning:${now.day}`)) {
    const asked = await askNewProblems(d, now.day);
    if (asked) done.push(`asked ${asked}`);
  }
  return done;
}
