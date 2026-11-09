// What language a salesman reads the bots in (Sean, 2026-11-08): Fida, Nazrin and Wendy English, every
// other salesman Chinese — and "/lang en" / "/lang zh" to ExcelFormAgent changes it (bot_langs, 0120).
// Messages are written short (Sean: "少看字但是都能抓到重点"): the point first, details folded.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Lang = 'en' | 'zh';
export const ENGLISH_NAMES = /\b(fida|nazrin|wendy)\b/i;

// tr(lang)('English', '中文')
export const tr = (lang: Lang) => (en: string, zh: string) => (lang === 'en' ? en : zh);

// The default for a salesman's name, before he picks one himself
export const langForName = (name: string | null | undefined): Lang => (ENGLISH_NAMES.test(String(name || '')) ? 'en' : 'zh');

export async function langOfProfile(db: SupabaseClient, profileId: string | null | undefined): Promise<Lang> {
  if (!profileId) return 'zh';
  const { data: own } = await db.from('bot_langs').select('lang').eq('profile_id', profileId).maybeSingle();
  if (own?.lang === 'en' || own?.lang === 'zh') return own.lang;
  const { data: p } = await db.from('profiles').select('display_name').eq('id', profileId).maybeSingle();
  return langForName(p?.display_name);
}

export async function langOfTelegramUser(db: SupabaseClient, telegramUserId: number): Promise<Lang> {
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', telegramUserId).maybeSingle();
  return langOfProfile(db, link?.profile_id);
}

// Telegram's folded block: two lines show, a tap opens the rest
export const folded = (html: string) => (html.trim() ? `<blockquote expandable>${html.trim()}</blockquote>` : '');

// At most `max` lines, then "+N more"
export function topLines(lines: string[], max: number, lang: Lang) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), tr(lang)(`+${lines.length - max} more`, `还有 ${lines.length - max} 个`)];
}
