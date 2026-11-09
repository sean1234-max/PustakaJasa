// A FORM ANUGERAH read into an order the way the website's New Order does it (Sean, 2026-11-07), for the
// Telegram form bot's Submit (supabase/functions/telegram-bot/submit.ts, bundled by
// scripts/telegram-bot/order-entry.js): the same reader (excelImport.js), the same file → draft step
// (applyParsedImport.js), the same Add All to Cart (categoryCartItems.js) and the same checks the website
// makes before an order goes in. What the website asks on screen comes back as `questions` for the bot
// to ask in the chat; each answer goes back in through `subs` / `answers` / `okWords`, and the form is read
// again from the start, so nothing is ever patched by hand.
import { parseFormAnugerahExcel } from './excelImport';
import { applyParsedImport, NEW_ORDER_IMPORT_FIELDS } from '../state/applyParsedImport';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { ACTIVE_CATEGORIES, isDynamicCategoryKey, resolveCategory, getStockStatus, otherPlakIncomplete, flattenPlakCatalog, filterHiddenPlakCatalog } from '../data/catalog';
import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';
import { computeBlocks, noopUpdaters } from './computeBlocks';

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every string in the parsed file with the salesman's fixes: a whole value (a Jenis Plak he named for
// one the catalog couldn't place) or a word (a spelling fix), case ignored.
export function substitute(value, subs) {
  if (!subs?.length) return value;
  if (typeof value === 'string') {
    let out = value;
    subs.forEach((s) => {
      if (s.whole) { if (out.trim().toUpperCase() === String(s.from).trim().toUpperCase()) out = s.to; return; }
      out = out.replace(new RegExp(`(^|[^A-Za-z0-9])(${escRe(s.from)})(?=$|[^A-Za-z0-9])`, 'gi'), (m, pre) => `${pre}${s.to}`);
    });
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, subs));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, subs)]));
  }
  return value;
}

// The engraving text the website's spelling check reads before Add to Cart (NewOrderStep2.jsx
// collectEngraving) — and the UMUM lines it asks about (not in the Reference Sample: engrave anyway?)
export function engravingLines(st, catKeys) {
  const lines = [];
  const extras = [];
  catKeys.forEach((catKey) => {
    const catLabel = resolveCategory(catKey)?.label || catKey;
    const { blocks } = computeBlocks(catKey, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.columnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage);
    blocks.forEach((blk) => {
      const blockKey = `${catKey}::${blk.idx}`;
      (blk.lines || []).forEach((ln) => {
        [ln, ln.secondLine].filter(Boolean).forEach((l) => {
          const text = String(l.value || '').trim();
          const label = (l.placeholder || 'Line').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
          if (text) lines.push({ id: l.key, label, text, blockKey, where: `${catLabel} — Reference Sample` });
        });
      });
      if (blk.selempang) return;
      (blk.rows || []).forEach((row, ri) => {
        const fields = [
          ...(!blk.hideDescColumn ? [{ key: 'desc', label: blk.descColumnLabel || 'Description', value: row.desc }] : []),
          ...(row.tokohFields || []).filter((f) => f.contohSlot !== undefined),
        ];
        fields.forEach((f) => {
          const text = String(f.value || '').trim();
          if (!text || text === '-') return;
          const where = `${catLabel} — row ${ri + 1} ${f.label}`;
          lines.push({ id: `${blockKey}::row::${row.id}::${f.key}`, label: f.label, text, blockKey, where });
          if (f.extraLine) extras.push({ text, where });
        });
      });
    });
  });
  return { lines, extras };
}

// Out of stock → what to offer instead (review rule J8, Sean 2026-11-10: "PK 261 / A → PK 262 / A"): codes
// on sale with enough stock for `qty`, of the same family (the letters it starts with) — the same last part
// (A / B / GOLD …) first, then the nearest model number. At most `max`.
const familyOf = (code) => (/^[A-Z]+/i.exec(String(code).replace(/\s+/g, ''))?.[0] || '').toUpperCase();
const lastPart = (code) => String(code).split('/').pop().trim().toUpperCase();
const modelNo = (code) => Number(/\d+/.exec(String(code))?.[0] || NaN);
export function stockAlternatives(code, qty, plakCatalog, max = 3) {
  const family = familyOf(code);
  if (!family) return [];
  const want = lastPart(code);
  const n = modelNo(code);
  return flattenPlakCatalog(filterHiddenPlakCatalog(plakCatalog))
    .filter((p) => p.code !== code && familyOf(p.code) === family && !/^OTHER/i.test(p.code))
    .map((p) => ({ code: p.code, status: getStockStatus(p.code, plakCatalog) }))
    .filter((p) => !p.status || p.status.maxOrderable >= qty)
    .sort((a, b) => (lastPart(b.code) === want) - (lastPart(a.code) === want)
      || (Math.abs(modelNo(a.code) - n) || 0) - (Math.abs(modelNo(b.code) - n) || 0)
      || a.code.localeCompare(b.code))
    .slice(0, max)
    .map((p) => ({ code: p.code, left: p.status ? p.status.maxOrderable : null }));
}

