// Every medal is made from E CUT 0 (Sean, 2026-11-25): SEAN.jsx's isHangingMedalCode (HM… / HANGING MEDAL, any
// case) plus product_mapping.csv's other E CUT 0 rows. On ORDER LAIN-LAIN a medal row takes the fixed medal lines
// (utils/umumLines.js) and the tab's medal design (MEDAL DESIGNS).
export const ROUND_MEDAL_FILE = 'E CUT 0 - MEDAL (SUKAN) -SALES.ai';
// ponytail: product_mapping.csv's E CUT 0 rows that aren't HM…; add a code here when one is added there
const MAPPED_ROUND_MEDALS = ['15062', '15063', 'MEDAL BOLA'];

/** @param {string} code */
export const isHangingMedalCode = (code) => /^\s*HM([^A-Z]|$)/i.test(String(code || '')) || /HANGING\s*MEDAL/i.test(String(code || ''));

/** a Jenis Plak made from E CUT 0 ("HM-M-0031 / GOLD", "15063 / SILVER" …) */
export function isRoundMedalCode(code) {
  const base = String(code || '').split('/')[0].trim().toUpperCase();
  return isHangingMedalCode(code) || MAPPED_ROUND_MEDALS.includes(base);
}

const codesOf = (rows) => (rows || []).map((r) => r?.jenisPlak).filter(Boolean);
/** an ORDER LAIN-LAIN tab with at least one medal row — it gets the medal design picker */
export const hasMedalRows = (rows) => codesOf(rows).some(isRoundMedalCode);
/** every row with a Jenis Plak is a medal — the tab's Reference Sample shows the medal lines */
export const isMedalBlock = (rows) => codesOf(rows).length > 0 && codesOf(rows).every(isRoundMedalCode);
