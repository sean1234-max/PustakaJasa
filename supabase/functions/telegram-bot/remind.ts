// Sean's assistant reminds a salesman about an order (Sean, 2026-11-09: "Shall I remind them?" — "yes" did
// nothing, the assistant had no way to reach the salesman). ReviewAgent posts it in the salesman's own group
// (salesman_groups, "@PjsbReviewAgent link"), in his language, him mentioned, with the order's link:
//   • Done Review, not yet approved → "reviewed — please approve it on the website"
//   • anything else → the order and Sean's note
// Sean's own words (`note`) go along as they are.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { tr, langOfProfile } from './i18n.ts';
import { dueReminders } from './remindPlan.ts';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Sender = { ask: (chatId: number | string, replyTo: number | null, html: string) => Promise<number | null> };

// `round` 2: the automatic second reminder (runApprovalReminders)
export async function remindSalesman(db: SupabaseClient, bot: Sender, orderId: string, note: string, round = 1) {
  const { data: o } = await db.from('orders').select('id, sekolah, status, reviewed_at, salesman_id, sales').eq('id', orderId).maybeSingle();
  if (!o) return { error: `no order ${orderId}` };
  if (!o.salesman_id) return { error: `${orderId} has no salesman` };
  const { data: g } = await db.from('salesman_groups').select('chat_id').eq('profile_id', o.salesman_id).order('linked_at', { ascending: false }).limit(1).maybeSingle();
  if (!g) return { error: `${o.sales || 'the salesman'} has no group linked yet — Sean types "/link@PjsbReviewAgent" once in that group` };
  const { data: link } = await db.from('telegram_links').select('telegram_user_id').eq('profile_id', o.salesman_id).maybeSingle();
  const t = tr(await langOfProfile(db, o.salesman_id));
  const who = link ? `<a href="tg://user?id=${link.telegram_user_id}">${esc(o.sales || 'Salesman')}</a>` : esc(o.sales || '');
  const order = `<a href="${SITE_URL}/#/sales/orders/${encodeURIComponent(o.id)}">${esc(o.id)}</a> · ${esc(o.sekolah)}`;
  const waitingApproval = o.status === 'Reviewing Order' && o.reviewed_at;
  const html = [
    `🔔 ${who} ${order}${round > 1 ? ` · ${t('2nd reminder', '第二次提醒')}` : ''}`,
    waitingApproval
      ? t('✅ Reviewed — please <b>approve</b> it on the website.', '✅ 已经 review 好了 — 请上网站 <b>approve</b>。')
      : t(`Status: ${esc(o.status)}`, `状态：${esc(o.status)}`),
    ...(note.trim() ? [`📝 Sean: ${esc(note.trim())}`] : []),
  ].join('\n');
  const sent = await bot.ask(g.chat_id, null, html);
  return sent ? { sent: `reminded ${o.sales || 'the salesman'} in his group about ${o.id}` } : { error: 'Telegram did not take the message (is ReviewAgent still in that group?)' };
}

const MAX_PER_RUN = 10;

// Every Done Review order gets its salesman reminded at once, and again after 2 days if it still waits
// (remindPlan.ts). Run with telegram-notify's 3-minute run (telegram-bot ?job=approvals). A salesman with no
// group linked is skipped — Sean's own "still not approved" question (reports.ts) covers him.
export async function runApprovalReminders(db: SupabaseClient, bot: Sender) {
  const { data: orders, error } = await db.from('orders').select('id, status, reviewed_at, cancelled_at')
    .eq('status', 'Reviewing Order').not('reviewed_at', 'is', null).is('cancelled_at', null);
  if (error) throw error;
  if (!orders?.length) return { reminded: 0 };
  const keys = (orders).flatMap((o) => [1, 2].map((r) => `approve:${r}:${o.id}:${o.reviewed_at}`));
  const { data: sentRows } = await db.from('telegram_sent').select('key').in('key', keys);
  const due = dueReminders(orders, new Set((sentRows || []).map((r) => r.key))).slice(0, MAX_PER_RUN);
  const results = [];
  for (const d of due) {
    // marked first: a failure isn't retried every 3 minutes (Sean hears about a stuck order anyway)
    const { error: markError } = await db.from('telegram_sent').insert({ key: d.key });
    if (markError) continue; // another run took it
    results.push({ ...d, ...(await remindSalesman(db, bot, d.id, '', d.round)) });
  }
  return { reminded: results.length, results };
}
