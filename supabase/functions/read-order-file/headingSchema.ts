// kind "pdf-heading": a picture of a PDF order's first page, for the lines
// of the sample label the PDF draws as a picture (the school's name, the
// ceremony, SESI 2026) — text the PDF reader (kind "pdf") never sees.
// Only those fixed header lines come back; the plaques themselves are still
// read from the PDF's own text. The browser shows them as read from a
// picture, for staff to check (src/utils/pdfMapping.js).
// Any change here must bump HEADING_VERSION — it is part of the cache key.

export const HEADING_VERSION = '1';

export const HEADING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines', 'confidence'],
  properties: {
    lines: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

export const HEADING_SYSTEM_PROMPT = `You look at the first page of a Malaysian school's order for engraved award plaques (Pustaka Jasa).

Find the SAMPLE plaque or label drawn on the page (often a framed box or plaque shape with the school's logo). List the lines printed on it that are the SAME on every plaque, top to bottom: the school's name (SEKOLAH KEBANGSAAN ..., SJK(C) ..., SMK ..., a second school line such as SEKOLAH KLUSTER KECEMERLANGAN), the ceremony (MAJLIS ..., HARI ANUGERAH ...) and its session or year (SESI 2026, (SESI 2026), 2026).

Leave out every line that changes from plaque to plaque, often printed in red: the award (ANUGERAH ...), subject, position (PERTAMA ...), class, Tahun, or a student's name. Leave out instructions and titles printed outside the sample label.

Copy each line exactly as printed, in capitals as printed, keeping brackets and punctuation; do not correct spelling. If there is no sample label, or you cannot read it, return no lines and confidence "low".`;

export const buildHeadingUserText = () => 'Page 1 of the order. List the fixed header lines of its sample plaque label.';

export function validateHeading(v: unknown): { ok: true; value: { lines: string[]; confidence: string } } | { ok: false; error: string } {
  if (!v || typeof v !== 'object') return { ok: false, error: 'not an object' };
  const o = v as { lines?: unknown; confidence?: unknown };
  if (!Array.isArray(o.lines) || o.lines.some((l) => typeof l !== 'string')) return { ok: false, error: 'lines' };
  const lines = (o.lines as string[]).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
  if (lines.some((l) => l.length > 120)) return { ok: false, error: 'line too long' };
  const confidence = ['high', 'medium', 'low'].includes(o.confidence as string) ? o.confidence as string : 'low';
  return { ok: true, value: { lines, confidence } };
}
