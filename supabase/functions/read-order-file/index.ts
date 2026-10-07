// AI sheet reader (universal file-reader plan, phase 1). Called by the
// browser for the sheets the rule-based reader (src/utils/excelImport.js)
// skipped. Input is the sheets' structure-map text (src/utils/fileIr.js);
// output is a MAPPING of where things are (schema.ts) — never values. The
// browser reads every value back from the file itself (aiMapping.js).
//
// Stability first (owner, 2026-10-07):
//   - same structure-map text + same pipeline version -> the stored answer
//     is returned again, no model call (file_read_runs cache);
//   - the model only points at cells, so it cannot mistype names or counts;
//   - one site-wide monthly cap for every AI feature (ai_budget_status,
//     migration 0085). At the cap this returns `blocked` and the teacher
//     types the sheets by hand.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { MAPPING_SCHEMA, MAPPING_VERSION, validateMapping, type Mapping } from './schema.ts';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompt.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MODEL = Deno.env.get('READER_MODEL') ?? 'claude-sonnet-5-5';
const ESCALATE_MODEL = Deno.env.get('READER_ESCALATE_MODEL') ?? 'claude-opus-5-5';
const ALLOWED_ROLES = (Deno.env.get('READER_ROLES') ?? 'salesman').split(',').map((s) => s.trim());
const RATE_LIMIT_PER_HOUR = Number(Deno.env.get('READER_RATE_LIMIT_PER_HOUR') ?? '30');
const ALLOWED_ORIGINS = (Deno.env.get('READER_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_IR_CHARS = 120_000;
const MAX_SHEETS = 30;
const PIPELINE_VERSION = `m${MAPPING_VERSION}-p${PROMPT_VERSION}`;

// US$ per million tokens: [input, output]. Cache writes bill 1.25x input,
// cache reads 0.1x input.
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? (origin || '*') : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

function costUsdCents(model: string, u: Usage): number {
  const [pin, pout] = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const cr = u.cache_read_input_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const usd = (u.input_tokens * pin + cw * pin * 1.25 + cr * pin * 0.1 + u.output_tokens * pout) / 1_000_000;
  return usd * 100;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const anthropic = new Anthropic();

async function callModel(model: string, effort: 'medium' | 'high', irText: string) {
  const response = await anthropic.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema: MAPPING_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserPrompt(irText) }],
  }) as unknown as {
    model: string; stop_reason: string; usage: Usage;
    content: { type: string; text?: string }[];
  };
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  let parsed: unknown = null;
  if (response.stop_reason === 'end_turn') {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  return { parsed, stopReason: response.stop_reason, usage: response.usage, servedBy: response.model };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return json({ error: 'Not authenticated.' }, 401);
  const { data: profile } = await admin.from('profiles').select('role, status').eq('id', user.id).single();
  if (!profile || profile.status !== 'active' || !ALLOWED_ROLES.includes(profile.role)) return json({ error: 'Not allowed.' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : 'file';
  const irText = typeof body.irText === 'string' ? body.irText : '';
  const sheetNames = Array.isArray(body.sheetNames) ? body.sheetNames.filter((s): s is string => typeof s === 'string').slice(0, MAX_SHEETS) : [];
  if (!irText || sheetNames.length === 0) return json({ error: 'Nothing to read.' }, 400);
  if (irText.length > MAX_IR_CHARS) return json({ status: 'too-large', message: 'These sheets are too large for the AI reader — please add them by hand.' });

  const inputSha = await sha256Hex(irText);

  // Same input, same pipeline -> same answer, no model call.
  const { data: cached } = await admin.from('file_read_runs')
    .select('id, mapping').eq('created_by', user.id).eq('input_sha256', inputSha).eq('pipeline_version', PIPELINE_VERSION)
    .eq('status', 'succeeded').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (cached?.mapping) return json({ status: 'succeeded', runId: cached.id, mapping: cached.mapping, cached: true });

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recent } = await admin.from('file_read_runs').select('id', { count: 'exact', head: true })
    .eq('created_by', user.id).gte('created_at', hourAgo);
  if ((recent ?? 0) >= RATE_LIMIT_PER_HOUR) return json({ status: 'rate-limited', message: 'Too many AI readings this hour — please try again later.' });

  const budgetBlocked = async () => {
    const { data, error } = await admin.rpc('ai_budget_status');
    return !error && Array.isArray(data) && data[0]?.blocked === true;
  };
  if (await budgetBlocked()) {
    await admin.from('file_read_runs').insert({ created_by: user.id, file_name: fileName, input_sha256: inputSha, pipeline_version: PIPELINE_VERSION, status: 'blocked' });
    return json({ status: 'blocked', message: "This month's AI budget is used up — please add these sheets by hand. It resets on the 1st." });
  }

  const started = Date.now();
  const { data: run } = await admin.from('file_read_runs')
    .insert({ created_by: user.id, file_name: fileName, input_sha256: inputSha, pipeline_version: PIPELINE_VERSION, model: MODEL })
    .select('id').single();
  const runId = run?.id as string | undefined;
  let costCents = 0;
  const tokens = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  const add = (model: string, u: Usage) => {
    costCents += costUsdCents(model, u);
    tokens.input_tokens += u.input_tokens;
    tokens.output_tokens += u.output_tokens;
    tokens.cache_read_tokens += u.cache_read_input_tokens ?? 0;
    tokens.cache_write_tokens += u.cache_creation_input_tokens ?? 0;
  };
  const finish = (fields: Record<string, unknown>) => runId
    ? admin.from('file_read_runs').update({
      ...fields, ...tokens, cost_usd_cents: costCents, duration_ms: Date.now() - started, completed_at: new Date().toISOString(),
    }).eq('id', runId)
    : Promise.resolve();

  try {
    let modelUsed = MODEL;
    let res = await callModel(MODEL, 'medium', irText);
    add(res.servedBy, res.usage);
    let check = validateMapping(res.parsed, sheetNames);
    // Escalate once to the stronger model when the first answer is unusable
    // or the model itself was unsure about a sheet.
    const unsure = check.ok && check.value.blocks.some((b) => b.confidence === 'low');
    if ((!check.ok || unsure) && !(await budgetBlocked())) {
      modelUsed = ESCALATE_MODEL;
      const res2 = await callModel(ESCALATE_MODEL, 'high', irText);
      add(res2.servedBy, res2.usage);
      const check2 = validateMapping(res2.parsed, sheetNames);
      if (check2.ok) { res = res2; check = check2; }
    }
    if (!check.ok) {
      await finish({ status: 'failed', model: modelUsed, error: `${res.stopReason}: ${check.error}`.slice(0, 500) });
      return json({ status: 'failed', runId, message: 'The AI could not read these sheets — please add them by hand.' });
    }
    const mapping: Mapping = check.value;
    await finish({ status: 'succeeded', model: modelUsed, mapping });
    return json({ status: 'succeeded', runId, mapping, cached: false });
  } catch (err) {
    console.error('read-order-file failed', runId, err instanceof Error ? err.name : 'error');
    await finish({ status: 'failed', error: String(err).slice(0, 500) });
    return json({ status: 'failed', runId, message: 'The AI reader hit an error — please try again or add these sheets by hand.' });
  }
});
