import { describe, it, expect } from 'vitest';
import { jpegPagesToPdf } from './simplePdf';

const text = (bytes) => new TextDecoder('latin1').decode(bytes);

describe('jpegPagesToPdf', () => {
  it('writes one A4 page per picture with a cross-reference table that points at each object', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = jpegPagesToPdf([{ jpeg, width: 10, height: 14 }, { jpeg, width: 10, height: 14 }]);
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Count 2');
    expect(s.match(/\/Subtype \/Image/g)).toHaveLength(2);
    // startxref points at "xref", and every entry at its "n 0 obj"
    const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const entries = s.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l)).map((l) => Number(l.slice(0, 10)));
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
