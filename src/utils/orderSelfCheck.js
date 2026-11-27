import { getTypoDictionary } from './typoCheck';

// The website's own questions at Add to Cart, with no file to compare against and no AI (Sean, 2026-11-27):
//   join  a word written joined where the words are known apart (MATAPELAJARAN → MATA PELAJARAN), or apart
//         where the word is known joined (PRA SEKOLAH → PRASEKOLAH)
//   same  one sheet with the same plaque (wording and Jenis Plak) on two or more rows — and when it carries a
//         level, which level is missing (TAHAP 2 twice, no TAHAP 1)
// History (344 reviewed orders, 2026-11-27): MATAPELAJARAN in 5, REKABENTUK in 2, PRA SEKOLAH in 4; the same
// plaque on two rows in 20, Production changed 4 of them.

const JOINED_MIN_LENGTH = 7;
const PART_MIN_LENGTH = 2;
const JOIN_MIN_PART = 3;          // both halves of a joined word: MATA + PELAJARAN, not KE + …

export const phraseRe = (phrase, flags = 'i') => new RegExp(`(?<![A-Z0-9])${String(phrase).trim().split(/\s+/).join('\\s+')}(?![A-Z0-9])`, flags);
export const replacePhrase = (text, from, to) => String(text ?? '').replace(phraseRe(from, 'gi'), to);

// `lines`: [{ text, blockKey, target }] (NewOrderStep2 collectEngraving). One issue per word and fix,
// { kind: 'join', where: 'plaque', word, kk (the other way), blockKeys, targets }.
export function joinedWordIssues(lines, dictionary = getTypoDictionary()) {
  const dict = new Set(dictionary);
  const found = new Map();
  const add = (word, kk, line) => {
    const key = `${word}>${kk}`;
    const hit = found.get(key) || { kind: 'join', where: 'plaque', word, kk, blockKeys: [], targets: [] };
    found.set(key, {
      ...hit,
      blockKeys: [...new Set([...hit.blockKeys, line.blockKey])],
      targets: [...hit.targets, line.target].filter(Boolean),
    });
  };
  (lines || []).forEach((line) => {
    const tokens = String(line.text || '').toUpperCase().split(/\s+/).filter(Boolean);
    (String(line.text || '').toUpperCase().match(/[A-Z]+/g) || []).forEach((w) => {
      if (w.length < JOINED_MIN_LENGTH || dict.has(w)) return;
      for (let cut = JOIN_MIN_PART; cut <= w.length - JOIN_MIN_PART; cut += 1) {
        if (dict.has(w.slice(0, cut)) && dict.has(w.slice(cut))) { add(w, `${w.slice(0, cut)} ${w.slice(cut)}`, line); break; }
      }
    });
    // two words apart only across a space (PRA SEKOLAH, not PRA-SEKOLAH)
    tokens.forEach((w, i) => {
      const next = tokens[i + 1];
      const plain = (t) => /^[A-Z]+$/.test(t || '') && t.length >= PART_MIN_LENGTH;
      if (plain(w) && plain(next) && dict.has(w + next) && !(dict.has(w) && dict.has(next))) add(`${w} ${next}`, w + next, line);
    });
  });
  return [...found.values()];
}

// ------------------------------------------------------------------ both, ready for the Add to Cart panel
// `items`: the cart items being added (one per quantity-table row for the row sheets); `lines`: their engraving
// texts (collectEngraving); `rowsByBlock`: the draft's rows (for "row 3"); `plaquesOf(items)`:
// reviewChecks.aiPlaquesOf. Each issue gets the plaque to draw, how many plaques it is about, and — where one
// click can fix it — `targets` with `fixFrom` → `fixTo`.
export function selfCheckIssues({ items, lines, rowsByBlock, plaquesOf, dictionary }) {
  const blockKeyOf = (it) => `${it.categoryKey}::${it.blockIdx ?? 0}`;
  const blockPlaques = new Map();
  (items || []).forEach((it) => { const b = blockKeyOf(it); blockPlaques.set(b, [...(blockPlaques.get(b) || []), it]); });
  blockPlaques.forEach((its, b) => blockPlaques.set(b, plaquesOf(its)));
  const joins = joinedWordIssues(lines, dictionary).map((i) => {
    const re = phraseRe(i.word);
    const having = i.blockKeys.flatMap((b) => blockPlaques.get(b) || []).filter((p) => re.test(plaqueText(p)));
    return { ...i, plaque: having[0], count: having.reduce((n, p) => n + (p.count || 1), 0) || 1, fixFrom: i.word, fixTo: i.kk };
  });
  const rows = (items || []).flatMap((it) => {
    const own = Array.isArray(it.detail?.rows) ? it.detail.rows : [];
    const blockKey = blockKeyOf(it);
    const rowNo = own.length === 1 ? (rowsByBlock?.[blockKey] || []).findIndex((r) => r.id === own[0].id) + 1 : 0;
    const plaques = rowNo ? plaquesOf([it]) : [];
    return plaques.length === 1 ? [{ blockKey, rowId: own[0].id, rowNo, jenisPlak: it.jenisPlak, plaque: plaques[0] }] : [];
  });
  const sames = repeatedPlaqueIssues(rows).map((i) => {
    if (!i.level?.to) return { ...i, targets: [] };
    const [blockKey] = i.blockKeys;
    const re = phraseRe(i.level.from);
    const at = (lines || []).find((l) => l.target?.rowsKey === blockKey && l.target.rowId === i.level.rowId && re.test(l.text));
    return { ...i, targets: at ? [at.target] : [], fixFrom: i.level.from, fixTo: i.level.to };
  });
  return [...joins, ...sames];
}

