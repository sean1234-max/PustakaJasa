// The WhatsApp message Production sends the salesman for an AI Review "Ask salesman" issue
// (Sean, 2026-11-04: waiting on the salesman is the slowest part of a review — a ready, clear
// question gets a faster answer). English (Sean, 2026-11-04).

const plaques = (n) => (n > 1 ? ` (${n} plaques)` : '');

// One issue → one question, without the order header
export function questionFor(issue) {
  const where = issue.sheet ? `Sheet ${issue.sheet}: ` : '';
  switch (issue.rule) {
    case 'B1':
      return `${where}${(issue.wordList || [issue.word]).join(', ')} — RED or BLACK? (see picture)`;
    case 'D1':
      return `${where}"${issue.find}" is already in the TAJUK BESAR. Remove this line ("-") or keep it?${plaques(issue.count)}`;
    case 'I3':
      return `FRONT PG has ${issue.find} × ${issue.frontQty} but the order doesn't. Should it be added?`;
    case 'I4':
      return `${issue.find}: FRONT PG and the order don't match. ${issue.frontQty != null ? `FRONT PG ${issue.frontQty}, order ${issue.orderQty}. ` : ''}Which is correct?`;
    case 'E1':
      return `${where}Jenis Plak "${issue.find}" has no code / price. Please give the code and price.`;
    default:
      return `${where}Please check: ${issue.text}${plaques(issue.count)}`;
  }
}

// The whole message: who it's for, which order, then the questions numbered
export function salesmanMessage(order, issues) {
  const head = `Hi${order.sales ? ` ${order.sales}` : ''}, order ${order.id}${order.sekolah ? ` (${order.sekolah})` : ''} — please check with the teacher:`;
  const lines = issues.map((issue, i) => `${issues.length > 1 ? `${i + 1}. ` : ''}${questionFor(issue)}`);
  return [head, ...lines, 'Thank you!'].join('\n');
}
