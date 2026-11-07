// ReviewAgent's review report and which file it reads (autoReview.ts) — no Telegram or database here

const SITE_URL = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const orderLink = (id: string) => `<a href="${SITE_URL}/#/production/orders/${encodeURIComponent(id)}">${esc(id)}</a>`;
const MAX_SHOWN = 15;              // differences listed in one message

export type FileRef = { path: string; name: string };
export type Diff = { kind: string; where: string; inFile: string; inOrder: string };
export type Red = { rule: string; level: string; text: string; sheet: string; count: number; sample?: string };

const KIND_LABEL: Record<string, string> = {
  wording: '✏️ Wording / spelling', quantity: '🔢 Quantity', missing_in_order: '➕ In the kertas kerja, not in the order',
  extra_in_order: '➖ In the order, not in the kertas kerja', other: '❓ Other',
};

// The teacher's own file(s): the kertas kerja, else the order file (a FORM ANUGERAH the teacher filled)
export function teacherFiles(o: { kertas_kerja_files: FileRef[] | null; import_files: FileRef[] | null; import_file_path: string | null; import_file_name: string | null }): FileRef[] {
  if (o.kertas_kerja_files?.length) return o.kertas_kerja_files;
  if (o.import_files?.length) return o.import_files;
  return o.import_file_path ? [{ path: o.import_file_path, name: o.import_file_name || 'order.xlsx' }] : [];
}

export function reportHtml(o: { id: string; sekolah: string }, fileNames: string[], summary: string, diffs: Diff[], red: Red[], mention: string) {
  const lines = [`🔍 <b>Review ${orderLink(o.id)}</b> · ${esc(o.sekolah)}`];
  if (fileNames.length) lines.push(`Compared with the teacher's ${fileNames.length > 1 ? 'files' : 'file'}: ${fileNames.map(esc).join(', ')}`);
  if (summary) lines.push(esc(summary));
  let n = 0;
  for (const kind of Object.keys(KIND_LABEL)) {
    const ofKind = diffs.filter((d) => d.kind === kind);
    if (!ofKind.length) continue;
    lines.push('', `<b>${KIND_LABEL[kind]}</b>`);
    ofKind.slice(0, MAX_SHOWN).forEach((d) => {
      const both = [d.inFile && `kertas kerja: "${esc(d.inFile)}"`, d.inOrder && `order: "${esc(d.inOrder)}"`].filter(Boolean).join(' · ');
      lines.push(`${++n}. ${esc(d.where)}${both ? ` — ${both}` : ''}`);
    });
    if (ofKind.length > MAX_SHOWN) lines.push(`… and ${ofKind.length - MAX_SHOWN} more`);
  }
  if (red.length) {
    lines.push('', '<b>🔴 Red line</b>');
    red.forEach((r) => lines.push(`${++n}. ${esc(r.text)}${r.count > 1 ? ` (${r.count} plaques)` : ''}`));
  }
  lines.push('', `${mention ? `${mention} ` : ''}please check with the teacher and <b>reply to this message</b> with the answers (by number).`);
  return lines.join('\n');
}

