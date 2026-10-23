// An order's Remark as it was written, line breaks kept — and lines with " | " columns (the
// "CODE | QTY | UNIT PRICE | TOTAL PRICE" lines a school's own list adds, schoolList.js) shown as
// a table, so the columns line up (Sean, 2026-10-23).
const isTableLine = (line) => line.includes(' | ');

export default function RemarkText({ text }) {
  const blocks = [];
  String(text || '').split('\n').forEach((line) => {
    const last = blocks[blocks.length - 1];
    const table = isTableLine(line);
    if (last && last.table === table) last.lines.push(line);
    else blocks.push({ table, lines: [line] });
  });
  return (
    <div>
      {blocks.map((b, i) => (b.table ? (
        <table key={i} className="remark-table">
          <tbody>
            {b.lines.map((line, r) => {
              const cells = line.split(' | ');
              const Cell = r === 0 && /^CODE$/i.test(cells[0].trim()) ? 'th' : 'td';
              return <tr key={r}>{cells.map((c, k) => <Cell key={k}>{c.trim()}</Cell>)}</tr>;
            })}
          </tbody>
        </table>
      ) : (
        <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{b.lines.join('\n')}</div>
      )))}
    </div>
  );
}
