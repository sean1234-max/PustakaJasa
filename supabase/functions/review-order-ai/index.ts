// AI half of Production's order review (Sean, 2026-11-02; docs/ai-review-rules.md) — called from
// the AI Review box while an order is in Reviewing Order. The Anthropic key stays a Supabase secret.
//
// Advisory only: it never changes an order. The browser wrapper (src/lib/reviewAiApi.js) turns every
// failure into "no AI result", so the rule-only checks still show when this is down.
//
// Mirrors check-engraving-text: re-verify the caller (Production / Admin only), per-user hourly rate
// limit + monthly cost cap + the site-wide AI budget, ONE model call (one retry on a malformed
// answer), record the run in ai_grammar_checks.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ISSUES_TOOL_SCHEMA, validateIssues, type Plaque } from './schema.ts';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryMessage } from './prompt.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!)['default'];
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];

const MODEL = Deno.env.get('REVIEW_MODEL') ?? 'claude-opus-5-5';
const EFFORT = (Deno.env.get('REVIEW_EFFORT') ?? 'high') as 'low' | 'medium' | 'high';
const MONTHLY_CAP_USD = Number(Deno.env.get('REVIEW_MONTHLY_CAP_USD') ?? '15');
const RATE_LIMIT_PER_HOUR = Number(Deno.env.get('REVIEW_RATE_LIMIT_PER_HOUR') ?? '60');
const PRICE_IN_PER_MTOK = Number(Deno.env.get('REVIEW_PRICE_IN_USD') ?? '4');
const PRICE_OUT_PER_MTOK = Number(Deno.env.get('REVIEW_PRICE_OUT_USD') ?? '20');
const DISABLED = Deno.env.get('REVIEW_AI_DISABLED') === '1';

const MAX_PLAQUES = 200;
const MAX_TOTAL_CHARS = 40000;
const MAX_LINE_CHARS = 300;
const ALLOWED_ROLES = ['production', 'admin'];

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const nothing = () => json({ issues: [], checked: false });

const costUsdCents = (inTok: number, outTok: number) =>
  ((inTok / 1_000_000) * PRICE_IN_PER_MTOK + (outTok / 1_000_000) * PRICE_OUT_PER_MTOK) * 100;

const line = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_LINE_CHARS) : '');
function readPlaques(raw: unknown): Plaque[] {
  if (!Array.isArray(raw)) return [];
  const plaques: Plaque[] = [];
  for (const p of raw.slice(0, MAX_PLAQUES)) {
    if (typeof p !== 'object' || p === null) continue;
    const o = p as Record<string, unknown>;
    const id = line(o.id);
    const black = Array.isArray(o.black) ? o.black.map(line).filter(Boolean).slice(0, 3) : [];
    const plaque = { id, sheet: line(o.sheet).slice(0, 80), header: line(o.header), red: line(o.red), black };
    if (id && (plaque.header || plaque.red || black.length)) plaques.push(plaque);
  }
  return plaques;
}

// Opus 5.5 takes no forced tool_choice: auto + strict + the prompt's "call submit_issues".
// Server-side fallback ("default") reruns a refused request on another model inside the same call.
async function callModel(messages: Anthropic.Beta.BetaMessageParam[]) {
  return anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    system: SYSTEM_PROMPT,
    tools: [{ name: 'submit_issues', description: 'Report the problems found on these plaques.', input_schema: ISSUES_TOOL_SCHEMA, strict: true }],
    tool_choice: { type: 'auto' },
    messages,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (DISABLED) return nothing();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);
  const callerClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(SUPABASE_URL, SECRET_KEY);

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return json({ error: 'Not authenticated.' }, 401);
  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) return json({ error: 'Not allowed.' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  const plaques = readPlaques(body.plaques);
  const totalChars = plaques.reduce((n, p) => n + p.header.length + p.red.length + p.black.join('').length, 0);
  if (plaques.length === 0 || totalChars > MAX_TOTAL_CHARS) return nothing();

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { count: recentCount } = await adminClient.from('ai_grammar_checks').select('id', { count: 'exact', head: true })
    .eq('created_by', user.id).gte('created_at', hourAgo);
  if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    await adminClient.from('ai_grammar_checks').insert({ created_by: user.id, status: 'rate_limited', lines_checked: plaques.length });
    return nothing();
  }
  const { data: monthRuns } = await adminClient.from('ai_grammar_checks').select('cost_usd_cents')
    .eq('created_by', user.id).gte('created_at', monthStart);
  const spentCents = (monthRuns ?? []).reduce((s, r) => s + (Number(r.cost_usd_cents) || 0), 0);
  const { data: budget, error: budgetError } = await adminClient.rpc('ai_budget_status');
  if (spentCents >= MONTHLY_CAP_USD * 100 || (!budgetError && Array.isArray(budget) && budget[0]?.blocked === true)) {
    await adminClient.from('ai_grammar_checks').insert({ created_by: user.id, status: 'cost_capped', lines_checked: plaques.length });
    return nothing();
  }

  const { data: run } = await adminClient.from('ai_grammar_checks')
    .insert({ created_by: user.id, status: 'processing', model: MODEL, lines_checked: plaques.length }).select('id').single();
  const finish = (fields: Record<string, unknown>) => (run?.id
    ? adminClient.from('ai_grammar_checks').update({ ...fields, completed_at: new Date().toISOString() }).eq('id', run.id)
    : Promise.resolve());

  const ids = new Set(plaques.map((p) => p.id));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildUserPrompt(plaques) }];
  let totalIn = 0;
  let totalOut = 0;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await callModel(messages);
      totalIn += res.usage.input_tokens;
      totalOut += res.usage.output_tokens;
      if (res.stop_reason === 'refusal') break;
      const toolUse = res.content.find((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === 'tool_use');
      const check = toolUse ? validateIssues(toolUse.input, ids) : { ok: false as const, error: 'submit_issues was not called' };
      if (check.ok) {
        await finish({
          status: 'succeeded', prompt_tokens: totalIn, completion_tokens: totalOut, cost_usd_cents: costUsdCents(totalIn, totalOut),
          issues_found: check.issues.length, raw_response: JSON.stringify(res).slice(0, 20000),
        });
        return json({ issues: check.issues, checked: true });
      }
      // the whole answer goes back (thinking blocks included), then what was wrong with it
      messages.push({ role: 'assistant', content: res.content });
      messages.push({
        role: 'user',
        content: toolUse
          ? [{ type: 'tool_result', tool_use_id: toolUse.id, content: buildRetryMessage(check.error), is_error: true }]
          : buildRetryMessage(check.error),
      });
    }
    await finish({ status: 'failed', prompt_tokens: totalIn, completion_tokens: totalOut, cost_usd_cents: costUsdCents(totalIn, totalOut), error: 'no valid answer' });
    return nothing();
  } catch (err) {
    console.error('review-order-ai failed:', err);
    await finish({ status: 'failed', prompt_tokens: totalIn, completion_tokens: totalOut, cost_usd_cents: costUsdCents(totalIn, totalOut), error: String(err).slice(0, 1000) });
    return nothing();
  }
});
