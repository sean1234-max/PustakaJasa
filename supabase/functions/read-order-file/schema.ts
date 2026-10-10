// The ONLY thing the model returns: a mapping of where things are, by cell
// reference. No values. The browser (src/utils/aiMapping.js) reads every
// word and number back out of the file itself using these refs, so the
// model can never mistype a name or a quantity. Bump MAPPING_VERSION
// whenever this shape changes (it is part of the cache key).

export const MAPPING_VERSION = '1';

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableInt = { anyOf: [{ type: 'integer' }, { type: 'null' }] };

export const MAPPING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['blocks', 'questions'],
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sheet', 'role', 'titleCell', 'codeCell', 'headerRow', 'firstRow', 'lastRow',
          'wordingColumns', 'qtyColumn', 'codeColumn', 'labelColumn', 'classColumns', 'confidence', 'note',
        ],
        properties: {
          sheet: { type: 'string', description: 'Exact sheet name as given.' },
          role: { type: 'string', enum: ['award-list', 'class-matrix', 'ignore'] },
          titleCell: { ...nullableString, description: 'A1 ref of the award title (ACARA), or null.' },
          codeCell: { ...nullableString, description: 'A1 ref of ONE plaque code for the whole block, or null.' },
          headerRow: { ...nullableInt, description: 'Row number of the column headers.' },
          firstRow: { ...nullableInt, description: 'First data row (1-based).' },
          lastRow: { ...nullableInt, description: 'Last data row (1-based), inclusive; may include a JUMLAH row.' },
          wordingColumns: { type: 'array', items: { type: 'string' }, description: 'award-list: column letters whose text, top to bottom, is engraved.' },
          qtyColumn: { ...nullableString, description: 'award-list: column letter of the quantity.' },
          codeColumn: { ...nullableString, description: 'award-list: column letter of a per-row plaque code, or null.' },
          labelColumn: { ...nullableString, description: 'class-matrix: column letter of the row labels (subject/placing).' },
          classColumns: { type: 'array', items: { type: 'string' }, description: 'class-matrix: column letters, one per class; class name is in headerRow.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { ...nullableString, description: 'One short sentence for the teacher if something needs checking, else null.' },
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sheet', 'text'],
        properties: {
          sheet: nullableString,
          text: { type: 'string', description: 'A short question for the teacher, answerable by looking at the file.' },
        },
      },
    },
  },
} as const;

type Block = {
  sheet: string; role: string; titleCell: string | null; codeCell: string | null;
  headerRow: number | null; firstRow: number | null; lastRow: number | null;
  wordingColumns: string[]; qtyColumn: string | null; codeColumn: string | null;
  labelColumn: string | null; classColumns: string[]; confidence: string; note: string | null;
};
export type Mapping = { blocks: Block[]; questions: { sheet: string | null; text: string }[] };

// Structured outputs already guarantee the shape; this re-check guards
// against a refusal/truncation slipping through and against sheet names
// the request never sent.
export function validateMapping(value: unknown, sheetNames: string[]): { ok: true; value: Mapping } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'not an object' };
  const v = value as Mapping;
  if (!Array.isArray(v.blocks) || !Array.isArray(v.questions)) return { ok: false, error: 'missing blocks/questions' };
  for (const b of v.blocks) {
    if (!sheetNames.includes(b.sheet)) return { ok: false, error: `unknown sheet ${b.sheet}` };
    if (!['award-list', 'class-matrix', 'ignore'].includes(b.role)) return { ok: false, error: `bad role ${b.role}` };
  }
  return { ok: true, value: v };
}
