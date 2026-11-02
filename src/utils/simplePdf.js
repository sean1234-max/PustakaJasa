// A PDF of whole-page pictures (Sean, 2026-11-02: the Plak Preview's Download PDF): each page one
// JPEG, stretched over an A4 page. Nothing else (no text, no fonts) — the page is drawn on a canvas
// first, so no PDF library is needed for it.
export const A4 = { width: 595.28, height: 841.89 };

const enc = new TextEncoder();

// pages: [{ jpeg: Uint8Array, width, height }] (the picture's pixels) -> the PDF file's bytes
export function jpegPagesToPdf(pages) {
  const chunks = [];
  const offsets = [];
  let size = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };
  const object = (n, ...parts) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
  };
  // 1 catalog, 2 page tree, then per page: page, its drawing, its picture
  const pageNo = (i) => 3 + i * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageNo(i)} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const n = pageNo(i);
    const draw = `q ${A4.width} 0 0 ${A4.height} 0 0 cm /Im0 Do Q`;
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    object(n + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    object(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream');
  });
  const count = 3 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  chunks.forEach((c) => { out.set(c, at); at += c.length; });
  return out;
}