// ------------------------------------------------------------------ the same plaque on two rows
const NUMBER_WORDS = ['SATU', 'DUA', 'TIGA', 'EMPAT', 'LIMA', 'ENAM'];
const LEVEL_RANGE = { TAHAP: 2, TAHUN: 6, DARJAH: 6, TINGKATAN: 5 };
// a level, not a range ("TAHUN 1-6") or a longer number
const LEVEL_RE = /\b(TAHAP|TAHUN|DARJAH|TINGKATAN)\s+([1-6]|SATU|DUA|TIGA|EMPAT|LIMA|ENAM)\b(?!\s*-\s*\d)/;
const levelOf = (text) => {
  const m = String(text).match(LEVEL_RE);
  if (!m) return null;
  const asWord = NUMBER_WORDS.includes(m[2]);
  return { token: m[0], kind: m[1], value: asWord ? NUMBER_WORDS.indexOf(m[2]) + 1 : Number(m[2]), asWord };
};
const levelToken = (lv, value) => `${lv.kind} ${lv.asWord ? NUMBER_WORDS[value - 1] : value}`;
const norm = (t) => String(t || '').toUpperCase().replace(/\s+/g, ' ').trim();
export const plaqueText = (p) => [p?.header, p?.red, ...(p?.black || [])].map(norm).filter(Boolean).join(' / ');
const slug = (t) => t.replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

// `rows`: one per quantity-table row, in row order — { blockKey, rowId, rowNo, jenisPlak, plaque } with the
// plaque the row engraves (reviewChecks.aiPlaquesOf). A repeated plaque with a level missing is a question of
// its own; the other repeated plaques of a sheet are one question (ORD-0417: 1 LILY, 1 TULIP … three times each).
// { kind: 'same', where: 'plaque', word (the plaques as a key), plaque (the first), groups: [{ rowNos, text }],
//   rowNos (the first's), count (rows), blockKeys, level }
// level: { from, to (the one missing level, if only one), missing, rowId (the later row, where a fix goes) }
export function repeatedPlaqueIssues(rows) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    const text = plaqueText(r.plaque);
    if (!text) return;
    const key = `${r.blockKey}|${norm(r.jenisPlak)}|${text}`;
    groups.set(key, [...(groups.get(key) || []), { ...r, text }]);
  });
  // the levels each program of a block has (its plaque with the level taken out), any Jenis Plak
  const levels = new Map();
  (rows || []).forEach((r) => {
    const text = plaqueText(r.plaque);
    const lv = levelOf(text);
    if (!lv) return;
    const prog = `${r.blockKey}|${lv.kind}|${text.replace(LEVEL_RE, '#')}`;
    levels.set(prog, new Set([...(levels.get(prog) || []), lv.value]));
  });
  const issues = [...groups.values()].filter((list) => list.length > 1).map((list) => {
    const [first] = list;
    const lv = levelOf(first.text);
    const present = lv ? levels.get(`${first.blockKey}|${lv.kind}|${first.text.replace(LEVEL_RE, '#')}`) : null;
    const missing = lv ? Array.from({ length: LEVEL_RANGE[lv.kind] }, (_, i) => i + 1).filter((v) => !present.has(v)) : [];
    return {
      kind: 'same',
      where: 'plaque',
      word: slug(first.text),
      plaque: first.plaque,
      rowNos: list.map((r) => r.rowNo),
      groups: [{ rowNos: list.map((r) => r.rowNo), text: first.text }],
      count: list.length,
      blockKeys: [first.blockKey],
      level: lv && missing.length ? {
        from: lv.token,
        missing: missing.map((v) => levelToken(lv, v)),
        to: missing.length === 1 ? levelToken(lv, missing[0]) : null,
        rowId: list[list.length - 1].rowId,
      } : null,
    };
  });
  const bySheet = new Map();
  issues.filter((i) => !i.level).forEach((i) => bySheet.set(i.blockKeys[0], [...(bySheet.get(i.blockKeys[0]) || []), i]));
  return [
    ...issues.filter((i) => i.level),
    ...[...bySheet.values()].map((list) => (list.length === 1 ? list[0] : {
      ...list[0],
      word: `${list[0].word}_AND_${list.length - 1}_MORE`,
      groups: list.flatMap((i) => i.groups),
      count: list.reduce((n, i) => n + i.count, 0),
    })),
  ];
}
