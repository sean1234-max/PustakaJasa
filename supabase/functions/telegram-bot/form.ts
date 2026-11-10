// The form bot (Sean, 2026-11-04): a salesman sends a teacher's kertas kerja (PDF, Word, Excel or a
// photo) in a private chat; the bot reads it and sends back FORM ANUGERAH filled in — ORDER LAIN-LAIN,
// the MP THP sheets and SELEMPANG (2026-11-05) — for the salesman to check, finish (KOD) and upload as usual. The
// website's own filler writes the form (templateExport.js, bundled as form.bundle.js), so it reads
// back exactly like a hand-filled one.
// Where: a private chat, or a salesman's own group (Sean + the bot + one salesman; every file sent there
// is filled in — the bot's Group Privacy must be off to see them).
// The Function Details list (orderDraft.ts) with a FORM ANUGERAH — its caption, a reply to it, or sent
// together with it and the kertas kerja — isn't read by AI: the bot puts the order in for the salesman
// (orderChat.ts, Sean 2026-11-07; before that it made a website draft, 0114). The salesman links his
// Telegram once with the code his website dashboard shows.
// Who may use it: members of the groups in FORM_BOT_GROUP_IDS (default: the Production group), and
// groups one of them made (an admin). The bot must be in FORM_BOT_GROUP_IDS' groups to check.

