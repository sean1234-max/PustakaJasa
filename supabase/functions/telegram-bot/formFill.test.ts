import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import fs from 'node:fs';

vi.mock('./db.ts', () => ({ db: {} }));
const { FORM_FILL_PROP, tagFormFill, withCustomPart, withCustomRel, withFillProp } = await import('./formFill.ts');
const { formFillIdOf } = await import('../../../src/utils/formFillTag.js');

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TEMPLATE = new URL('../../../public/templates/FORM-ANUGERAH.xlsx', import.meta.url);

describe('withFillProp', () => {
  it('adds ours after the template\'s own properties', () => {
    const xml = '<Properties xmlns="x" xmlns:vt="v"><property fmtid="f" pid="2" name="ICV"><vt:lpwstr>a</vt:lpwstr></property></Properties>';
    const out = withFillProp(xml, ID);
    expect(out).toContain('name="ICV"');
    expect(out).toContain(`pid="3" name="${FORM_FILL_PROP}"><vt:lpwstr>${ID}</vt:lpwstr>`);
  });

  it('opens an empty self-closing <Properties/>', () => {
    const out = withFillProp('<Properties xmlns="x" xmlns:vt="v"/>', ID);
    expect(out).toMatch(new RegExp(`^<Properties xmlns="x" xmlns:vt="v"><property [^>]*name="${FORM_FILL_PROP}"><vt:lpwstr>${ID}</vt:lpwstr></property></Properties>$`));
  });

  it('replaces an earlier id instead of adding a second', () => {
    const once = withFillProp(null, 'old-id');
    const twice = withFillProp(once, ID);
    expect(twice.match(new RegExp(FORM_FILL_PROP, 'g'))).toHaveLength(1);
    expect(twice).toContain(ID);
  });
});

describe('content types and rels', () => {
  it('are added once', () => {
    const types = withCustomPart('<Types></Types>');
    expect(withCustomPart(types)).toBe(types);
    const rels = withCustomRel('<Relationships></Relationships>');
    expect(withCustomRel(rels)).toBe(rels);
  });
});

describe('tagFormFill', () => {
  it('writes an id the website reads back from the real template', async () => {
    const tagged = await tagFormFill(new Uint8Array(fs.readFileSync(TEMPLATE)), ID, JSZip);
    expect(formFillIdOf(tagged)).toBe(ID);
    // the form still reads as FORM ANUGERAH
    expect(XLSX.read(tagged, { type: 'array', bookSheets: true }).SheetNames).toContain('ORDER LAIN-LAIN');
  });

  it('gives no id for an untagged form', () => {
    expect(formFillIdOf(new Uint8Array(fs.readFileSync(TEMPLATE)))).toBeNull();
  });
});
