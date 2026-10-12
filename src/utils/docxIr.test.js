import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { buildDocxIr } from './docxIr';
import { renderPdfIrText } from './pdfIr';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const p = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (...lines) => `<w:tc>${lines.map(p).join('') || '<w:p/>'}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;

async function docx(body) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('buildDocxIr', () => {
  it('reads paragraphs, a text box once, and table cells by column', async () => {
    const box = '<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent>'
      + `${p('MAJLIS CONTOH 2026')}${p('NAMA CONTOH')}${p('ANUGERAH BINTANG')}`
      + '</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>'
      + `${p('MAJLIS CONTOH 2026')}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
    const table = `<w:tbl>${row(cell('ANUGERAH'), cell('BIL'), cell('PENERIMA'))}`
      + `${row(cell('1) BINTANG'), cell('1'), cell('MURID SATU'))}${row(cell(), cell('2'), cell('MURID DUA', 'KELAS 1'))}</w:tbl>`;
    const ir = await buildDocxIr(await docx(`${p('LABEL (SM-1)')}${box}${table}`), { DOMParser });
    expect(ir.segments.map((s) => [s.id, s.x, s.text])).toEqual([
      ['p1s1', 0, 'LABEL (SM-1)'],
      ['p1s2', 50, 'MAJLIS CONTOH 2026'], ['p1s3', 50, 'NAMA CONTOH'], ['p1s4', 50, 'ANUGERAH BINTANG'],
      ['p1s5', 0, 'ANUGERAH'], ['p1s6', 100, 'BIL'], ['p1s7', 200, 'PENERIMA'],
      ['p1s8', 0, '1) BINTANG'], ['p1s9', 100, '1'], ['p1s10', 200, 'MURID SATU'],
      ['p1s11', 100, '2'], ['p1s12', 200, 'MURID DUA'],
      ['p1s13', 200, 'KELAS 1'],
    ]);
    expect(renderPdfIrText(ir)).toContain('[p1s11 x=100] 2  [p1s12 x=200] MURID DUA');
  });

  it('returns null for a file that is not a .docx', async () => {
    expect(await buildDocxIr(new Uint8Array([1, 2, 3]), { DOMParser })).toBeNull();
  });
});