import { DOMParser, XMLSerializer } from 'npm:@xmldom/xmldom@0.9.12';
import { esc, MAX_FILE_BYTES } from './telegram.ts';
import { formBot } from './formBot.ts';
import { groupSalesman, handleOrderMessage, startFromForm } from './orderChat.ts';
import * as XLSX from 'npm:xlsx@0.18.5';
import { tr, folded, topLines, langOfProfile, langOfTelegramUser, type Lang } from './i18n.ts';
import { readFile, type FileContent } from './files.ts';
import { readForm } from './ai.ts';
import { db } from './db.ts';
import { readFormCached } from './formCache.ts';
import { toFormPlaques, toFormSelempang, type ReadPlaque, type ReadSelempang } from './formPlaques.ts';
import { ruleRead, type TableRead } from './ruleRead.ts';
import { logUsage } from './usage.ts';
// @ts-ignore a plain JS bundle
import { fillOrderTemplate, loadDocx, readWordingTables } from './form.bundle.js';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const GROUPS = (Deno.env.get('FORM_BOT_GROUP_IDS') ?? Deno.env.get('TELEGRAM_CHAT_ID') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
export { formBot };

const LIST_SAMPLE = 'SEKOLAH NAMA:\nCIKGU NAMA:\nPHONE NUMBER:\nKETUA PANITIA:\nTERMS:\nSHIPMENT DATE:\nFUNCTION DATE:';
const help = (lang: Lang) => tr(lang)(
  `1️⃣ Send the teacher's kertas kerja → I fill FORM ANUGERAH.\n2️⃣ Reply to the form with this list → I check it and you tap Submit:\n<code>${LIST_SAMPLE}</code>\nLanguage: /lang zh`,
  `1️⃣ 发老师的 kertas kerja 给我 → 我填好 FORM ANUGERAH。\n2️⃣ 回复那份 Excel，贴上这个清单 → 我检查后，你按 Submit：\n<code>${LIST_SAMPLE}</code>\nLanguage: /lang en`,
);
const LANG_RE = /^\s*\/lang(?:@\w+)?\s+(en|zh)\s*$/i;

type Msg = Record<string, any>;

const LINK_CODE_RE = /^\s*(?:\/link\s+)?(\d{6})\s*$/i;

// The 6-digit code from the salesman's website dashboard: this Telegram account is now that salesman
async function linkTelegram(msg: Msg, code: string) {
  const say = (html: string) => formBot.reply(msg.chat.id, msg.message_id, html);
  const t = tr(await langOfTelegramUser(db, Number(msg.from?.id)));
  const { data: row, error } = await db.from('telegram_link_codes').select('profile_id, expires_at').eq('code', code).maybeSingle();
  if (error) throw error;
  if (!row || Date.parse(row.expires_at) < Date.now()) {
    return say(t('❌ Wrong or expired code — press <b>Connect Telegram</b> on the website for a new one.', '❌ 代码不对或过期了 — 在网站按 <b>Connect Telegram</b> 拿新的。'));
  }
  // one Telegram account per salesman, one salesman per Telegram account
  const { error: clearError } = await db.from('telegram_links').delete().or(`telegram_user_id.eq.${Number(msg.from?.id)},profile_id.eq.${row.profile_id}`);
  if (clearError) throw clearError;
  const { error: linkError } = await db.from('telegram_links').insert({ telegram_user_id: msg.from?.id, profile_id: row.profile_id });
  if (linkError) throw linkError;
  await db.from('telegram_link_codes').delete().eq('code', code);
  const { data: who } = await db.from('profiles').select('display_name').eq('id', row.profile_id).maybeSingle();
  const lang = await langOfTelegramUser(db, Number(msg.from?.id));
  return say(`${tr(lang)(`✅ Linked: <b>${esc(who?.display_name || '')}</b>`, `✅ 已连接：<b>${esc(who?.display_name || '')}</b>`)}\n\n${help(lang)}`);
}

// "/lang en" / "/lang zh": the language this salesman reads the bots in (bot_langs, 0120)
async function setLang(msg: Msg, lang: Lang) {
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', Number(msg.from?.id)).maybeSingle();
  if (!link) return formBot.reply(msg.chat.id, msg.message_id, 'Connect Telegram on the website first. / 请先在网站连接 Telegram。');
  const { error } = await db.from('bot_langs').upsert({ profile_id: link.profile_id, lang, set_at: new Date().toISOString() });
  if (error) throw error;
  return formBot.reply(msg.chat.id, msg.message_id, lang === 'en' ? '✅ English from now on.' : '✅ 以后用华文。');
}

// A private chat: the sender is in one of GROUPS. A salesman's group (Sean + the bot + one salesman,
// Sean 2026-11-04): one of its admins is — the person who made it, never the salesman.
async function allowed(msg: Msg) {
  if (msg.chat.type === 'private') return formBot.inAnyGroup(msg.from?.id, GROUPS);
  for (const id of await formBot.adminIds(msg.chat.id)) if (await formBot.inAnyGroup(id, GROUPS)) return true;
  return false;
}

// The language to answer a file in: the sender's own (a salesman); Sean / Production sending one in a
// salesman's group get that salesman's (Fida's group was answered in Chinese, 2026-11-10)
async function replyLang(msg: Msg): Promise<Lang> {
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', Number(msg.from?.id)).maybeSingle();
  if (link?.profile_id || msg.chat?.type === 'private') return langOfProfile(db, link?.profile_id);
  return langOfProfile(db, (await groupSalesman(msg.chat.id, Number(msg.from?.id)))?.id);
}

export async function handleForm(msg: Msg, aiAllowed: () => Promise<unknown>) {
  const chatId = msg.chat.id;
  const inGroup = msg.chat?.type !== 'private';
  const doc = msg.document;
  const photo = Array.isArray(msg.photo) ? msg.photo[msg.photo.length - 1] : null;
  const file = doc || photo;
  // a link code, or a FORM ANUGERAH with the Function Details list: no AI, so before the rest
  if (!(inGroup && GROUPS.includes(String(chatId)))) {
    const code = LINK_CODE_RE.exec(String(msg.text ?? ''));
    if (code) return linkTelegram(msg, code[1]);
    const lang = LANG_RE.exec(String(msg.text ?? ''));
    if (lang) return setLang(msg, lang[1].toLowerCase() as Lang);
    // the order chat: a list, or an answer to its question (orderChat.ts)
    if (await handleOrderMessage(msg, aiAllowed)) return;
  }
  if (inGroup && !file) return; // a group's own chatter
  // the Production group is the review bot's (@PjsbReviewAgent compares files there); this bot is in it
  // only to check who may use it (Sean 2026-11-05: it filled a form for a compare request)
  if (inGroup && GROUPS.includes(String(chatId))) return;
  const lang = await replyLang(msg);
  const t = tr(lang);
  const say = (html: string) => formBot.reply(chatId, msg.message_id, html);
  if (!(await allowed(msg))) return say('Sorry, this bot is only for Pustaka Jasa salesmen. / 这个 bot 只给 Pustaka Jasa 的 salesman 用。');
  if (!file) return say(help(lang));
  if ((file.file_size || 0) > MAX_FILE_BYTES) return say(t('❌ Too big (20 MB max).', '❌ 文件太大（最多 20 MB）。'));
  const fileName = doc?.file_name || 'photo.jpg';
  const bytes = await formBot.downloadFile(file.file_id);
  // a FORM ANUGERAH already (the salesman's own, or the bot's sent back): nothing to fill — the list to submit
  // it is handed out instead (orderChat.ts, Sean 2026-11-10)
  if (isFormAnugerah(bytes, fileName)) return startFromForm(msg, { fileId: file.file_id, name: fileName }, []);
  const content = readFile(bytes, fileName);
  if (!content) return say(t('❌ I can\'t read this — send PDF, Word, Excel or a photo.', '❌ 读不了这个文件 — 请发 PDF、Word、Excel 或照片。'));
  if (!(await aiAllowed())) return say(t('❌ AI budget used up this month — please fill it by hand.', '❌ 这个月的 AI 额度用完了 — 请手动填。'));
  await say(t('📝 Filling FORM ANUGERAH… (1–2 min)', '📝 正在填 FORM ANUGERAH…（1–2 分钟）'));
  const filled = await fillForm(content, fileName, String(msg.caption ?? '').trim(), bytes, lang);
  if (!filled.ok) return say(filled.message);
  const sent = await formBot.sendDocument(chatId, msg.message_id, filled.buffer, filled.fileName, filled.caption);
  // replying to this form with the list puts the order in, with this kertas kerja on it (orderChat.ts)
  if (sent) {
    const { error: srcError } = await db.from('bot_form_sources').insert({ chat_id: chatId, message_id: sent.messageId, file_id: file.file_id, file_name: fileName });
    if (srcError) console.error('bot_form_sources insert failed:', srcError.message);
  }
  if (filled.questionsHtml) await formBot.reply(chatId, msg.message_id, filled.questionsHtml);
  // then the list to submit it, the school and teacher it read already in (Sean, 2026-11-10)
  if (sent?.fileId) {
    await startFromForm(msg, { fileId: sent.fileId, name: filled.fileName }, [{ fileId: file.file_id, name: fileName }], { sekolah: filled.front.sekolah, cikgu: filled.front.cikgu });
  }
}

// The website's FORM ANUGERAH (its own sheets), not a teacher's kertas kerja that happens to be an Excel
function isFormAnugerah(bytes: Uint8Array, fileName: string) {
  if (!/\.xlsx$/i.test(fileName)) return false;
  try {
    const names = XLSX.read(bytes, { type: 'array', bookSheets: true }).SheetNames.map((n: string) => n.trim().toUpperCase());
    return names.includes('FRONT PG') && names.includes('ORDER LAIN-LAIN');
  } catch {
    return false;
  }
}

// A Word file whose order is a WORDING / KUANTITI table, read by rules (ruleRead.ts) — null when the
// rules aren't sure (then the AI reads it). Salesman's notes need the AI too. Logged at no cost.
async function readByRules(bytes: Uint8Array | undefined, fileName: string, notes: string) {
  if (!bytes || notes || !/\.docx$/i.test(fileName)) return null;
  const doc = await loadDocx(bytes, DOMParser);
  const result = doc ? ruleRead(readWordingTables(doc) as TableRead) : { ok: false as const, why: 'not a Word file' };
  if (!result.ok) {
    console.log(`rules can't read ${fileName}: ${result.why}`);
    return null;
  }
  await logUsage('read_form_rules', 'rules', null, fileName);
  return { input: result.input, cached: false, rules: true };
}

// The kertas kerja → FORM ANUGERAH filled in (also the assistant's "ExcelFormAgent" job, assistant.ts).
// `bytes`: the file itself, for the no-AI Word reader.
// `lang`: the salesman's (i18n.ts) — the caption and the questions; Sean's assistant passes 'zh'.
export async function fillForm(content: FileContent, fileName: string, notes: string, bytes?: Uint8Array, lang: Lang = 'zh') {
  const t = tr(lang);
  const read = await readByRules(bytes, fileName, notes) ?? await readFormCached(db, readForm, content, fileName, notes);
  if (!read) return { ok: false as const, message: t('❌ Couldn\'t read that file — try again or send a clearer copy.', '❌ 读不了这个文件 — 请再试一次，或发清楚一点的。') };
  const plaques = toFormPlaques(read.input.plaques as ReadPlaque[]);
  const selempang = toFormSelempang(read.input.selempang as ReadSelempang[]);
  if (!plaques.length && !selempang.length) return { ok: false as const, message: t('❌ No plaques or sashes found in that file.', '❌ 这个文件里找不到牌子或 selempang。') };

  const res = await fetch(`${SITE_URL}/templates/FORM-ANUGERAH.xlsx`);
  if (!res.ok) throw new Error(`template download ${res.status}`);
  const front = { sekolah: String(read.input.school || ''), cikgu: String(read.input.teacher || '') };
  const out = await fillOrderTemplate(await res.arrayBuffer(), { plaques, selempang, front, priceOf: () => null }, { DOMParser, XMLSerializer });

  const placed = Object.entries(out.placed as Record<string, number>);
  const total = placed.reduce((a, [, n]) => a + n, 0);
  const noKod = plaques.filter((p) => !p.code).length;
  const sashes = selempang.reduce((a, s) => a + s.qty, 0);
  const noWarna = selempang.filter((s) => !s.warna).length;
  // the point first (Sean, 2026-11-08): what it is, how many, what to do — the rest folded
  const warn = [
    ...(noKod ? [t(`KOD empty on ${noKod} row(s)`, `${noKod} 行没有 KOD`)] : []),
    ...(noWarna ? [t(`WARNA empty on ${noWarna} selempang row(s)`, `${noWarna} 行 selempang 没有颜色`)] : []),
    ...(total < out.plaqueCount ? [t(`${out.plaqueCount - total} plaque(s) didn't fit — add by hand`, `${out.plaqueCount - total} 块放不进表格 — 请手动加`)] : []),
  ];
  const captionLines = [
    `📄 <b>${esc(front.sekolah || fileName)}</b>`,
    `${t(`${total} plaque(s)`, `${total} 块`)}${sashes ? ` · ${t(`${sashes} selempang`, `${sashes} 条 selempang`)}` : ''}${read.cached || 'rules' in read ? ` · ${t('no AI cost', '没用 AI 费用')}` : ''}`,
    ...warn.map((w) => `⚠️ ${esc(w)}`),
    t('👉 Check it, then reply to this file with the order list.', '👉 检查后，回复这份文件，贴上订单资料清单。'),
  ];
  const sheets = folded(placed.map(([sheet, n]) => `${esc(sheet)}: ${n}`).join('\n'));
  // a caption holds 1024 characters: the folded sheet list only when it fits whole (a cut tag breaks it)
  const caption = [...captionLines, ...(captionLines.join('\n').length + sheets.length < 1000 ? [sheets] : [])].filter(Boolean).join('\n');
  const asks = ((read.input.questions as unknown[]) || []).map((x) => (typeof x === 'string' ? x : String((x as Record<string, string>)[lang] || (x as Record<string, string>).en || '')))
    .filter(Boolean);
  const fyi = (out.notes as string[]) || [];
  const questionsHtml = asks.length || fyi.length ? [
    ...(asks.length ? [t(`⚠️ <b>${asks.length} to confirm with the teacher:</b>`, `⚠️ <b>${asks.length} 个要和老师确认：</b>`), ...topLines(asks.map((x, i) => `${i + 1}. ${esc(x)}`), 5, lang)] : []),
    folded([...asks.slice(5).map((x, i) => `${i + 6}. ${esc(x)}`), ...fyi.map((x) => `ℹ️ ${esc(x)}`)].join('\n')),
  ].filter(Boolean).join('\n') : '';
  const base = (front.sekolah || fileName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'ORDER';
  return {
    ok: true as const, buffer: out.buffer as Uint8Array, fileName: `${base} (FORM ANUGERAH).xlsx`, caption, total,
    questionsHtml, notes: [...asks, ...fyi], front,
  };
}
