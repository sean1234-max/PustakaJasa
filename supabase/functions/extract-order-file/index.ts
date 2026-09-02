// AI order-file extraction (Phase 4, Batch D). The ONLY place the Anthropic
// API key is used — it stays a Supabase secret, never reaches the browser.
//
// Flow: the browser uploads the raw file to the private `order-imports`
// bucket (0046) and renders the sheets to plain text with its own SheetJS,
// then calls this function with { storagePath, fileName, sheetsText }. This
// function re-verifies the caller server-side, enforces a per-user rate
// limit and monthly cost cap, makes ONE model call (one automatic retry on
// a malformed response, then give up), records the run in ai_extraction_runs
// (0045), and returns the validated semantic result. It does NOT touch the
// order — the browser maps the result to a draft the teacher reviews.
//
// Deliberately synchronous: a single call is ~10-40s, within the Edge
// Function limit, and the browser just shows "reading…". No queue, no
// Realtime.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { EXTRACTION_INPUT_SCHEMA, validateExtraction } from './schema.ts';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryMessage } from './prompt.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

// Overridable without a code change — set as secrets if the defaults drift.
const MODEL = Deno.env.get('EXTRACT_MODEL') ?? 'claude-sonnet-5';
const MONTHLY_CAP_USD = Number(Deno.env.get('EXTRACT_MONTHLY_CAP_USD') ?? '6');      // ~RM30
const RATE_LIMIT_PER_HOUR = Number(Deno.env.get('EXTRACT_RATE_LIMIT_PER_HOUR') ?? '20');
const PRICE_IN_PER_MTOK = Number(Deno.env.get('EXTRACT_PRICE_IN_USD') ?? '3');
const PRICE_OUT_PER_MTOK = Number(Deno.env.get('EXTRACT_PRICE_OUT_USD') ?? '15');

const MAX_SHEETS_TEXT_CHARS = 200_000;   // ~50k tokens of input — a real order file is far smaller
const RAW_RESPONSE_CAP = 200_000;        // chars kept in ai_extraction_runs.raw_response
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

interface AnthropicResult {
  input: unknown;
  inTok: number;
  outTok: number;
  raw: unknown;
}

