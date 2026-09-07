// The tool the model fills in, and a strict hand validator for its output.
//
// The request sends a flat list of engraving lines, each with a stable `id`
// (the browser's own lineValues key) and its `text`. The model returns
// `issues`, each pointing back at one line's `id` and giving the exact
// substring that's wrong plus the fix. The browser applies a fix as a plain
// substring replace on that one line — so `original` MUST be an exact
// substring of the line's text, or the issue is dropped here (never shown).

export interface CheckLine {
  id: string;
  label: string;
  text: string;
}

export interface Issue {
  lineId: string;
  original: string;     // exact substring of that line's text
  suggestion: string;   // what to replace it with
  kind: string;         // 'spelling' | 'capitalization' | 'grammar' | 'suspicious'
  note: string;         // one short sentence, plain language
}

export const ISSUES_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      description: 'Only the errors you are confident about. Empty array if the text looks fine.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['lineId', 'original', 'suggestion', 'kind', 'note'],
        properties: {
          lineId: { type: 'string', description: 'the id of the line this issue is in, copied exactly from the input' },
          original: { type: 'string', description: 'the exact wrong substring, copied verbatim from the line' },
          suggestion: { type: 'string', description: 'the corrected substring' },
          kind: { type: 'string', enum: ['spelling', 'capitalization', 'grammar', 'suspicious'] },
          note: { type: 'string', description: 'one short plain-language sentence' },
        },
      },
    },
  },
} as const;

const isStr = (v: unknown): v is string => typeof v === 'string';
const KINDS = new Set(['spelling', 'capitalization', 'grammar', 'suspicious']);
const MAX_ISSUES = 40;

// Returns only the issues that are well-formed AND that actually point at a
// real substring of a real input line. Anything else is silently dropped —
// a malformed or hallucinated issue must never reach the teacher.
export function validateIssues(
  raw: unknown,
  linesById: Map<string, CheckLine>,
): { ok: true; issues: Issue[] } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.issues)) return { ok: false, error: 'issues must be an array' };
  if (r.issues.length > MAX_ISSUES) return { ok: false, error: 'too many issues' };

  const clean: Issue[] = [];
  for (const it of r.issues) {
    if (typeof it !== 'object' || it === null) continue;
    const o = it as Record<string, unknown>;
    if (!isStr(o.lineId) || !isStr(o.original) || !isStr(o.suggestion) || !isStr(o.kind) || !isStr(o.note)) continue;
    if (!KINDS.has(o.kind)) continue;
    const line = linesById.get(o.lineId);
    if (!line) continue;
    const original = o.original.trim();
    const suggestion = o.suggestion.trim();
    if (!original || !suggestion || original === suggestion) continue;
    if (!line.text.includes(original)) continue;          // must be a real substring
    if (suggestion.length > line.text.length + 60) continue; // runaway rewrite guard
    clean.push({
      lineId: o.lineId,
      original,
      suggestion,
      kind: o.kind,
      note: o.note.trim().slice(0, 200),
    });
  }
  return { ok: true, issues: clean };
}
