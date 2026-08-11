import { CATEGORIES } from './catalog';

export function buildInitialRowsByBlock() {
  const out = {};
  let id = 1;
  CATEGORIES.filter((c) => c.mode === 'list').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = cat.rows.map((label) => ({ id: id++, desc: label, qty: '' }));
    }
  });
  return out;
}

export function buildInitialPlakRows() {
  const out = {};
  let id = 1;
  CATEGORIES.forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = [{ id: id++, jenisPlak: '' }];
    }
  });
  return out;
}
