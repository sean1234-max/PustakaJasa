// A FORM ANUGERAH the bot filled remembers where it came from (Sean, 2026-11-26). The reading and the teacher's
// kertas kerja go in form_fills (migration 0132) under an id, and the id goes into the Excel as a custom
// document property (Excel / WPS keep it when the salesman saves). When that Excel is imported on the website
// (src/utils/formFillTag.js), the kertas kerja goes on the order by itself, and Add to Cart compares the
// plaques with the reading (kertasKerjaCheck.js) at no cost. Best effort: a failure here never stops a fill.

import { db } from './db.ts';

export const FORM_FILL_PROP = 'PJSB_FORM_FILL'; // the same name in src/utils/formFillTag.js
const FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}';
const CUSTOM_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const VT_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
const CUSTOM_TYPE = 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
const CUSTOM_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';
const OWN_PROP_RE = new RegExp(`<property\\b[^>]*\\bname="${FORM_FILL_PROP}"[^>]*>[\\s\\S]*?</property>`, 'g');

const property = (pid: number, id: string) => `<property fmtid="${FMTID}" pid="${pid}" name="${FORM_FILL_PROP}"><vt:lpwstr>${id}</vt:lpwstr></property>`;

/** docProps/custom.xml carrying the id (an earlier id of ours dropped, the template's own properties kept) */
export function withFillProp(customXml: string | null, id: string) {
  if (!customXml) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="${CUSTOM_NS}" xmlns:vt="${VT_NS}">${property(2, id)}</Properties>`;
  }
  // an empty <Properties …/> (a template re-saved without properties) opened up so ours has a place
  const kept = customXml.replace(OWN_PROP_RE, '').replace(/<Properties\b([^>]*?)\s*\/>/, '<Properties$1></Properties>');
  const withVt = kept.includes('xmlns:vt=') ? kept : kept.replace('<Properties ', `<Properties xmlns:vt="${VT_NS}" `);
  // pid 0 and 1 are reserved; ours goes after the template's own
  const pid = Math.max(1, ...[...withVt.matchAll(/\bpid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  return withVt.replace('</Properties>', `${property(pid, id)}</Properties>`);
}

/** [Content_Types].xml knowing docProps/custom.xml */
export const withCustomPart = (types: string) => (types.includes('/docProps/custom.xml')
  ? types
  : types.replace('</Types>', `<Override PartName="/docProps/custom.xml" ContentType="${CUSTOM_TYPE}"/></Types>`));

/** _rels/.rels pointing at docProps/custom.xml */
export const withCustomRel = (rels: string) => (rels.includes('docProps/custom.xml')
  ? rels
  : rels.replace('</Relationships>', `<Relationship Id="rIdPjsbCustom" Type="${CUSTOM_REL}" Target="docProps/custom.xml"/></Relationships>`));

type Zip = {
  file(path: string): { async(type: 'string'): Promise<string> } | null;
  file(path: string, data: string): unknown;
  generateAsync(o: { type: 'uint8array'; compression: 'DEFLATE' }): Promise<Uint8Array>;
};

/** the filled form with the id in it; `JSZip` passed in (npm:jszip in the bot, jszip in the tests) */
export async function tagFormFill(buffer: Uint8Array, id: string, JSZip: { loadAsync(b: Uint8Array): Promise<Zip> }) {
  const zip = await JSZip.loadAsync(buffer);
  const text = (path: string) => zip.file(path)?.async('string') ?? Promise.resolve(null);
  const [custom, types, rels] = await Promise.all([text('docProps/custom.xml'), text('[Content_Types].xml'), text('_rels/.rels')]);
  if (!types || !rels) return buffer;
  zip.file('docProps/custom.xml', withFillProp(custom, id));
  zip.file('[Content_Types].xml', withCustomPart(types));
  zip.file('_rels/.rels', withCustomRel(rels));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** the reading and the kertas kerja kept (the file in order-imports, form-bot/) → the id, or null */
export async function saveFormFill(reading: Record<string, unknown>, bytes: Uint8Array | undefined, fileName: string) {
  try {
    const id = crypto.randomUUID();
    let kkPath: string | null = null;
    if (bytes) {
      const ext = (fileName.match(/\.[a-z0-9]{1,8}$/i)?.[0] || '').toLowerCase();
      const path = `form-bot/kk-${id}${ext}`;
      const { error } = await db.storage.from('order-imports').upload(path, bytes, { contentType: 'application/octet-stream', upsert: false });
      if (error) console.error('form fill: kertas kerja upload failed:', error.message);
      else kkPath = path;
    }
    const { error } = await db.from('form_fills').insert({ id, reading, kk_path: kkPath, kk_name: kkPath ? fileName.slice(0, 200) : null });
    if (error) {
      console.error('form_fills insert failed:', error.message);
      return null;
    }
    return id;
  } catch (err) {
    console.error('saving the form fill failed:', err);
    return null;
  }
}
