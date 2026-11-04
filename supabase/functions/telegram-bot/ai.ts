// The two things the bot asks the model: read a salesman's message into changes, and compare a file
// with an order. Claude Opus 5.5 (no forced tool_choice: auto + strict + "call the tool" in the
// prompt), server-side fallback on a refusal. Each returns null when there's no usable answer.

import Anthropic from 'npm:@anthropic-ai/sdk';
import type { FileContent } from './files.ts';

const MODEL = Deno.env.get('BOT_MODEL') ?? 'claude-opus-5-5';
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

async function callTool(system: string, content: Anthropic.Beta.BetaContentBlockParam[], tool: { name: string; description: string; schema: Record<string, unknown> }, effort: 'low' | 'medium' | 'high') {
  const res = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort },
    system,
    tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema, strict: true }],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') return null;
  const use = res.content.find((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === 'tool_use');
  return use ? { input: use.input as Record<string, unknown>, usage: res.usage } : null;
}

// ------------------------------------------------------------------ change requests
const CHANGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['requests', 'notHandled'],
  properties: {
    requests: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['orderId', 'shipmentDate', 'functionDate', 'remarkAdd'],
        properties: {
          orderId: { type: 'string', description: 'e.g. ORD-0233, exactly as written' },
          shipmentDate: { type: ['string', 'null'], description: 'new Shipment Date as YYYY-MM-DD, or null' },
          functionDate: { type: ['string', 'null'], description: 'new Function Date as YYYY-MM-DD, or null' },
          remarkAdd: { type: ['string', 'null'], description: 'text to add to the order Remark, or null' },
        },
      },
    },
    notHandled: { type: 'array', items: { type: 'string' }, description: 'each other change asked for (quantities, wording, Jenis Plak …), one short line each, with its order id' },
  },
} as const;

export function readChanges(message: string, todayMy: string) {
  const system = `You read messages from salesmen of a Malaysian school-award plaque company asking Production to change orders. Today is ${todayMy} (Malaysia).
Pull out, per order id (ORD-xxxx): a new Shipment Date, a new Function Date, and text to add to the order Remark. Dates become YYYY-MM-DD; "19/11" is day/month — use the next such date from today.
Anything else asked (quantities, wording, Jenis Plak, prices …) goes in notHandled, one line each with its order id. Never guess an order id. Call read_changes exactly once.`;
  return callTool(system, [{ type: 'text', text: message }], { name: 'read_changes', description: 'Report the changes asked for in the message.', schema: CHANGE_SCHEMA }, 'low');
}

// ------------------------------------------------------------------ file compare
const COMPARE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'differences'],
  properties: {
    summary: { type: 'string', description: 'one short sentence: how well the file and the order match' },
    differences: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'where', 'inFile', 'inOrder'],
        properties: {
          kind: { type: 'string', enum: ['missing_in_order', 'extra_in_order', 'wording', 'quantity', 'other'] },
          where: { type: 'string', description: 'the sheet / award / Jenis Plak it is about' },
          inFile: { type: 'string', description: 'what the file says ("" if nothing)' },
          inOrder: { type: 'string', description: 'what the order says ("" if nothing)' },
        },
      },
    },
  },
} as const;

export function compareFile(file: FileContent, fileName: string, orderId: string, orderText: string) {
  const system = `You compare a school's award-plaque order file with the order as it is in the website, for a Malaysian plaque company's Production team. Text is Malay, usually ALL CAPS.
The order lists every plaque (sheet | Jenis Plak | engraved lines × how many) and the totals per Jenis Plak; "[red]" marks the red line.
Report every real difference: an award or plaque in the file that the order doesn't have (missing_in_order), one in the order the file doesn't have (extra_in_order), different words (wording — misspellings too), different quantities (quantity). Ignore layout, line breaks, letter case, the order's own codes and things the file simply doesn't state. Be precise; an empty list is fine when they match. Call compare_result exactly once.`;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    file.type === 'text' ? { type: 'text', text: `FILE "${fileName}":\n${file.text}` } : file,
    { type: 'text', text: `ORDER ${orderId}:\n${orderText}` },
  ];
  return callTool(system, content, { name: 'compare_result', description: 'Report how the file and the order differ.', schema: COMPARE_SCHEMA }, 'high');
}
