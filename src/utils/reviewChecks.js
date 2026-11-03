import * as XLSX from 'xlsx';
import { buildCsvRows, CSV_COLUMNS } from './exportCsv';
import { frontPgMatchKey, parseFormAnugerahExcel, readFrontPgTotals } from './excelImport';
import { resolveCategory } from '../data/catalog';
import { findPossibleTypo } from './typoCheck';
import { redLinesProblem, redPickFor, redSlotsOf, visibleRefSlots } from './redLines';

// The program half of Production's review (docs/ai-review-rules.md, Sean 2026-11-02): rules that
// never need judgment, checked on every plaque the order would engrave. Each issue is
// { rule, level, text, count, sample } — level 'fix' = Production fixes it, 'ask' = ask the
// salesman — one per distinct problem, `count` plaques having it. Only flags; never edits the order.

const col = (name) => CSV_COLUMNS.indexOf(name);
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toUpperCase();

const HINT_RE = /\(\s*(IKUT\b[^)]*|[^)]*SEPERTI DI BAWAH[^)]*)\)/i;                 // J1
const AWARD_RE = /\b(ANUGERAH|TOKOH)\b/;                                             // C3 / B1
// R1 (Sean, 2026-11-02): a rank takes the red line before ANUGERAH / TOKOH
const RANK_RE = /\b(NAIB JOHAN|JOHAN|PERTAMA|KEDUA|KETIGA|TEMPAT \w+|JUARA \w+)\b/;
const SUBJECT_RE = /\b(BAHASA \w+|MATEMATIK|SAINS|SEJARAH|PENDIDIKAN \w+|MUZIK|MORAL)\b/; // B1
const NOT_A_LINE_RE = /^(-|\d{4})?$/;
const MIN_REPEAT_LENGTH = 4;

// One plaque { header, position, line1, line2, positionBlack } — what's wrong with it.
// `umum`: ORDER LAIN-LAIN, the one sheet where ANUGERAH may sit on a black line.
export function checkPlaque(p, { umum, okWords = [] }) {
  const header = norm(p.header);
  const red = p.positionBlack ? [] : [norm(p.position)].filter(Boolean);
  const black = [...(p.positionBlack ? [p.position] : []), p.line1, p.line2].map(norm).filter(Boolean);
  const all = [header, ...red, ...black];
  const issues = [];

  all.filter((l) => HINT_RE.test(l)).forEach((l) => issues.push({
    rule: 'J1', level: 'fix', find: l.match(HINT_RE)[0], text: `Template hint left in: "${l.match(HINT_RE)[0]}" — put the real value`,
  }));
  const rankIsRed = red.some((l) => RANK_RE.test(l));
  black.forEach((l) => {
    const rank = l.match(RANK_RE)?.[0];
    if (rank) {
      issues.push({ rule: 'R1', level: 'fix', find: l, text: `"${rank}" should be the red line — a rank goes before ANUGERAH / TOKOH` });
      return;
    }
    if (AWARD_RE.test(l)) {
      if (rankIsRed) return;
      issues.push(umum
        ? { rule: 'B1', level: 'ask', word: l, text: `"${l}" is not red — ask the salesman if it should be MERAH` }
        : { rule: 'C3', level: 'fix', find: l, text: `"${l}" is on a black line — ANUGERAH… goes on row ② (red)` });
      return;
    }
    const word = l.match(SUBJECT_RE)?.[0];
    if (word) issues.push({ rule: 'B1', level: 'ask', word, text: `"${word}" is not red — ask the salesman if it should be MERAH` });
  });
  [...red, ...black].forEach((l) => {
    if (NOT_A_LINE_RE.test(l) || l.length < MIN_REPEAT_LENGTH || l === header) return;
    if (` ${header.replace(/\n/g, ' ')} `.includes(` ${l} `)) {
      issues.push({ rule: 'D1', level: 'ask', find: l, text: `"${l}" is already in TAJUK BESAR — should this line be "-"?` });
    }
  });
  new Set(all.flatMap((l) => l.split('\n'))).forEach((l) => {
    const typo = findPossibleTypo(l, undefined, okWords);
    if (typo) issues.push({ rule: 'F1', level: 'fix', find: typo.clean, text: `Typo? "${typo.clean}" → ${typo.suggestion}` });
  });
  return issues;
}

