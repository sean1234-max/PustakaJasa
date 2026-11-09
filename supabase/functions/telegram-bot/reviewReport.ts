// ReviewAgent's review in the salesman's group (autoReview.ts) — the words, no Telegram or database here.
// Short (Sean, 2026-11-08): one headline, the whole list folded, then the questions ONE AT A TIME with
// buttons, so the salesman taps instead of typing; "✏️ Neither" is the only one that asks for words.

import { tr, folded, type Lang } from './i18n.ts';

const SITE_URL = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const orderLink = (id: string) => `<a href="${SITE_URL}/#/production/orders/${encodeURIComponent(id)}">${esc(id)}</a>`;

export type FileRef = { path: string; name: string };
export type Diff = { kind: string; where: string; inFile: string; inOrder: string };
export type Red = { rule: string; level: string; text: string; sheet: string; count: number; find?: string; wordList?: string[]; word?: string };
export type Answer = { pick: string; text?: string };
export type Question = { n: number; html: string; options: { key: string; label: string }[] };

// The teacher's own file(s): the kertas kerja, else the order file (a FORM ANUGERAH the teacher filled)
export function teacherFiles(o: { kertas_kerja_files: FileRef[] | null; import_files: FileRef[] | null; import_file_path: string | null; import_file_name: string | null }): FileRef[] {
  if (o.kertas_kerja_files?.length) return o.kertas_kerja_files;
  if (o.import_files?.length) return o.import_files;
  return o.import_file_path ? [{ path: o.import_file_path, name: o.import_file_name || 'order.xlsx' }] : [];
}

const q = (s: string) => `「${esc(s)}」`;
const redWords = (r: Red) => (r.wordList?.length ? r.wordList.join(', ') : r.find || r.word || '');

// Every question of a review, numbered: the kertas kerja differences first, then the red lines
export function reviewQuestions(diffs: Diff[], red: Red[], lang: Lang): Question[] {
  const t = tr(lang);
  const out: Question[] = [];
  const add = (html: string, options: [string, string][]) => out.push({ n: out.length + 1, html, options: options.map(([key, label]) => ({ key, label })) });
  const neither = ['other', t('✏️ Neither', '✏️ 都不对')] as [string, string];
  diffs.forEach((d) => {
    const where = `<b>${esc(d.where)}</b>`;
    if (d.kind === 'missing_in_order') {
      add(`${where}\n${t('In the kertas kerja, not in the order', '老师有，订单没有')}${d.inFile ? `: ${q(d.inFile)}` : ''}`,
        [['add', t('➕ Add it', '➕ 要加')], ['skip', t('🚫 Not needed', '🚫 不用加')], neither]);
    } else if (d.kind === 'extra_in_order') {
      add(`${where}\n${t('In the order, not in the kertas kerja', '订单有，老师没有')}${d.inOrder ? `: ${q(d.inOrder)}` : ''}`,
        [['remove', t('➖ Remove it', '➖ 要删')], ['keep', t('✅ Keep it', '✅ 保留')], neither]);
    } else {
      add(`${where}\n📄 ${t('Teacher', '老师')}: ${q(d.inFile || '—')}\n🌐 ${t('Order', '订单')}: ${q(d.inOrder || '—')}`,
        [['file', t('📄 Teacher is right', '📄 老师的对')], ['order', t('🌐 Order is right', '🌐 订单的对')], neither]);
    }
  });
  red.forEach((r) => {
    add(`<b>${esc(r.sheet)}</b>${r.count > 1 ? ` · ${r.count} ${t('plaques', '块')}` : ''}\n${t('Should this be RED?', '这个要红色吗？')} ${q(redWords(r))}`,
      [['red', t('🔴 Red', '🔴 红色')], ['black', t('⚫ Black', '⚫ 黑色')]]);
  });
  return out;
}

// The first message: what this is, how many questions, the whole list folded
export function reportHtml(o: { id: string; sekolah: string }, questions: Question[], fileNames: string[], mention: string, lang: Lang) {
  const t = tr(lang);
  const list = questions.map((x) => `${x.n}. ${x.html.replace(/\n/g, ' · ')}`).join('\n');
  return [
    `⚠️ <b>${orderLink(o.id)}</b> · ${esc(o.sekolah)}`,
    `${mention ? `${mention} ` : ''}${t(`${questions.length} thing(s) to check with the teacher — tap the answers below 👇`, `有 ${questions.length} 个要和老师确认 — 在下面按答案 👇`)}`,
    folded(`${t('Compared with', '对比文件')}: ${fileNames.map(esc).join(', ') || '—'}\n${list}`),
  ].filter(Boolean).join('\n');
}

export function questionHtml(x: Question, total: number) {
  return `❓ <b>${x.n}/${total}</b> · ${x.html}`;
}

// What a tapped answer reads as, for the question's own message and the summary
export function answerLabel(x: Question, a: Answer, lang: Lang) {
  const label = x.options.find((o) => o.key === a.pick)?.label || a.pick;
  return a.text ? `${label}: ${q(a.text)}` : label;
}

export function summaryHtml(o: { id: string; sekolah: string }, questions: Question[], answers: Record<string, Answer>, who: string, lang: Lang) {
  const t = tr(lang);
  return [
    `✅ <b>${orderLink(o.id)}</b> · ${t(`all answered by ${esc(who)}`, `${esc(who)} 已全部回答`)}`,
    ...questions.map((x) => `${x.n}. ${answers[x.n] ? answerLabel(x, answers[x.n], lang) : '—'}`),
    t('Production will update the order.', 'Production 会照这个更新订单。'),
  ].join('\n');
}

export function askForWords(lang: Lang) {
  return tr(lang)('✏️ Reply to this message with what it should be.', '✏️ 请回复这则讯息，写出正确的内容。');
}
