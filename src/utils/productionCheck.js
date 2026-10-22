import { CSV_COLUMNS } from './exportCsv';

// Production's automatic check before Generate AI File (Sean, 2026-10-22: the manager was checking
// every plaque of every order by hand). Each check returns issues
// { kind, text, count, sample } — one per distinct problem, `count` plaques having it — so the
// manager looks only at what's flagged.

const ENGRAVED = ['event_header', 'year', 'position', 'event_line_1', 'event_line_2'].map((c) => CSV_COLUMNS.indexOf(c));
const JENIS_PLAK = CSV_COLUMNS.indexOf('jenis_plak');
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toUpperCase();
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

// A CSV row's engraved lines, top to bottom.
export const plaqueLines = (row) => ENGRAVED.flatMap((i) => String(row[i] ?? '').split('\n')).map(norm).filter(Boolean);

// What's wrong on one plaque's wording: the same line twice, a year on two lines ("MAJLIS … 2026"
// and "TAHUN 2026"), a word typed twice in a row.
export function plaqueProblems(lines) {
  const out = [];
  const seen = new Set();
  lines.forEach((l) => {
    if (seen.has(l)) out.push(`"${l}" appears twice on the plaque`);
    seen.add(l);
  });
  const years = new Map();
  lines.forEach((l, i) => (l.match(YEAR_RE) || []).forEach((y) => years.set(y, new Set([...(years.get(y) || []), i]))));
  years.forEach((at, y) => {
    if (at.size > 1 && new Set([...at].map((i) => lines[i])).size > 1) out.push(`the year ${y} is on ${at.size} lines`);
  });
  lines.forEach((l) => {
    const m = /\b([A-Z]{2,})\s+\1\b/.exec(l);
    if (m) out.push(`"${m[1]} ${m[1]}" — a word typed twice`);
  });
  return out;
}

// Every CSV row (blank invoice-gap rows skipped), problems grouped across plaques.
export function checkPlaqueWording(rows) {
  const byText = new Map();
  (rows || []).forEach((row) => {
    const lines = plaqueLines(row);
    if (!lines.length) return;
    plaqueProblems(lines).forEach((text) => {
      const hit = byText.get(text) || { kind: 'wording', text, count: 0, sample: `${row[JENIS_PLAK] || ''}: ${lines.join(' / ')}` };
      hit.count += 1;
      byText.set(text, hit);
    });
  });
  return [...byText.values()];
}

// Plaques per Jenis Plak in the CSV vs the order's quantity (Reserved plaques are left out of both).
export function checkPlaqueCounts(groups) {
  return (groups || []).flatMap((g) => {
    const ordered = (g.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0) - (g.csvData?.reservedCount || 0);
    const inCsv = g.csvData?.rows?.length || 0;
    return ordered === inCsv ? [] : [{
      kind: 'count', count: Math.abs(ordered - inCsv), sample: g.jenisPlak,
      text: `${g.jenisPlak}: the order has ${ordered} plaque(s) but the AI file would get ${inCsv}`,
    }];
  });
}

// After Generate AI File: SEAN.jsx's run report (AI File helper v5, job.report) against the CSV the
// website sent. A file not made, a Jenis Plak with fewer / more plaques laid out than in the CSV,
// a field whose words differ from the CSV (cut off / changed), a field broken onto more lines than
// the CSV has. Same problem on many plaques = one issue.
// SEAN.jsx breaks a name on purpose before BIN / BINTI / A/L / A/P (splitNameAtBin) — not a problem.
const NAME_BREAK_RE = /^(BIN|BINTI|BT|A\/L|A\/P)\b/;
const nameSplitOnly = (csv, laid) => laid.length === csv.filter(Boolean).length + 1 && laid.slice(1).some((l) => NAME_BREAK_RE.test(l));
const squashText = (lines) => norm((lines || []).join(' ')); // \s also takes the no-break spaces SEAN.jsx adds
export function checkAiReport(report, csvRows) {
  if (!report) return [];
  const issues = [];
  (report.files || []).filter((f) => f.state !== 'saved').forEach((f) => issues.push({
    kind: 'file', count: f.rows, sample: f.codes,
    text: `No AI file made for ${f.codes || '(no code)'} — ${f.reason || f.state} (${f.rows} plaque(s))`,
  }));
  const ordered = {};
  (csvRows || []).forEach((r) => {
    if (!plaqueLines(r).length) return;
    const code = r[JENIS_PLAK] || '';
    ordered[code] = (ordered[code] || 0) + 1;
  });
  const skippedCodes = new Set((report.files || []).filter((f) => f.state !== 'saved').flatMap((f) => f.codes.split(', ')));
  Object.entries(ordered).forEach(([code, n]) => {
    const laid = report.counts?.[code] || 0;
    if (laid !== n && !skippedCodes.has(code)) {
      issues.push({ kind: 'count', count: Math.abs(n - laid), sample: code, text: `${code}: the CSV has ${n} plaque(s) but the AI file has ${laid}` });
    }
  });
  const grouped = new Map();
  (report.plaques || []).forEach((p) => {
    const laidLines = p.laid.map(norm).filter(Boolean);
    let key;
    let text;
    if (squashText(p.csv) !== squashText(laidLines)) {
      key = `changed|${p.field}|${squashText(p.csv)}|${laidLines.join(' / ')}`;
      text = `${p.field}: "${p.csv.join(' / ')}" came out as "${laidLines.join(' / ') || '(nothing)'}"`;
    } else if (laidLines.length > p.csv.filter(Boolean).length && !nameSplitOnly(p.csv, laidLines)) {
      key = `split|${p.field}|${laidLines.join(' / ')}`;
      text = `${p.field} broken onto ${laidLines.length} lines: "${laidLines.join(' / ')}"`;
    } else return;
    const hit = grouped.get(key) || { kind: key.split('|')[0], text, count: 0, sample: p.code };
    hit.count += 1;
    grouped.set(key, hit);
  });
  return [...issues, ...[...grouped.values()].sort((a, b) => b.count - a.count)];
}