const itemRows = (order, item) => buildCsvRows(order, null, [item]).rows;
const isBareOther = (item) => /^OTHER\b/i.test(String(item.jenisPlak || '').trim())
  && (norm(item.jenisPlak) === 'OTHER' || !(Number(item.unitPrice) > 0));

// Every item of the order. `rowsOf(order, item)` gives the item's CSV rows (tests pass their own).
export function reviewOrder(order, rowsOf = itemRows) {
  const grouped = new Map();
  // one issue per (rule, words, sheet): where it is (`categoryKey`, `sheet`, the first plaque's CSV `row`)
  // so the AI Review box can show the plaque and jump to it
  const add = (issue, sample, item, row) => {
    const key = `${issue.rule}|${issue.text}|${item.categoryKey}::${item.blockIdx ?? 0}`;
    const hit = grouped.get(key) || {
      ...issue, count: 0, sample, categoryKey: item.categoryKey, sheet: item.categoryLabel || resolveCategory(item.categoryKey)?.label || item.categoryKey, row,
    };
    grouped.set(key, { ...hit, count: hit.count + 1 });
  };
  const addWords = (key, item, words, sample) => {
    const hit = grouped.get(key) || { rule: 'B1', level: 'ask', sheet: item.categoryLabel || item.categoryKey, categoryKey: item.categoryKey, itemId: item.id, word: words[0], words: new Set(), count: 0, sample };
    grouped.set(key, { ...hit, words: new Set([...hit.words, ...words]), count: hit.count + 1 });
  };
  (order.items || []).forEach((item) => {
    if (isBareOther(item)) {
      add({ rule: 'E1', level: 'ask', find: item.jenisPlak, text: `Jenis Plak "${item.jenisPlak}" has no code or price — ask the salesman` }, item.categoryLabel || item.categoryKey, item, null);
    }
    const umum = !!resolveCategory(item.categoryKey)?.umumRows;
    const prefix = `${item.categoryKey}::${item.blockIdx ?? 0}::`;
    const okWords = String(item.detail?.lines?.[`${prefix}wordsOk`] || '').split(',').filter(Boolean);
    // red or black already chosen for this sheet (Production's MERAH, or the teacher's on ORDER LAIN-LAIN)
    const merahChosen = item.detail?.lines?.[`${prefix}${merahKeyOf(umum)}`] != null;
    rowsOf(order, item).forEach((r) => {
      const plaque = {
        header: r[col('event_header')], position: r[col('position')],
        line1: r[col('event_line_1')], line2: r[col('event_line_2')], positionBlack: r[col('position_black')] === '1',
      };
      const sample = `${r[col('jenis_plak')]}: ${[plaque.header, plaque.position, plaque.line1, plaque.line2].filter(Boolean).join(' / ')}`;
      const issues = checkPlaque(plaque, { umum, okWords });
      issues.filter((i) => i.rule !== 'B1').forEach((issue) => add(issue, sample, item, r));
      // one MERAH question per sheet, not one per subject (an MP THP sheet has a dozen)
      const words = issues.filter((i) => i.rule === 'B1').map((i) => i.word);
      if (words.length && !merahChosen) addWords(`${prefix}B1`, item, words, sample);
    });
  });
  const levelRank = { fix: 0, ask: 1 };
  return [...grouped.values()]
    .map(({ words, ...issue }) => (words
      ? { ...issue, wordList: [...words], text: `Not red on ${issue.sheet}: ${[...words].join(', ')} — ask the salesman if they should be MERAH` }
      : issue))
    .sort((a, b) => levelRank[a.level] - levelRank[b.level] || b.count - a.count);
}

