// kind "pdf": what the model returns for a text PDF (phase 2). Like the
// sheet mapping, it is references, not values: every engraved line is a
// segment id from the PDF's structure map (src/utils/pdfIr.js). Where only
// part of a segment is meant ("1 HASANAH" out of "1 HASANAH – 5") the
// model also gives that part as text, and the browser
// (src/utils/pdfMapping.js) checks it really is inside the segment before
// using it. Bump PDF_SCHEMA_VERSION whenever this shape changes (it is part
// of the cache key).

export const PDF_SCHEMA_VERSION = '2';

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const REF_DESC = 'A segment id like "p1s12", or a run of segments on the same printed line like "p2s10-p2s11".';
const REF_VALUE = (desc: string) => ({
  anyOf: [{ type: 'null' }, {
    type: 'object', additionalProperties: false, required: ['ref', 'value'],
    properties: { ref: { type: 'string', description: REF_DESC }, value: { type: 'integer', description: desc } },
  }],
});

// Labels are kept terse (a long grid of finished labels is hundreds of
// lines, and output length is what makes a reading slow and costly): a
// label is a list of lines, a line a list of options, an option one string
// "REF" (the whole segment) or "REF|TEXT" (only TEXT, a part of it) or
// "REF|TEXT|QTY|QTYREF" (TEXT may be empty = whole segment).
export const PDF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups', 'questions'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'code', 'total', 'each', 'tajuk', 'labels', 'confidence', 'note'],
        properties: {
          name: { type: 'string', description: 'A few words naming this batch for the teacher (not engraved).' },
          code: {
            anyOf: [{ type: 'null' }, {
              type: 'object', additionalProperties: false, required: ['ref', 'text'],
              properties: { ref: { type: 'string' }, text: { type: 'string', description: 'The plaque code exactly as printed, e.g. "PK 242".' } },
            }],
          },
          total: REF_VALUE('The total the file states for this batch, e.g. 50 for "50 pcs".'),
          each: REF_VALUE('Plaques per label when the file says so for the whole batch (e.g. "2 setiap"), else null.'),
          tajuk: { type: 'array', items: { type: 'string', description: REF_DESC }, description: 'The ceremony / school header lines printed at the top of every label, top to bottom, from ONE label. Empty if none.' },
          labels: {
            type: 'array',
            description: 'Each label: its engraved lines below the tajuk, top to bottom. Each line: its options. One option = a fixed line; several = the line varies (one plaque per option).',
            items: { type: 'array', items: { type: 'array', items: { type: 'string', description: '"REF", "REF|TEXT" or "REF|TEXT|QTY|QTYREF".' } } },
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { ...nullableString, description: 'One short sentence for the teacher if something needs checking, else null.' },
        },
      },
    },
    questions: { type: 'array', items: { type: 'string', description: 'A short question for the teacher, answerable by looking at the file.' } },
  },
} as const;

type RefValue = { ref: string; value: number } | null;
type Group = {
  name: string; code: { ref: string; text: string } | null; total: RefValue; each: RefValue;
  tajuk: string[]; labels: string[][][]; confidence: string; note: string | null;
};
export type PdfReading = { groups: Group[]; questions: string[] };

const REF_RE = /^p\d+s\d+(-p\d+s\d+)?$/;

// Shape re-check (a refusal or truncation must not slip through). Whether
// each ref and quoted text really exists is checked in the browser, which
// has the segments.
export function validatePdfReading(value: unknown): { ok: true; value: PdfReading } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'not an object' };
  const v = value as PdfReading;
  if (!Array.isArray(v.groups) || !Array.isArray(v.questions)) return { ok: false, error: 'missing groups/questions' };
  for (const g of v.groups) {
    if (!Array.isArray(g.labels) || !Array.isArray(g.tajuk)) return { ok: false, error: 'bad group' };
    const refs = [...g.tajuk, g.code?.ref, g.total?.ref, g.each?.ref];
    for (const label of g.labels) {
      if (!Array.isArray(label) || label.some((ln) => !Array.isArray(ln))) return { ok: false, error: 'bad label' };
      label.forEach((ln) => ln.forEach((o) => { const [ref, , , qtyRef] = String(o).split('|'); refs.push(ref, qtyRef || undefined); }));
    }
    if (refs.some((r) => r != null && !REF_RE.test(r))) return { ok: false, error: 'bad ref' };
  }
  return { ok: true, value: v };
}
