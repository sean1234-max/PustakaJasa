import { addDays, formatDate } from '../data/catalog';

// The Excel's FRONT PG header (excelImport.js readFrontPgInfo) against the
// New Order's Function Details (Sean, 2026-10-03): a blank field is filled
// (`patch`), one that already says something else becomes a question for
// the teacher (`questions` — each side carries the patch it would write),
// a FRONT PG value that can't be used is a `notes` line, and its REMARK is
// handed back for the Remark. `current` is the draft state (picName, phone,
// selectedSalesmanId, sales, assignedSalesmen, funcSelected, remark).
const same = (a, b) => String(a || '').toUpperCase().replace(/\s+/g, ' ').trim()
  === String(b || '').toUpperCase().replace(/\s+/g, ' ').trim();

export function frontPgToFunctionDetails(fp, current, today) {
  const patch = {};
  const questions = [];
  const notes = [];
  const ask = (id, label, excel, kept) => questions.push({ id, label, excel, current: kept });

  [['picName', 'PIC Name (Cikgu)'], ['phone', 'Phone Number']].forEach(([key, label]) => {
    const value = fp[key];
    const cur = String(current[key] || '').trim();
    if (!value || same(value, cur)) return;
    if (!cur) patch[key] = value;
    else ask(key, label, { text: value, patch: { [key]: value } }, { text: cur, patch: { [key]: cur } });
  });

  if (fp.sales) {
    const match = (current.assignedSalesmen || []).find((sm) => same(sm.name, fp.sales));
    if (!match) {
      notes.push(`The Excel's FRONT PG names the salesman "${fp.sales}", who isn't in the salesman list — please check Sales in Function Details.`);
    } else if (!current.selectedSalesmanId) {
      Object.assign(patch, { selectedSalesmanId: match.id, sales: match.name });
    } else if (current.selectedSalesmanId !== match.id) {
      ask('sales', 'Sales', { text: match.name, patch: { selectedSalesmanId: match.id, sales: match.name } },
        { text: current.sales || '—', patch: { selectedSalesmanId: current.selectedSalesmanId, sales: current.sales } });
    }
  }

  if (fp.functionDate) {
    // Same floor as Function Details' own picker (NewOrderStep1).
    const minDate = addDays(today, 3);
    const cur = current.funcSelected;
    if (fp.functionDate < minDate) {
      notes.push(`The Excel's FRONT PG Function Date (${formatDate(fp.functionDate)}) is too soon — it must be on or after ${formatDate(minDate)}, so it wasn't used.`);
    } else if (!cur) {
      patch.funcSelected = fp.functionDate;
    } else if (formatDate(cur) !== formatDate(fp.functionDate)) {
      ask('functionDate', 'Function Date', { text: formatDate(fp.functionDate), patch: { funcSelected: fp.functionDate } },
        { text: formatDate(cur), patch: { funcSelected: cur } });
    }
  }

  const remark = fp.remark && !String(current.remark || '').includes(fp.remark) ? fp.remark : '';
  return { patch, questions, notes, remark };
}
