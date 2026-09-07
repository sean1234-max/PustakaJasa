// AI proofreading of engraving text — called when a teacher clicks Add to
// Cart. The ONLY place the Anthropic key is used for this feature; it stays
// a Supabase secret.
//
// Advisory only. Its result never changes an order and never blocks Add to
// Cart — the browser wrapper (src/lib/grammarCheckApi.js) swallows every
// error and returns `{ issues: [] }`, so if this function is down / slow /
// rate-limited / broken, the teacher just adds to cart as if the feature
// didn't exist.
//
// Mirrors extract-order-file: re-verify the caller, per-user hourly rate
// limit + monthly cost cap, ONE model call (one retry on a malformed
// response, then give up and return no issues), record the run.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ISSUES_TOOL_SCHEMA, validateIssues, type CheckLine } from './schema.ts';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryMessage } from './prompt.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const MODEL = Deno.env.get('GRAMMAR_MODEL') ?? 'claude-haiku-4-5-20251001';
const MONTHLY_CAP_USD = Number(Deno.env.get('GRAMMAR_MONTHLY_CAP_USD') ?? '3');
const RATE_LIMIT_PER_HOUR = Number(Deno.env.get('GRAMMAR_RATE_LIMIT_PER_HOUR') ?? '120');
const PRICE_IN_PER_MTOK = Number(Deno.env.get('GRAMMAR_PRICE_IN_USD') ?? '1');
const PRICE_OUT_PER_MTOK = Number(Deno.env.get('GRAMMAR_PRICE_OUT_USD') ?? '5');
const DISABLED = Deno.env.get('GRAMMAR_DISABLED') === '1';

const MAX_LINES = 40;
const MAX_TOTAL_CHARS = 8000;
const MAX_LINE_CHARS = 600;
const RETENTION_DAYS = 90;

const ALLOWED_ROLES = ['teacher', 'salesman', 'admin'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function costUsdCents(inTok: number, outTok: number): number {
  return ((inTok / 1_000_000) * PRICE_IN_PER_MTOK + (outTok / 1_000_000) * PRICE_OUT_PER_MTOK) * 100;
}

async function callModel(messages: unknown[]): Promise<{ input: unknown; inTok: number; outTok: number; raw: unknown }> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [{ name: 'submit_issues', description: 'Report the engraving-text issues you are confident about.', input_schema: ISSUES_TOOL_SCHEMA }],
      tool_choice: { type: 'tool', name: 'submit_issues' },
      messages,
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const toolUse = Array.isArray(data.content) ? data.content.find((c: Record<string, unknown>) => c.type === 'tool_use') : null;
  if (!toolUse) throw new Error('model did not call submit_issues');
  return { input: toolUse.input, inTok: data.usage?.input_tokens ?? 0, outTok: data.usage?.output_tokens ?? 0, raw: data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (DISABLED) return json({ issues: [], checked: false });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) return json({ error: 'Not allowed.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  // Normalise + bound the input. Anything malformed → treat as "nothing to
  // check" rather than erroring (the caller should never see a 4xx here).
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: CheckLine[] = [];
  for (const l of rawLines) {
    if (typeof l !== 'object' || l === null) continue;
    const o = l as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const label = typeof o.label === 'string' ? o.label.slice(0, 80) : '';
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, MAX_LINE_CHARS) : '';
    if (!id || !text) continue;
    lines.push({ id, label, text });
    if (lines.length >= MAX_LINES) break;
  }
  const totalChars = lines.reduce((n, l) => n + l.text.length, 0);
  if (lines.length === 0 || totalChars > MAX_TOTAL_CHARS) return json({ issues: [], checked: false });

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

  const { count: recentCount } = await adminClient
    .from('ai_grammar_checks').select('id', { count: 'exact', head: true })
    .eq('created_by', user.id).gte('created_at', hourAgo);
  if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    await adminClient.from('ai_grammar_checks').insert({ created_by: user.id, status: 'rate_limited', lines_checked: lines.length });
    return json({ issues: [], checked: false });
  }

  const { data: monthRuns } = await adminClient
    .from('ai_grammar_checks').select('cost_usd_cents')
    .eq('created_by', user.id).gte('created_at', monthStart);
  const spentCents = (monthRuns ?? []).reduce((s, r) => s + (Number(r.cost_usd_cents) || 0), 0);
  if (spentCents >= MONTHLY_CAP_USD * 100) {
    await adminClient.from('ai_grammar_checks').insert({ created_by: user.id, status: 'cost_capped', lines_checked: lines.length });
    return json({ issues: [], checked: false });
  }

  const { data: run } = await adminClient
    .from('ai_grammar_checks')
    .insert({ created_by: user.id, status: 'processing', model: MODEL, lines_checked: lines.length })
    .select('id').single();
  const runId = run?.id as string | undefined;
  const finish = (fields: Record<string, unknown>) =>
    runId ? adminClient.from('ai_grammar_checks').update({ ...fields, completed_at: new Date().toISOString() }).eq('id', runId) : Promise.resolve();

  // Fire-and-forget retention sweep — drop this user's own rows older than
  // the window so the table can't grow forever. Best-effort; a failure here
  // is swallowed and never affects the response.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const sweep = adminClient.from('ai_grammar_checks').delete().eq('created_by', user.id).lt('created_at', cutoff);
  // @ts-ignore EdgeRuntime is provided by the Supabase Edge runtime
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(Promise.resolve(sweep).catch(() => {}));

  const linesById = new Map(lines.map((l) => [l.id, l]));
  const messages: unknown[] = [{ role: 'user', content: buildUserPrompt(lines) }];
  let totalIn = 0;
  let totalOut = 0;

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await callModel(messages);
      totalIn += res.inTok;
      totalOut += res.outTok;
      const check = validateIssues(res.input, linesById);

      if (check.ok) {
        await finish({
          status: 'succeeded', prompt_tokens: totalIn, completion_tokens: totalOut,
          cost_usd_cents: costUsdCents(totalIn, totalOut),
          issues_found: check.issues.length,
          raw_response: JSON.stringify(res.raw).slice(0, 20000),
        });
        return json({ issues: check.issues, checked: true });
      }

      if (attempt === 1) {
        messages.push(
          { role: 'assistant', content: [{ type: 'tool_use', id: 'retry', name: 'submit_issues', input: res.input }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'retry', content: buildRetryMessage(check.error) }] },
        );
      } else {
        // Gave up. Fail SAFE — return no issues, never a malformed one.
        await finish({
          status: 'failed', prompt_tokens: totalIn, completion_tokens: totalOut,
          cost_usd_cents: costUsdCents(totalIn, totalOut),
          error: `validation failed twice: ${check.error}`,
        });
        return json({ issues: [], checked: false });
      }
    }
    return json({ issues: [], checked: false });
  } catch (err) {
    await finish({
      status: 'failed', prompt_tokens: totalIn, completion_tokens: totalOut,
      cost_usd_cents: costUsdCents(totalIn, totalOut),
      error: String(err).slice(0, 1000),
    });
    return json({ issues: [], checked: false });
  }
});
