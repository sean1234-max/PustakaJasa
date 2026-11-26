// The form bot lets the salesman finish first (Sean, 2026-11-26): he often sends the kertas kerja, then what to
// do with it in a message of its own. Each message waits in bot_inbox (migration 0133); only when 15 seconds
// pass with nothing new from him does the last message's run read them all, in order (planBatch).

import { db } from './db.ts';
import { readDraftList } from './orderDraft.ts';

type Msg = Record<string, any>;

export const QUIET_MS = 15_000;
const KEEP_DAYS = 7;
// a message left waiting longer (its run stopped) is not read with a later one — a day-old note must not join
// tomorrow's kertas kerja
const STALE_MS = 10 * 60_000;
const CANCEL_RE = /^\s*(cancel|batal)\s*$/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const todayMy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
const hasFile = (m: Msg) => !!(m.document || (Array.isArray(m.photo) && m.photo.length));

/** A text that only says something about the files sent with it (not a list, not "cancel") */
const isNote = (m: Msg) => !hasFile(m) && !!String(m.text ?? '').trim()
  && !readDraftList(String(m.text), todayMy()) && !CANCEL_RE.test(String(m.text));

/**
 * The quiet batch in the order to run it: one step per message, an album's messages in one step (they run side
 * by side, as Telegram sends them). With `mergeNotes` and a file sent on its own, the notes go into that file's
 * caption — what the bot reads with it — and aren't answered on their own.
 */
export function planBatch(msgs: Msg[], mergeNotes: boolean): Msg[][] {
  const sorted = [...msgs].sort((a, b) => a.message_id - b.message_id);
  const files = sorted.filter((m) => hasFile(m) && !m.media_group_id);
  const notes = mergeNotes && files.length ? sorted.filter(isNote) : [];
  const noteText = notes.map((m) => String(m.text).trim()).join('\n');
  const steps: Msg[][] = [];
  const albums = new Map<string, Msg[]>();
  for (const m of sorted) {
    if (notes.includes(m)) continue;
    if (m.media_group_id) {
      if (!albums.has(m.media_group_id)) { const step: Msg[] = []; albums.set(m.media_group_id, step); steps.push(step); }
      albums.get(m.media_group_id)!.push(m);
      continue;
    }
    steps.push([files.includes(m) && noteText ? { ...m, caption: [m.caption, noteText].filter(Boolean).join('\n') } : m]);
  }
  return steps;
}

/**
 * Keep this message, wait for the salesman to stop sending, then → every message of his still waiting (this one
 * included) and the "Reading message…" notes to take off; null when a newer message came: that one's run reads
 * this one too. `announce()` sends that note (→ its message id) — once per batch, for its first message.
 */
export async function waitForQuiet(msg: Msg, {
  client = db, wait = sleep, quietMs = QUIET_MS, announce = async (): Promise<number | null> => null,
} = {}): Promise<{ msgs: Msg[]; statusIds: number[] } | null> {
  const chatId = msg.chat.id;
  const userId = Number(msg.from?.id);
  const fresh = () => new Date(Date.now() - STALE_MS).toISOString();
  const mine = () => client.from('bot_inbox');
  const { error } = await mine().upsert({ chat_id: chatId, telegram_user_id: userId, message_id: msg.message_id, msg });
  if (error) {
    console.error('bot_inbox save failed — reading this message now:', error.message);
    return { msgs: [msg], statusIds: [] };
  }
  // the first of a batch says the bot is reading — one note however many he sends
  const { data: before } = await mine().select('message_id').eq('chat_id', chatId).eq('telegram_user_id', userId)
    .eq('taken', false).lt('message_id', msg.message_id).gte('created_at', fresh()).limit(1);
  if (!before?.length) {
    const statusId = await announce().catch(() => null);
    if (statusId) await mine().update({ status_message_id: statusId }).eq('chat_id', chatId).eq('message_id', msg.message_id);
  }
  await wait(quietMs);
  // a later message of his, waiting or already taken with this one by its own run
  const { data: newer } = await mine().select('message_id').eq('chat_id', chatId).eq('telegram_user_id', userId)
    .gt('message_id', msg.message_id).limit(1);
  if (newer?.length) return null;
  const { data: batch, error: takeError } = await mine().update({ taken: true }).eq('chat_id', chatId)
    .eq('telegram_user_id', userId).eq('taken', false).lte('message_id', msg.message_id)
    .gte('created_at', fresh()).select('msg, status_message_id');
  if (takeError) {
    console.error('bot_inbox take failed — reading this message alone:', takeError.message);
    return { msgs: [msg], statusIds: [] };
  }
  const old = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  await mine().delete().lt('created_at', old);
  if (!batch?.length) return null;
  return {
    msgs: batch.map((r: { msg: Msg }) => r.msg),
    statusIds: batch.map((r: { status_message_id: number | null }) => Number(r.status_message_id)).filter(Boolean),
  };
}
