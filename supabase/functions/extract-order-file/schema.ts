// The JSON shape the model must return, and a hand validator for it.
//
// Kept SEMANTIC — close to how a person would describe the order — rather
// than the app's internal KLAS_MATRIX section shape. The browser (Batch E)
// maps this to sections with a deterministic, unit-tested transform, so the
// model never has to know about row/column ids or line slots. Every field
// is validated before it is trusted; a response that doesn't fit is retried
// once, then the run is marked 'needs_human'.

export interface Plaque {
  // The qualifier that varies plaque-to-plaque within one award:
  // "TAHUN 4", "1 AMANAH", "PERTAMA", "PRASEKOLAH", or "" when the award
  // has no sub-division.
  line1: string;
  // A second varying line, when the award has two axes (e.g. subject +
  // year): "BAHASA MELAYU", or "".
  line2: string;
  // How many identical copies of this exact plaque.
  count: number;
}

export interface Award {
  eventHeader: string;   // top line(s) of the plaque — the majlis title (may itself be 2 lines joined with \n)
  year: string;          // a session line printed on the plaque ("SESI 2024/2025", "2025/2026"); "" if none
  awardName: string;     // the award-name line, e.g. "ANUGERAH CEMERLANG MATA PELAJARAN"
  jenisPlak: string;     // the plaque code, verbatim as written in the file
  // "matrix"  — the default. line1 = year/class qualifier, line2 = subject/rank.
  // "prebuilt" — a finished list / named-recipient roster where the teacher
  //   already wrote every plaque: line1 = the recipient name (or the whole
  //   pre-written detail line), line2 = the second engraved line below it
  //   (jawatan + unit, class + year, ...).
  layout: 'matrix' | 'prebuilt';
  plaques: Plaque[];
  statedTotal: number | null;  // the award's own written TOTAL, if any
  note: string;          // anything the office should see (PPKI wording change, KIV note, ...)
}

export interface ExtractionQuestion {
  // 'year-inconsistency' | 'count-mismatch' | 'plak-not-in-catalog'
  //   | 'missing-school-name' | 'extra-column-not-in-sample' | 'other'
  kind: string;
  text: string;          // phrased as a question, never an assertion of error
  options: string[];     // 0-4 concrete choices; [] = acknowledge only
  awardIndex: number | null;
  // When ONE of the answers implies a concrete, mechanical edit to the
  // draft, describe it so a single click applies it. null = ask only.
  //   "prepend-header"     — add `text` (+ newline) above each award's header
  //   "strip-detail-line"  — drop the last line of every plaque's line2
  // `whenOption` is the index into `options` that triggers the edit; the
  // other options just acknowledge.
  apply: { action: 'prepend-header' | 'strip-detail-line'; awardIndexes: number[]; text: string; whenOption: number } | null;
}

export interface ExtractionResult {
  isOrderFile: boolean;
  awards: Award[];
  nonPlaqueItems: { desc: string; qty: number }[];   // HAMPER, SELEMPANG, ... — remark only
  frontPgTotals: { jenisPlak: string; qty: number }[];
  questions: ExtractionQuestion[];
}

// JSON Schema handed to the model as the `submit_extraction` tool's
// input_schema — the model fills this in instead of free-typing JSON.
export const EXTRACTION_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isOrderFile', 'awards', 'nonPlaqueItems', 'frontPgTotals', 'questions'],
  properties: {
    isOrderFile: { type: 'boolean', description: 'false if this file is not a plaque/award order at all' },
    awards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['eventHeader', 'year', 'awardName', 'jenisPlak', 'layout', 'plaques', 'statedTotal', 'note'],
        properties: {
          eventHeader: { type: 'string' },
          year: { type: 'string' },
          awardName: { type: 'string' },
          jenisPlak: { type: 'string' },
          layout: { type: 'string', enum: ['matrix', 'prebuilt'] },
          plaques: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['line1', 'line2', 'count'],
              properties: {
                line1: { type: 'string' },
                line2: { type: 'string' },
                count: { type: 'integer', minimum: 1 },
              },
            },
          },
          statedTotal: { type: ['integer', 'null'], minimum: 0 },
          note: { type: 'string' },
        },
      },
    },
    nonPlaqueItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['desc', 'qty'],
        properties: { desc: { type: 'string' }, qty: { type: 'integer', minimum: 1 } },
      },
    },
    frontPgTotals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['jenisPlak', 'qty'],
        properties: { jenisPlak: { type: 'string' }, qty: { type: 'integer', minimum: 1 } },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text', 'options', 'awardIndex', 'apply'],
        properties: {
          kind: { type: 'string' },
          text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          awardIndex: { type: ['integer', 'null'], minimum: 0 },
          apply: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['action', 'awardIndexes', 'text', 'whenOption'],
            properties: {
              action: { type: 'string', enum: ['prepend-header', 'strip-detail-line'] },
              awardIndexes: { type: 'array', items: { type: 'integer', minimum: 0 } },
              text: { type: 'string' },
              whenOption: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  },
} as const;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

