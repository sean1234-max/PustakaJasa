// The website's own FORM ANUGERAH filler, bundled for the telegram-bot edge function's form bot
// (form.ts). xlsx / jszip stay outside the bundle and load as npm: packages in Deno.
// Rebuild after changing templateExport.js / umumLines.js / docxImport.js:  npm run build:bot-bundle
export { fillOrderTemplate } from '../../src/utils/templateExport.js';
// The form bot's no-AI Word reader (ruleRead.ts): the website's own Word table reader
export { loadDocx, readWordingTables } from '../../src/utils/docxImport.js';
