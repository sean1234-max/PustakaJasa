// The order side of the bot: its plaques (the website's own builder, bundled — see
// scripts/telegram-bot/plaques-entry.js) and which of the proposed changes it can take.

// @ts-ignore a plain JS bundle
import { buildCsvRows, CSV_COLUMNS, resolveCategory } from './plaques.bundle.js';

const col = (name: string) => CSV_COLUMNS.indexOf(name);
// src/utils/urgentOrder.js SHIPMENT_EDITABLE_STATUSES
const SHIPMENT_EDITABLE = ['Reviewing Order', 'Salesman Approved', 'In Production'];
const CLOSED = ['Cancelled', 'Completed'];

type Item = Record<string, unknown> & { categoryKey: string; categoryLabel?: string; jenisPlak?: string; qty?: number };

// Each distinct plaque once, per sheet and Jenis Plak, with how many — what the model compares
export function orderPlaquesText(items: Item[]) {
  const lines = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const item of items || []) {
    const sheet = item.categoryLabel || resolveCategory(item.categoryKey)?.label || item.categoryKey;
    totals.set(String(item.jenisPlak), (totals.get(String(item.jenisPlak)) || 0) + (Number(item.qty) || 0));
    for (const r of buildCsvRows({ items: [item] }, null, [item]).rows) {
      const black = r[col('position_black')] === '1';
      const words = [r[col('event_header')], black ? '' : `[red] ${r[col('position')]}`, black ? r[col('position')] : '', r[col('event_line_1')], r[col('event_line_2')]]
        .map((v: unknown) => String(v || '').replace(/\s+/g, ' ').trim()).filter((v: string) => v && v !== '[red]');
      const key = `${sheet} | ${item.jenisPlak} | ${words.join(' / ')}`;
      lines.set(key, (lines.get(key) || 0) + 1);
    }
  }
  return [
    'Totals per Jenis Plak:', ...[...totals].map(([code, n]) => `- ${code}: ${n}`),
    '', 'Plaques (sheet | Jenis Plak | lines, × how many):', ...[...lines].map(([k, n]) => `- ${k} × ${n}`),
  ].join('\n');
}

export type Order = { id: string; sekolah: string; status: string; shipment_date: string | null; function_date: string | null; remark: string | null };
export type Asked = { shipmentDate?: string | null; functionDate?: string | null; remarkAdd?: string | null };
export type Change = { field: 'shipmentDate' | 'functionDate' | 'remark'; from: string; to: string };

// Malaysia's calendar day of a stored date ("2026-11-17T00:00:00+08:00" → "2026-11-17")
const myDay = (v: string | null) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(v)) : '');
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// What the bot may propose for this order, and why the rest can't be
export function proposeChanges(order: Order, asked: Asked) {
  const changes: Change[] = [];
  const refused: string[] = [];
  if (CLOSED.includes(order.status)) return { changes, refused: [`${order.id} is ${order.status} — it can't be changed.`] };
  if (asked.shipmentDate) {
    if (!ISO_DAY.test(asked.shipmentDate)) refused.push(`Shipment Date "${asked.shipmentDate}" isn't a date.`);
    else if (!SHIPMENT_EDITABLE.includes(order.status)) refused.push(`Shipment Date can't be changed while the order is ${order.status}.`);
    else if (asked.shipmentDate !== myDay(order.shipment_date)) changes.push({ field: 'shipmentDate', from: myDay(order.shipment_date), to: asked.shipmentDate });
  }
  if (asked.functionDate) {
    if (!ISO_DAY.test(asked.functionDate)) refused.push(`Function Date "${asked.functionDate}" isn't a date.`);
    else if (asked.functionDate !== myDay(order.function_date)) changes.push({ field: 'functionDate', from: myDay(order.function_date), to: asked.functionDate });
  }
  if (asked.remarkAdd?.trim()) {
    const from = order.remark || '';
    changes.push({ field: 'remark', from, to: [from, asked.remarkAdd.trim()].filter(Boolean).join('\n') });
  }
  return { changes, refused };
}
