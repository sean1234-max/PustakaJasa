// The website's own New Order reading (FORM ANUGERAH → the order's items, with the checks Add to Cart and
// Submit make), bundled for the telegram-bot edge function's Submit (submit.ts). xlsx / jszip stay outside
// the bundle and load as npm: packages in Deno.
// Rebuild after changing botOrder.js / applyParsedImport.js / excelImport.js / categoryCartItems.js / catalog.js:
//   npm run build:bot-bundle
export { readOrderForm, questionId } from '../../src/utils/botOrder.js';
export { buildPlakTree } from '../../src/utils/plakTree.js';
export { standardUnitPrice, isCustomPlakCode } from '../../src/data/catalog.js';
export { isCrystalCode } from '../../src/utils/exportCsv.js';
// Production's own typo words (custom_typo_words), added to the word list as the website does
export { setCustomTypoWords } from '../../src/utils/typoCheck.js';
// ReviewAgent's red-line check (autoReview.ts): the website AI Review's own program rules
export { reviewOrder } from '../../src/utils/reviewChecks.js';
