import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { readDocxSelempang, selempangWarnaFromHex } from './docxSelempang';
import { parseWordingDocx } from './docxImport';

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
].join(' ');
const para = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const txbx = (text) => `<w:txbxContent>${para(text)}</w:txbxContent>`;
// A sash box as Word 2010+ writes it, with its older VML copy under mc:Fallback.
const box = (hex, text = 'TOKOH AKADEMIK') => `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><a:graphic><a:graphicData><wps:wsp>
  <wps:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>
  <wps:txbx>${txbx(text)}</wps:txbx></wps:wsp></a:graphicData></a:graphic></w:drawing></mc:Choice>
  <mc:Fallback><w:pict><v:rect fillcolor="#${hex}"><v:textbox>${txbx(text)}</v:textbox></v:rect></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
const vmlBox = (hex) => `<w:p><w:r><w:pict><v:rect fillcolor="#${hex.toLowerCase()}"><v:textbox>${txbx('X')}</v:textbox></v:rect></w:pict></w:r></w:p>`;

async function makeDocx(bodyXml) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
const read = async (body) => readDocxSelempang(await makeDocx(body), { DOMParser });

describe('selempangWarnaFromHex', () => {
  it('names the four sash colours, and nothing else', () => {
    expect(['FF0000', 'C00000', '00B0F0', '0070C0', 'FFC000', 'FFFF00', '00B050', '92D050'].map(selempangWarnaFromHex))
      .toEqual(['MERAH', 'MERAH', 'BIRU', 'BIRU', 'KUNING', 'KUNING', 'HIJAU', 'HIJAU']);
    expect(['FFFFFF', '808080', '000000', 'FF66FF', '7030A0'].map(selempangWarnaFromHex)).toEqual(['', '', '', '', '']);
  });
});

describe('readDocxSelempang', () => {
  it('reads each sash heading with the colour of its boxes', async () => {
    const { section, notes } = await read([
      para('SELEMPANG NILAM (2 PCS)'), box('FF0000'), box('FF0000'), para('*selempang merah, nak font warna putih. TQ'),
      para('SELEMPANG TOKOH AKADEMIK TAHAP 1 (2 PCS)'), box('00B0F0'), box('00B0F0'),
      para('SELEMPANG TOKOH MURID TAHAP 2'), vmlBox('00B050'), vmlBox('00B050'), vmlBox('00B050'),
    ].join(''));
    expect(section.isSelempangList).toBe(true);
    expect(section.selempangRows).toEqual([
      { acara: 'NILAM', warna: 'MERAH', warnaCode: '0050', qty: 2 },
      { acara: 'TOKOH AKADEMIK TAHAP 1', warna: 'BIRU', warnaCode: '0053', qty: 2 },
      { acara: 'TOKOH MURID TAHAP 2', warna: 'HIJAU', warnaCode: '0052', qty: 3 },
    ]);
    expect(notes).toEqual(['Selempang "NILAM": selempang merah, nak font warna putih. TQ']);
  });

  it('leaves the colour blank when it cannot tell', async () => {
    const { section, notes } = await read([
      para('SELEMPANG TOKOH SUKAN (1 PCS)'), box('FFFFFF'),
      para('SELEMPANG TOKOH KOKURIKULUM (2 PCS)'), box('FF0000'), box('00B0F0'),
    ].join(''));
    expect(section.selempangRows.map((r) => r.warna)).toEqual(['', '']);
    expect(notes).toHaveLength(2);
  });

  it('finds nothing in a file without sash headings', async () => {
    expect((await read(para('MAJLIS ANUGERAH 2026') + box('FF0000'))).section).toBeNull();
  });
});

describe('parseWordingDocx with selempang', () => {
  it('adds a SELEMPANG tab next to the plaque tables', async () => {
    const cell = (t) => `<w:tc>${t.split('\n').map(para).join('')}</w:tc>`;
    const tbl = `<w:tbl><w:tr>${['BIL', 'WORDING', 'BILANGAN', 'JENIS / KOD'].map(cell).join('')}</w:tr><w:tr>${['1', 'ANUGERAH NILAM\nTAHUN 1', '1', 'PKC 263'].map(cell).join('')}</w:tr></w:tbl>`;
    const res = await parseWordingDocx(await makeDocx(para('HARI ANUGERAH KUALITI 2026') + tbl + para('SELEMPANG NILAM (2 PCS)') + box('FF0000')), { DOMParser });
    expect(res.error).toBeUndefined();
    expect(res.categorized.SELEMPANG[0].selempangRows).toEqual([{ acara: 'NILAM', warna: 'MERAH', warnaCode: '0050', qty: 2 }]);
  });
});

describe('boxes with "N PLAK" / "KOD" under them (plak-ham 2026.docx)', () => {
  const cell = (...lines) => `<w:tc>${lines.map(para).join('')}</w:tc>`;
  const table = (...rows) => `<w:tbl>${rows.map((cells) => `<w:tr>${cells.join('')}</w:tr>`).join('')}</w:tbl>`;
  const head = ['HARI APRESIASI MURID SKJK', '2026'];
  it('each box takes the count under it (none = 1) and the code under its group', async () => {
    const body = para('PLAK HAM') // a title before any box isn't a code
      + table([cell(...head, 'PENGAWAS SEKOLAH TAHUN 6')]) + para('18PLAK')
      + table([cell(...head, 'ANUGERAH APRESIASI SENI')]) + para('6 PLAK')
      + para('KOD PK 261A')
      + table([cell(...head, 'TOKOH', 'PEMBACA BESTARI'), cell(...head, 'TOKOH', 'ADIWIRA')])
      + para('SHINING STICKER A');
    const res = await parseWordingDocx(await makeDocx(body), { DOMParser });
    expect(res.error).toBeUndefined();
    const rows = res.categorized.UMUM[0].umumRows;
    expect(rows.map((r) => [r.jenisPlak, r.qty])).toEqual([['PK 261A', 18], ['PK 261A', 6], ['SHINING STICKER A', 1], ['SHINING STICKER A', 1]]);
    expect(res.categorized.UMUM[0].lines['0']).toBe('HARI APRESIASI MURID SKJK\n2026');
  });
});
