// The website's own FORM ANUGERAH filler, bundled for the telegram-bot edge function's form bot
// (form.ts). xlsx / jszip stay outside the bundle and load as npm: packages in Deno.
// Rebuild after changing templateExport.js / umumLines.js:  npm run build:bot-bundle
export { fillOrderTemplate } from '../../src/utils/templateExport.js';
