// A kertas kerja the rules couldn't read, so the AI read it (Sean, 2026-11-25 — step 0 of "fewer AI reads"):
// why, in ai_usage (feature read_form_rules_miss, cost 0, the reason in `error`), and the file itself, kept
// 60 days in the private rule-misses bucket (migration 0131), so the most common layouts can become rules
// (ruleRead.ts). Best effort: a failure here never stops the bot.

import { db } from './db.ts';
import { logUsage } from './usage.ts';

export const KEEP_DAYS = 60;
const BUCKET = 'rule-misses';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const todayMy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** where a missed file is kept: <Malaysian day>/<id>-<storage-safe name> */
export function missPath(day: string, id: string, fileName: string) {
  const safe = fileName.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]+/g, '').slice(-80) || 'file';
  return `${day}/${id}-${safe}`;
}

/** the day folders past KEEP_DAYS */
export const expiredDays = (folders: string[], today: string) =>
  folders.filter((f) => DAY_RE.test(f) && daysBetween(f, today) > KEEP_DAYS);

async function dropExpired(today: string) {
  const { data: folders } = await db.storage.from(BUCKET).list('', { limit: 1000 });
  for (const day of expiredDays((folders || []).map((f) => f.name), today)) {
    const { data: files } = await db.storage.from(BUCKET).list(day, { limit: 1000 });
    if (files?.length) await db.storage.from(BUCKET).remove(files.map((f) => `${day}/${f.name}`));
  }
}

export async function recordMiss(bytes: Uint8Array, fileName: string, why: string) {
  try {
    const today = todayMy();
    const path = missPath(today, crypto.randomUUID().slice(0, 8), fileName);
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/octet-stream', upsert: false });
    if (error) console.error('rule-misses upload failed:', error.message);
    await logUsage('read_form_rules_miss', 'rules', null, fileName, `${why} | ${error ? 'file not kept' : path}`);
    await dropExpired(today);
  } catch (err) {
    console.error('recording a rules miss failed:', err);
  }
}