// ------------------------------------------------------------------ the AI half (supabase/functions/review-order-ai)
// Each distinct plaque of the order once, under a neutral id (P1, P2 …). Only id / sheet / header /
// red / black go to the model; the rest stays here to place its answer (count, sheet, CSV row).
export function aiPlaquesOf(order, rowsOf = itemRows) {
  const seen = new Map();
  (order.items || []).forEach((item) => rowsOf(order, item).forEach((r) => {
    const positionBlack = r[col('position_black')] === '1';
    const words = {
      sheet: item.categoryLabel || resolveCategory(item.categoryKey)?.label || item.categoryKey,
      header: r[col('event_header')] || '',
      red: positionBlack ? '' : r[col('position')] || '',
      black: [positionBlack ? r[col('position')] : '', r[col('event_line_1')], r[col('event_line_2')]].filter(Boolean),
    };
    const key = JSON.stringify(words);
    const hit = seen.get(key) || { ...words, id: `P${seen.size + 1}`, count: 0, categoryKey: item.categoryKey, row: r };
    seen.set(key, { ...hit, count: hit.count + 1 });
  }));
  return [...seen.values()];
}

// The model's answer as AI Review issues, placed on the first plaque it names
const AI_LEVEL = { C1: 'fix', F2: 'fix', J2: 'fix', J3: 'fix', J6: 'ask', J7: 'fix', I5: 'fix' };
export function aiIssuesToReview(issues, plaques) {
  const byId = new Map(plaques.map((p) => [p.id, p]));
  return (issues || []).filter((i) => AI_LEVEL[i.rule] && Array.isArray(i.plaqueIds)).map((i) => {
    const hits = i.plaqueIds.map((id) => byId.get(id)).filter(Boolean);
    const first = hits[0];
    return first && {
      rule: i.rule,
      level: AI_LEVEL[i.rule],
      ai: true,
      text: i.suggestion ? `${i.message} → ${i.suggestion}` : i.message,
      count: hits.reduce((n, p) => n + p.count, 0),
      sheet: first.sheet,
      categoryKey: first.categoryKey,
      row: first.row,
      find: first.red || first.black[0] || first.header,
      sample: [first.header, first.red, ...first.black].filter(Boolean).join(' / '),
    };
  }).filter(Boolean);
}

// The plaque with one line taken off (D1's "-"): the CSV row with that line emptied
export function rowWithout(row, line) {
  return row.map((v, i) => (i <= col('event_line_2') && norm(v) === norm(line) ? '' : v));
}

// ------------------------------------------------------------------ the teacher's Excel
// A1 / I3 / I4 (docs/ai-review-rules.md): the order's own Excel (the Corrected Excel when there is one)
// against the order. `buffer`: the file's ArrayBuffer; anything that isn't an .xlsx gives nothing.
export function checkExcel(order, buffer, fileName) {
  if (!/\.xlsx$/i.test(fileName || '')) return [];
  let wb;
  try { wb = XLSX.read(buffer, { type: 'array' }); } catch { return []; }
  const issues = [];
  const parsed = (() => { try { return parseFormAnugerahExcel(buffer); } catch { return null; } })();
  (parsed?.unrecognizedSheets || []).forEach((name) => issues.push({
    rule: 'A1', level: 'fix', count: 1, sample: fileName, sheet: name,
    text: `Sheet "${name}" in the Excel has orders but the website couldn't read it — add it to the order by hand`,
  }));

  const totals = readFrontPgTotals(wb);
  if (!totals) return issues;
  const front = new Map();
  totals.forEach((qty, key) => front.set(codeKey(key), (front.get(codeKey(key)) || 0) + qty));
  const ordered = new Map();
  const items = new Map();
  (order.items || []).forEach((it) => {
    const key = codeKey(it.jenisPlak);
    ordered.set(key, (ordered.get(key) || 0) + (Number(it.qty) || 0));
    if (!items.has(key)) items.set(key, it);
  });
  const frontNames = frontPgNames(wb);
  front.forEach((qty, key) => {
    const name = frontNames.get(key) || items.get(key)?.jenisPlak || key;
    if (!ordered.has(key)) {
      issues.push({ rule: 'I3', level: 'ask', count: qty, sample: fileName, sheet: 'FRONT PG', text: `FRONT PG has ${name} × ${qty} but the order has none — ask the salesman` });
    } else if (ordered.get(key) !== qty) {
      const it = items.get(key);
      issues.push({ rule: 'I4', level: 'ask', count: Math.abs(ordered.get(key) - qty), sample: fileName,
        categoryKey: it.categoryKey, sheet: it.categoryLabel || resolveCategory(it.categoryKey)?.label || it.categoryKey, find: it.jenisPlak, text: `${name}: FRONT PG says ${qty}, the order has ${ordered.get(key)} — ask the salesman which is right` });
    }
  });
  return issues;
}

