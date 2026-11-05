// The form bot (Sean, 2026-11-04): a salesman sends a teacher's kertas kerja (PDF, Word, Excel or a
// photo) in a private chat; the bot reads it and sends back FORM ANUGERAH filled in — ORDER LAIN-LAIN,
// the MP THP sheets and SELEMPANG (2026-11-05) — for the salesman to check, finish (KOD) and upload as usual. The
// website's own filler writes the form (templateExport.js, bundled as form.bundle.js), so it reads
// back exactly like a hand-filled one.
// Where: a private chat, or a salesman's own group (Sean + the bot + one salesman; every file sent there
// is filled in — the bot's Group Privacy must be off to see them).
// Who may use it: members of the groups in FORM_BOT_GROUP_IDS (default: the Production group), and
// groups one of them made (an admin). The bot must be in FORM_BOT_GROUP_IDS' groups to check.

import { DOMParser, XMLSerializer } from 'npm:@xmldom/xmldom@0.9.12';
import { esc, telegramBot, MAX_FILE_BYTES } from './telegram.ts';
import { readFile, type FileContent } from './files.ts';
import { readForm } from './ai.ts';
import { db } from './db.ts';
import { readFormCached } from './formCache.ts';
import { toFormPlaques, toFormSelempang, type ReadPlaque, type ReadSelempang } from './formPlaques.ts';
// @ts-ignore a plain JS bundle
import { fillOrderTemplate } from './form.bundle.js';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const GROUPS = (Deno.env.get('FORM_BOT_GROUP_IDS') ?? Deno.env.get('TELEGRAM_CHAT_ID') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
export const formBot = telegramBot(Deno.env.get('TELEGRAM_FORM_BOT_TOKEN') ?? '');

const HELP = 'Send me the teacher\'s kertas kerja (PDF, Word, Excel or a photo) and I\'ll fill in FORM ANUGERAH for you. You can write notes in the caption, e.g. "semua PKC 263".';

type Msg = Record<string, any>;

// A private chat: the sender is in one of GROUPS. A salesman's group (Sean + the bot + one salesman,
// Sean 2026-11-04): one of its admins is — the person who made it, never the salesman.
async function allowed(msg: Msg) {
  if (msg.chat.type === 'private') return formBot.inAnyGroup(msg.from?.id, GROUPS);
  for (const id of await formBot.adminIds(msg.chat.id)) if (await formBot.inAnyGroup(id, GROUPS)) return true;
  return false;
}

export async function handleForm(msg: Msg, aiAllowed: () => Promise<boolean>) {
  const chatId = msg.chat.id;
  const inGroup = msg.chat?.type !== 'private';
  const doc = msg.document;
  const photo = Array.isArray(msg.photo) ? msg.photo[msg.photo.length - 1] : null;
  const file = doc || photo;
  if (inGroup && !file) return; // a group's own chatter
  // the Production group is the review bot's (@PjsbReviewAgent compares files there); this bot is in it
  // only to check who may use it (Sean 2026-11-05: it filled a form for a compare request)
  if (inGroup && GROUPS.includes(String(chatId))) return;
  if (/\(FORM ANUGERAH\)\.xlsx$/i.test(doc?.file_name || '')) return; // the bot's own form, forwarded back
  if (!(await allowed(msg))) {
    return formBot.reply(chatId, msg.message_id, 'Sorry, this bot is only for Pustaka Jasa salesmen. Please ask Sean to add you.');
  }
  if (!file) return formBot.reply(chatId, msg.message_id, HELP);
  if ((file.file_size || 0) > MAX_FILE_BYTES) return formBot.reply(chatId, msg.message_id, 'That file is too big for me (20 MB at most).');
  const fileName = doc?.file_name || 'photo.jpg';
  const content = readFile(await formBot.downloadFile(file.file_id), fileName);
  if (!content) return formBot.reply(chatId, msg.message_id, `I can't read "${esc(fileName)}" — send a PDF, Word (.docx), Excel or a photo.`);
  if (!(await aiAllowed())) return formBot.reply(chatId, msg.message_id, 'The AI budget for this month is used up — please fill this one by hand.');
  await formBot.reply(chatId, msg.message_id, `📝 Reading ${esc(fileName)} and filling FORM ANUGERAH… (1–2 minutes)`);
  const filled = await fillForm(content, fileName, String(msg.caption ?? '').trim());
  if (!filled.ok) return formBot.reply(chatId, msg.message_id, filled.message);
  await formBot.sendDocument(chatId, msg.message_id, filled.buffer, filled.fileName, filled.caption);
  if (filled.notes.length) await formBot.reply(chatId, msg.message_id, ['❓ Please check:', ...filled.notes.map((n) => `• ${esc(n)}`)].join('\n'));
}

// The kertas kerja → FORM ANUGERAH filled in (also the assistant's "ExcelFormAgent" job, assistant.ts)
export async function fillForm(content: FileContent, fileName: string, notes: string) {
  const read = await readFormCached(db, readForm, content, fileName, notes);
  if (!read) return { ok: false as const, message: 'Sorry, I couldn\'t read that file. Please try again, or send a clearer copy.' };
  const plaques = toFormPlaques(read.input.plaques as ReadPlaque[]);
  const selempang = toFormSelempang(read.input.selempang as ReadSelempang[]);
  if (!plaques.length && !selempang.length) return { ok: false as const, message: 'I didn\'t find any plaques or sashes in that file.' };

  const res = await fetch(`${SITE_URL}/templates/FORM-ANUGERAH.xlsx`);
  if (!res.ok) throw new Error(`template download ${res.status}`);
  const front = { sekolah: String(read.input.school || ''), cikgu: String(read.input.teacher || '') };
  const out = await fillOrderTemplate(await res.arrayBuffer(), { plaques, selempang, front, priceOf: () => null }, { DOMParser, XMLSerializer });

  const placed = Object.entries(out.placed as Record<string, number>);
  const total = placed.reduce((a, [, n]) => a + n, 0);
  const noKod = plaques.filter((p) => !p.code).length;
  const sashes = selempang.reduce((a, s) => a + s.qty, 0);
  const noWarna = selempang.filter((s) => !s.warna).length;
  const caption = [
    `✅ FORM ANUGERAH — ${total} plaque(s)`,
    ...placed.map(([sheet, n]) => `• ${esc(sheet)}: ${n}`),
    ...(sashes ? [`• SELEMPANG: ${sashes} sash(es)`] : []),
    ...(noWarna ? [`⚠ WARNA is empty on ${noWarna} SELEMPANG row(s) — fill it in before you upload.`] : []),
    ...(noKod ? [`⚠ KOD is empty on ${noKod} row(s) — fill it in before you upload.`] : []),
    ...(total < out.plaqueCount ? [`⚠ ${out.plaqueCount - total} plaque(s) didn't fit the form — add them by hand.`] : []),
    ...(read.cached ? ['♻️ Same file as before — reused the earlier reading (no AI cost).'] : []),
    'Please check it against the teacher\'s file, then upload it on the website as usual.',
  ].join('\n');
  const base = (front.sekolah || fileName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'ORDER';
  return {
    ok: true as const, buffer: out.buffer as Uint8Array, fileName: `${base} (FORM ANUGERAH).xlsx`, caption, total,
    notes: [...((read.input.questions as string[]) || []), ...(out.notes as string[])],
  };
}
