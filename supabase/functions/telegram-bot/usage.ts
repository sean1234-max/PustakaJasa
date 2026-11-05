// What each bot AI call cost, kept in ai_usage (migration 0113) so the monthly cap, the spend figures
// and the assistant's credit warning see the bots too. Prices as read-order-file's (US$ per million
// tokens, [input, output]; cache writes 1.25x input, cache reads 0.1x input).

import { db } from './db.ts';

const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

export function costUsdCents(model: string, u: Usage) {
  const [pin, pout] = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return ((u.input_tokens * pin + write * pin * 1.25 + read * pin * 0.1 + u.output_tokens * pout) / 1_000_000) * 100;
}

// Best effort: a failed log never stops the bot
export async function logUsage(feature: string, model: string, usage: Usage | null, fileName: string | null = null, error: string | null = null) {
  const { error: insertError } = await db.from('ai_usage').insert({
    feature, model, file_name: fileName, error: error?.slice(0, 500) ?? null,
    input_tokens: (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
    output_tokens: usage?.output_tokens ?? 0,
    cost_usd_cents: usage ? costUsdCents(model, usage) : 0,
  });
  if (insertError) console.error('ai_usage insert failed:', insertError.message);
}