// "OTHER - CPH B" on the website is FRONT PG's "CPH / B" (ORD-0234)
const codeKey = (code) => frontPgMatchKey(code).replace(/^OTHER-?/, '').replace(/\//g, '');

// FRONT PG's own spelling of each code, for the message
function frontPgNames(wb) {
  const ws = wb.Sheets[wb.SheetNames.find((n) => /^FRONT\s*PG$/i.test(n.trim()))];
  const names = new Map();
  if (!ws) return names;
  XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).flat().forEach((v) => {
    if (typeof v === 'string' && v.trim()) names.set(codeKey(v), v.trim());
  });
  return names;
}

// ------------------------------------------------------------------ MERAH: red or black?
// B1 (Sean, 2026-11-02): rather than asking in words, show Production the same plaque both ways —
// they screenshot it to the salesman and click the one the teacher picks. Saving the choice is the
// sheet's MERAH setting: redLines (redLines.js), or umumRed on ORDER LAIN-LAIN (umumLines.js).
const merahKeyOf = (umum) => (umum ? 'umumRed' : 'redLines');
const UMUM_CHOICES = ['none', '0', '1', '2', '3'];
const sameRow = (a, b) => [0, 2, 3, 4].every((i) => norm(a?.[i]) === norm(b?.[i])) && a?.[col('position_black')] === b?.[col('position_black')];
const isRedIn = (row, word) => row?.[col('position_black')] !== '1' && norm(row?.[col('position')]).includes(norm(word));

// { key, black: { value, row }, red: { value, row } | null } for the sheet holding `itemId`, shown on the
// first plaque with `word`; null when the plaque can't be found. `value` is what saving `key` stores.
export function merahChoices(order, itemId, word) {
  const item = (order.items || []).find((it) => it.id === itemId);
  if (!item) return null;
  const cat = resolveCategory(item.categoryKey);
  const prefix = `${item.categoryKey}::${item.blockIdx ?? 0}::`;
  const key = `${prefix}${merahKeyOf(!!cat?.umumRows)}`;
  const lines = item.detail?.lines || {};
  const rows = itemRows(order, item);
  const at = rows.findIndex((r) => [2, 3, 4].some((i) => norm(r[i]).includes(norm(word))));
  if (at === -1) return null;
  const rowWith = (value) => itemRows(order, { ...item, detail: { ...item.detail, lines: { ...lines, [key]: value } } })[at];
  // keep it as it is now, saved so it isn't asked again
  const blackValue = cat?.umumRows
    ? UMUM_CHOICES.find((value) => sameRow(rowWith(value), rows[at])) ?? 'none'
    : redSlotsOf(lines, prefix, cat).join(',') || 'none';
  // red: the line red on its own (joined with a JOHAN line it would take JOHAN's gold rank colour instead)
  const options = cat?.umumRows
    ? UMUM_CHOICES
    : visibleRefSlots(lines, prefix, cat).map((s) => redPickFor(lines, prefix, cat, s)).filter((p) => p && !p.checked).map((p) => p.value);
  const red = options
    .filter((value) => cat?.umumRows || !redLinesProblem({ ...lines, [key]: value }, prefix, cat))
    .map((value) => ({ value, row: rowWith(value) }))
    .find((c) => isRedIn(c.row, word)) || null;
  return { key, black: { value: blackValue, row: rows[at] }, red };
}