async function callModel(messages: unknown[]): Promise<AnthropicResult> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [{
        name: 'submit_extraction',
        description: 'Submit the structured extraction of the order file.',
        input_schema: EXTRACTION_INPUT_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'submit_extraction' },
      messages,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = await resp.json();
  const toolUse = Array.isArray(data.content)
    ? data.content.find((c: Record<string, unknown>) => c.type === 'tool_use')
    : null;
  if (!toolUse) throw new Error('model did not call submit_extraction');
  return {
    input: toolUse.input,
    inTok: data.usage?.input_tokens ?? 0,
    outTok: data.usage?.output_tokens ?? 0,
    raw: data,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    return json({ error: 'Not allowed to import order files.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : null;
  const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 300) : '';
  const sheetsText = typeof body.sheetsText === 'string' ? body.sheetsText : '';
  if (!fileName || !sheetsText) return json({ error: 'fileName and sheetsText are required.' }, 400);
  if (sheetsText.length > MAX_SHEETS_TEXT_CHARS) {
    return json({ error: 'This file is too large to read automatically.' }, 413);
  }
  // The path, when given, must be inside this user's own folder — the same
  // scoping the storage RLS enforces, re-checked here so a run row can't be
  // attributed to a file another user owns.
  if (storagePath && !storagePath.startsWith(`${user.id}/`)) {
    return json({ error: 'storagePath is outside your folder.' }, 400);
  }

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  // Rate limit — count this user's runs in the last hour.
  const { count: recentCount } = await adminClient
    .from('ai_extraction_runs')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .gte('created_at', hourAgo);
  if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return json({ error: 'Too many imports in the last hour. Please try again later.' }, 429);
  }

  // Cost cap — sum this user's spend so far this calendar month (UTC).
  const { data: monthRuns } = await adminClient
    .from('ai_extraction_runs')
    .select('cost_usd_cents')
    .eq('created_by', user.id)
    .gte('created_at', monthStart);
  const spentCents = (monthRuns ?? []).reduce((s, r) => s + (Number(r.cost_usd_cents) || 0), 0);
  if (spentCents >= MONTHLY_CAP_USD * 100) {
    return json({ error: 'Monthly AI reading limit reached for your account. Ask an admin to raise it.' }, 402);
  }

  // Open the run row.
  const { data: run, error: runError } = await adminClient
    .from('ai_extraction_runs')
    .insert({
      created_by: user.id,
      file_name: fileName,
      storage_path: storagePath,
      status: 'processing',
      model: MODEL,
    })
    .select('id')
    .single();
  if (runError || !run) return json({ error: 'Could not start the import.' }, 500);
  const runId = run.id as string;

  const finish = (fields: Record<string, unknown>) =>
    adminClient.from('ai_extraction_runs').update({ ...fields, completed_at: new Date().toISOString() }).eq('id', runId);

  const messages: unknown[] = [{ role: 'user', content: buildUserPrompt(fileName, sheetsText) }];
  let totalIn = 0;
  let totalOut = 0;

  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await callModel(messages);
      totalIn += res.inTok;
      totalOut += res.outTok;
      const check = validateExtraction(res.input);

      if (check.ok) {
        const cost = costUsdCents(totalIn, totalOut);
        await finish({
          status: 'succeeded',
          attempt,
          prompt_tokens: totalIn,
          completion_tokens: totalOut,
          cost_usd_cents: cost,
          raw_response: JSON.stringify(res.raw).slice(0, RAW_RESPONSE_CAP),
          parsed_result: check.value,
        });
        scheduleCleanup(adminClient, user.id);
        return json({ runId, status: 'succeeded', result: check.value });
      }

      if (attempt === 1) {
        // Feed the tool result back and let the model correct itself once.
        messages.push(
          { role: 'assistant', content: [{ type: 'tool_use', id: 'retry', name: 'submit_extraction', input: res.input }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'retry', content: buildRetryMessage(check.error) }] },
        );
      } else {
        await finish({
          status: 'needs_human',
          attempt,
          prompt_tokens: totalIn,
          completion_tokens: totalOut,
          cost_usd_cents: costUsdCents(totalIn, totalOut),
          raw_response: JSON.stringify(res.raw).slice(0, RAW_RESPONSE_CAP),
          error: `validation failed twice: ${check.error}`,
        });
        return json({ runId, status: 'needs_human', error: 'The AI could not read this file cleanly. Please use the built-in reader or enter it by hand.' });
      }
    }
    // unreachable
    return json({ runId, status: 'needs_human' });
  } catch (err) {
    await finish({
      status: 'failed',
      prompt_tokens: totalIn,
      completion_tokens: totalOut,
      cost_usd_cents: costUsdCents(totalIn, totalOut),
      error: String(err).slice(0, 2000),
    });
    return json({ runId, status: 'failed', error: 'The AI reader hit an error. Please try again or use the built-in reader.' }, 502);
  }
});

// Fire-and-forget: after a successful run, delete this user's own uploads
// older than the retention window. Runs on the response's own lifetime via
// EdgeRuntime.waitUntil so it never delays the reply. Best-effort — a failure
// here is logged, not surfaced.
function scheduleCleanup(admin: ReturnType<typeof createClient>, userId: string) {
  const task = (async () => {
    try {
      const { data: files } = await admin.storage.from('order-imports').list(userId, { limit: 1000 });
      if (!files?.length) return;
      const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
      const stale = files
        .filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff)
        .map((f) => `${userId}/${f.name}`);
      if (stale.length) await admin.storage.from('order-imports').remove(stale);
    } catch (err) {
      console.error('order-imports cleanup failed:', err);
    }
  })();
  // @ts-ignore EdgeRuntime is provided by the Supabase Edge runtime
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task);
}