// A short, stable id for a question (the same note read again is the same question)
export function questionId(kind, text) {
  let h = 0;
  for (const ch of `${kind}:${text}`) h = ((h * 31) + ch.charCodeAt(0)) | 0;
  return `${kind}:${(h >>> 0).toString(36)}`;
}

/**
 * buffer: the FORM ANUGERAH (.xlsx). ctx: { plakCatalog, schoolLanguage, salesman: { id, name },
 *   details: { picName, phone, funcSelected (Date), remark }, subs, answers: { [questionId]: optionKey },
 *   okWords: [{ blockKey, word }], swaps: [{ from, to }] (out of stock → in stock), lang: 'zh' | 'en' }
 * -> { error } | { items, total, questions, stop, problems, remark, details, lines, categories }
 *   questions: still to ask, in order (kind plak | choice | note | typo | extra); stop: an answer said
 *   "I'll do it on the website"; problems: what the chat can't fix (the order can't go in from here).
 */
export function readOrderForm(buffer, ctx) {
  const lang = ctx.schoolLanguage || 'SK';
  let parsed = parseFormAnugerahExcel(buffer);
  if (parsed.error) return { error: parsed.error };
  parsed = substitute(parsed, ctx.subs);
  const answers = ctx.answers || {};
  const salesman = ctx.salesman || { id: '', name: '' };
  const start = {
    schoolLanguage: lang, plakCatalog: ctx.plakCatalog,
    lineValues: {}, matrixValues: {},
    rowsByBlock: buildInitialRowsByBlock(lang), columnsByBlock: buildInitialColumnsByBlock(), plakRows: buildInitialPlakRows(),
    nextRowId: 1000, nextPlakRowId: 1000, nextColumnId: 1000, visibleBlocksByCategory: {}, category: null,
    picName: ctx.details?.picName || '', phone: ctx.details?.phone || '', funcSelected: ctx.details?.funcSelected || null,
    remark: ctx.details?.remark || '',
    assignedSalesmen: [salesman], selectedSalesmanId: salesman.id, sales: salesman.name,
  };
  const { finalState, warnings, categories } = applyParsedImport(start, parsed, NEW_ORDER_IMPORT_FIELDS);
  let st = finalState;

  const questions = [];
  let stop = false;
  warnings.forEach((w) => {
    if (w.type === 'plakMismatch') {
      const id = questionId('plak', w.raw);
      if (!questions.some((q) => q.id === id)) questions.push({ id, kind: 'plak', raw: w.raw, text: w.text });
      return;
    }
    if (w.type === 'choice') {
      const a = answers[w.id];
      if (!a) { questions.push({ id: w.id, kind: 'choice', text: w.text, options: w.options.map((o) => ({ key: o.key, label: o.label })) }); return; }
      // as NewOrderStep2.jsx answerChoice; "I'll fix it myself" can only be done on the website
      if ((a === 'add' || a === 'fix') && w.addPatches?.length) {
        const mv = { ...st.matrixValues };
        w.addPatches.forEach((p) => { mv[p.mkey] = p.value; });
        st = { ...st, matrixValues: mv };
      }
      const fieldPatch = w.options.find((o) => o.key === a)?.fieldPatch;
      if (fieldPatch) st = { ...st, ...fieldPatch };
      if (a === 'keep' && !fieldPatch) stop = true;
      return;
    }
    const id = questionId('note', w.text);
    if (answers[id] === 'stop') stop = true;
    else if (!answers[id]) questions.push({ id, kind: 'note', text: w.text });
  });

  // words the salesman said are right, kept on the order the way the website keeps them
  (ctx.okWords || []).forEach(({ blockKey, word }) => {
    const key = `${blockKey}::wordsOk`;
    const have = String(st.lineValues[key] || '').split(',').filter(Boolean);
    if (!have.includes(word.toUpperCase())) st = { ...st, lineValues: { ...st.lineValues, [key]: [...have, word.toUpperCase()].join(',') } };
  });

  // Jenis Plak swapped for one in stock (the salesman's choice in the chat): every row of the draft that has the
  // old code gets the new one — the price follows from the catalog — and the Remark says so for Production
  if (ctx.swaps?.length) {
    const subs = ctx.swaps.map((w) => ({ from: w.from, to: w.to, whole: true }));
    st = { ...st, plakRows: substitute(st.plakRows, subs), rowsByBlock: substitute(st.rowsByBlock, subs) };
    const notes = ctx.swaps.map((w) => `${w.from} → ${w.to} (out of stock / 缺货)`);
    st = { ...st, remark: [st.remark, ...notes.filter((x) => !String(st.remark || '').includes(x))].filter(Boolean).join('\n') };
  }

  // Add All to Cart (AppState.jsx addAllToCart): every engaged category, a category's error stops it
  const dynamicCats = Object.keys(st.visibleBlocksByCategory || {}).filter(isDynamicCategoryKey).map(resolveCategory).filter(Boolean);
  const items = [];
  const problems = [];
  const engaged = [];
  [...ACTIVE_CATEGORIES, ...dynamicCats].forEach((cat) => {
    // a possible typo is asked below (as the website's pick-under-the-word), not a stop here
    const built = buildCategoryCartItems(st, cat.key, { allowTypos: true });
    if (!built.engaged) return;
    engaged.push(cat.key);
    if (built.error) {
      // a Jenis Plak still to be named is a question above, not a problem
      if (!questions.some((q) => q.kind === 'plak')) problems.push(`${cat.label}: ${built.error}`);
      return;
    }
    items.push(...built.items);
  });
  const zh = ctx.lang !== 'en';
  if (engaged.length === 0 && !questions.some((q) => q.kind === 'plak')) problems.push(zh ? '这份 FORM ANUGERAH 里读不到任何订单。' : 'Nothing in this FORM ANUGERAH could be read as an order.');

  // The website's own word-list typo check (typoCheck.js — blocking at Add to Cart unless the right word is
  // picked under it): one question per flagged word; the answer is a fix (subs) or a kept word (okWords)
  engaged.forEach((catKey) => {
    const { blocks } = computeBlocks(catKey, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.columnsByBlock, noopUpdaters, st.plakCatalog, st.schoolLanguage);
    const label = resolveCategory(catKey)?.label || catKey;
    blocks.forEach((blk) => {
      [...(blk.lines || []), ...(blk.rows || [])].map((x) => x.typoHint).filter(Boolean).forEach((h) => {
        const blockKey = `${catKey}::${blk.idx}`;
        const id = questionId('typo', `${blockKey}|${h.clean}|${h.suggestion}`);
        if (questions.some((q) => q.id === id)) return;
        questions.push({ id, kind: 'typo', blockKey, word: h.clean, suggestion: h.suggestion, text: `${label}: "${h.text}" — "${h.clean}" or "${h.suggestion}"?` });
      });
    });
  });

  const { lines, extras } = engravingLines(st, engaged);
  extras.forEach((x) => {
    const id = questionId('extra', `${x.where}|${x.text}`);
    if (answers[id] === 'stop') stop = true;
    else if (!answers[id]) questions.push({ id, kind: 'extra', text: `${x.where}: "${x.text}" — not in the Reference Sample. Engrave it on this plaque?` });
  });

  // Cart's own checks: OTHER with no name / price, more than the stock allows
  items.filter((it) => otherPlakIncomplete(it.jenisPlak, it.unitPrice)).forEach((it) => {
    const where = resolveCategory(it.categoryKey)?.label || it.categoryKey;
    problems.push(zh ? `「${it.jenisPlak}」（${where}）没有名字或价钱。` : `"${it.jenisPlak}" (${where}) needs its name and price.`);
  });
  // not enough stock: a question — swap it for one in stock (stockAlternatives) — not a dead end
  const byCode = new Map();
  items.forEach((it) => byCode.set(it.jenisPlak, (byCode.get(it.jenisPlak) || 0) + (Number(it.qty) || 0)));
  byCode.forEach((qty, code) => {
    const status = getStockStatus(code, ctx.plakCatalog);
    if (status && qty > status.maxOrderable) {
      questions.push({ id: questionId('stock', code), kind: 'stock', code, qty, left: status.maxOrderable, options: stockAlternatives(code, qty, ctx.plakCatalog),
        text: zh ? `${code} 库存不够（订 ${qty}，只剩 ${status.maxOrderable}）。换成哪个？` : `${code} — not enough stock (${qty} ordered, ${status.maxOrderable} left). Swap it for?` });
    }
  });

  const total = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);
  // the okWords' blockKeys come from these lines
  const okBlocks = new Set((ctx.okWords || []).map((o) => `${o.blockKey}|${o.word.toUpperCase()}`));
  return {
    items, total, questions, stop, problems, categories,
    remark: st.remark || '',
    details: { picName: st.picName, phone: st.phone, funcSelected: st.funcSelected },
    lines: lines.map((l) => ({ ...l, okWords: [...okBlocks].filter((k) => k.startsWith(`${l.blockKey}|`)).map((k) => k.split('|')[1]) })),
    snapshot: {
      category: st.category, lineValues: st.lineValues, matrixValues: st.matrixValues,
      rowsByBlock: st.rowsByBlock, plakRows: st.plakRows, columnsByBlock: st.columnsByBlock,
    },
  };
}
