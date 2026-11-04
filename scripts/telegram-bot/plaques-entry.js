// The website's own plaque builder, bundled for the telegram-bot edge function (file compare): the
// order's plaques are worked out exactly as Generate AI File does. Rebuild after changing
// exportCsv.js / catalog.js:  npm run build:bot-bundle — it writes the function's copy (tests use it)
// and public/bot/ (the deployed function imports it from the website: its plaques.bundle.js is
// deployed as `export * from 'https://pustaka-jasa.vercel.app/bot/plaques.bundle.js'`), then push.
export { buildCsvRows, CSV_COLUMNS } from '../../src/utils/exportCsv.js';
export { resolveCategory } from '../../src/data/catalog.js';