// Bounds — a well-formed order file never exceeds these; anything past them
// is a runaway response, not real data.
const MAX_AWARDS = 200;
const MAX_PLAQUES_PER_AWARD = 2000;
const MAX_QUESTIONS = 40;

export function validateExtraction(
  raw: unknown,
): { ok: true; value: ExtractionResult } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'result is not an object' };
  const r = raw as Record<string, unknown>;

  if (typeof r.isOrderFile !== 'boolean') return { ok: false, error: 'isOrderFile must be a boolean' };

  if (!Array.isArray(r.awards)) return { ok: false, error: 'awards must be an array' };
  if (r.awards.length > MAX_AWARDS) return { ok: false, error: `too many awards (>${MAX_AWARDS})` };
  for (let i = 0; i < r.awards.length; i++) {
    const a = r.awards[i] as Record<string, unknown>;
    if (typeof a !== 'object' || a === null) return { ok: false, error: `award ${i} is not an object` };
    if (!isStr(a.eventHeader) || !isStr(a.year) || !isStr(a.awardName) || !isStr(a.jenisPlak) || !isStr(a.note)) {
      return { ok: false, error: `award ${i}: eventHeader/year/awardName/jenisPlak/note must be strings` };
    }
    if (a.layout !== 'matrix' && a.layout !== 'prebuilt') {
      return { ok: false, error: `award ${i}: layout must be "matrix" or "prebuilt"` };
    }
    if (a.statedTotal !== null && !(isInt(a.statedTotal) && (a.statedTotal as number) >= 0)) {
      return { ok: false, error: `award ${i}: statedTotal must be a non-negative integer or null` };
    }
    if (!Array.isArray(a.plaques)) return { ok: false, error: `award ${i}: plaques must be an array` };
    if (a.plaques.length > MAX_PLAQUES_PER_AWARD) return { ok: false, error: `award ${i}: too many plaques` };
    for (let j = 0; j < a.plaques.length; j++) {
      const p = a.plaques[j] as Record<string, unknown>;
      if (typeof p !== 'object' || p === null) return { ok: false, error: `award ${i} plaque ${j} is not an object` };
      if (!isStr(p.line1) || !isStr(p.line2)) return { ok: false, error: `award ${i} plaque ${j}: line1/line2 must be strings` };
      if (!isInt(p.count) || (p.count as number) < 1) return { ok: false, error: `award ${i} plaque ${j}: count must be a positive integer` };
    }
  }

  if (!Array.isArray(r.nonPlaqueItems)) return { ok: false, error: 'nonPlaqueItems must be an array' };
  for (let i = 0; i < r.nonPlaqueItems.length; i++) {
    const n = r.nonPlaqueItems[i] as Record<string, unknown>;
    if (typeof n !== 'object' || n === null || !isStr(n.desc) || !isInt(n.qty) || (n.qty as number) < 1) {
      return { ok: false, error: `nonPlaqueItems[${i}]: need { desc: string, qty: positive integer }` };
    }
  }

  if (!Array.isArray(r.frontPgTotals)) return { ok: false, error: 'frontPgTotals must be an array' };
  for (let i = 0; i < r.frontPgTotals.length; i++) {
    const f = r.frontPgTotals[i] as Record<string, unknown>;
    if (typeof f !== 'object' || f === null || !isStr(f.jenisPlak) || !isInt(f.qty) || (f.qty as number) < 1) {
      return { ok: false, error: `frontPgTotals[${i}]: need { jenisPlak: string, qty: positive integer }` };
    }
  }

  if (!Array.isArray(r.questions)) return { ok: false, error: 'questions must be an array' };
  if (r.questions.length > MAX_QUESTIONS) return { ok: false, error: 'too many questions' };
  for (let i = 0; i < r.questions.length; i++) {
    const q = r.questions[i] as Record<string, unknown>;
    if (typeof q !== 'object' || q === null || !isStr(q.kind) || !isStr(q.text)) {
      return { ok: false, error: `questions[${i}]: kind and text must be strings` };
    }
    if (!Array.isArray(q.options) || q.options.some((o) => !isStr(o))) {
      return { ok: false, error: `questions[${i}]: options must be an array of strings` };
    }
    if (q.awardIndex !== null && !(isInt(q.awardIndex) && (q.awardIndex as number) >= 0)) {
      return { ok: false, error: `questions[${i}]: awardIndex must be a non-negative integer or null` };
    }
    if (q.apply !== null && q.apply !== undefined) {
      const ap = q.apply as Record<string, unknown>;
      if (typeof ap !== 'object'
        || (ap.action !== 'prepend-header' && ap.action !== 'strip-detail-line')
        || !Array.isArray(ap.awardIndexes) || !ap.awardIndexes.every((x) => isInt(x) && (x as number) >= 0)
        || !isStr(ap.text) || !isInt(ap.whenOption)) {
        return { ok: false, error: `questions[${i}].apply: bad shape` };
      }
    }
  }

  return { ok: true, value: raw as ExtractionResult };
}
