// The tool the model fills in, and a strict hand validator for its output.
//
// The browser sends each distinct plaque of the order once ({ id: 'P1', sheet, header, red, black }),
// the model returns `issues`, each naming its rule and the plaque ids it saw it on. An issue on a
// rule we don't know, or on a plaque id that wasn't sent, is dropped — never shown.

export interface Plaque {
  id: string;
  sheet: string;
  header: string;
  red: string;
  black: string[];
}

export interface Issue {
  rule: string;
  plaqueIds: string[];
  message: string;
  suggestion: string;
}

// docs/ai-review-rules.md — the half of Production's review that needs judgment
// J7 ("missing HARI") dropped 2026-11-05: a title may start with ANUGERAH, MAJLIS, HARI … (Sean)
export const RULES = ['C1', 'F2', 'J2', 'J3', 'J6', 'I5'] as const;

export const ISSUES_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      description: 'Only the problems you are confident about. Empty array if the order looks fine.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'plaqueIds', 'message', 'suggestion'],
        properties: {
          rule: { type: 'string', enum: [...RULES] },
          plaqueIds: { type: 'array', items: { type: 'string' }, description: 'the plaque ids it is on, copied exactly' },
          message: { type: 'string', description: 'one short plain-English sentence for the production worker' },
          suggestion: { type: 'string', description: 'the corrected text, or an empty string when there is nothing to type' },
        },
      },
    },
  },
} as const;

const isStr = (v: unknown): v is string => typeof v === 'string';
const MAX_ISSUES = 40;
const RULE_SET = new Set<string>(RULES);

export function validateIssues(raw: unknown, plaqueIds: Set<string>): { ok: true; issues: Issue[] } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.issues)) return { ok: false, error: 'issues must be an array' };
  if (r.issues.length > MAX_ISSUES) return { ok: false, error: 'too many issues' };
  const clean: Issue[] = [];
  for (const it of r.issues) {
    if (typeof it !== 'object' || it === null) continue;
    const o = it as Record<string, unknown>;
    if (!isStr(o.rule) || !RULE_SET.has(o.rule) || !isStr(o.message) || !Array.isArray(o.plaqueIds)) continue;
    const ids = o.plaqueIds.filter((id): id is string => isStr(id) && plaqueIds.has(id));
    if (ids.length === 0 || !o.message.trim()) continue;
    clean.push({
      rule: o.rule,
      plaqueIds: [...new Set(ids)],
      message: o.message.trim().slice(0, 240),
      suggestion: isStr(o.suggestion) ? o.suggestion.trim().slice(0, 200) : '',
    });
  }
  return { ok: true, issues: clean };
}
