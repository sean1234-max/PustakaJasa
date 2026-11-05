// The Function Details list a salesman writes under the FORM ANUGERAH he sends the form bot (Sean,
// 2026-11-05) — read by rules, no AI:
//   SEKOLAH NAMA: SK TAMAN MUDA
//   CIKGU NAMA: PN AISYAH
//   PHONE NUMBER: 012-3456789
//   KETUA PANITIA: EN RAHMAN
//   TERMS: L/O
//   SHIPMENT DATE: 20/11
//   FUNCTION DATE: 23/11/2026
// Becomes an order_drafts row (migration 0114) the salesman opens on the website.

import { askedDay } from './order.ts';

export type DraftFields = {
  sekolah: string; picName: string; phone: string; ketuaPanitia: string;
  terms: 'L/O' | 'Cash' | ''; shipmentDate: string; functionDate: string;
};

// Each field and the labels it goes by (the words in either order, PANITA as Sean typed it)
const LABELS: [keyof DraftFields, RegExp][] = [
  ['sekolah', /^(?:SEKOLAH(?:\s+NAMA)?|NAMA\s+SEKOLAH|SCHOOL(?:\s+NAME)?)$/],
  ['picName', /^(?:CIKGU(?:\s+NAMA)?|NAMA\s+CIKGU|PIC(?:\s+NAME)?|TEACHER)$/],
  ['phone', /^(?:PHONE(?:\s+NUMBER)?|NO\.?\s*(?:TEL|TELEFON|HP)|TEL(?:EFON)?)$/],
  ['ketuaPanitia', /^KETUA\s+PANIT(?:I)?A$/],
  ['terms', /^TERMS?$/],
  ['shipmentDate', /^SHIPMENT(?:\s+DATE)?$/],
  ['functionDate', /^(?:FUNCTION(?:\s+DATE)?|TARIKH\s+MAJLIS)$/],
];

const terms = (v: string): DraftFields['terms'] => (/^L\s*\/?\s*O$/i.test(v) ? 'L/O' : /^CASH$/i.test(v) ? 'Cash' : '');

// The list in a caption, or null when the caption isn't one (it must name the school)
export function readDraftList(text: string, today: string) {
  const fields: DraftFields = { sekolah: '', picName: '', phone: '', ketuaPanitia: '', terms: '', shipmentDate: '', functionDate: '' };
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const label = m[1].replace(/\s+/g, ' ').trim().toUpperCase();
    const field = LABELS.find(([, re]) => re.test(label))?.[0];
    if (!field || !m[2]) continue;
    const value = m[2];
    if (field === 'terms') fields.terms = terms(value);
    else if (field === 'shipmentDate' || field === 'functionDate') fields[field] = askedDay(value, today);
    else if (field === 'phone') fields.phone = value.replace(/[^0-9-]/g, '');
    else fields[field] = value.toUpperCase();
  }
  if (!fields.sekolah) return null;
  const missing = (Object.keys(fields) as (keyof DraftFields)[]).filter((k) => !fields[k]);
  return { fields, missing };
}
