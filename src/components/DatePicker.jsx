import { useState, useRef, useEffect } from 'react';
import { WEEKDAYS, MONTHS, formatDate } from '../data/catalog';

function buildCells(view, selected, today, minDate, handleSelect) {
  const { y, m } = view;
  const firstDow = new Date(y, m, 1).getDay();
  const totalDays = new Date(y, m + 1, 0).getDate();
  const prevTotalDays = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) {
    const day = prevTotalDays - firstDow + 1 + i;
    cells.push({ label: day, curMonth: false, date: new Date(y, m - 1, day) });
  }
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ label: d, curMonth: true, date: new Date(y, m, d) });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ label: nextDay, curMonth: false, date: new Date(y, m + 1, nextDay) });
    nextDay++;
  }
  return cells.map((c, i) => {
    const isSelected = selected && c.date.toDateString() === selected.toDateString();
    const isToday = c.date.toDateString() === today.toDateString();
    const isDisabled = Boolean(minDate) && c.date < minDate;
    let className = 'cal-cell';
    if (!c.curMonth) className += ' cal-cell-dim';
    if (isSelected) className += ' cal-cell-selected';
    else if (isToday) className += ' cal-cell-today';
    if (isDisabled) className += ' cal-cell-disabled';
    return { key: i, label: c.label, className, onClick: isDisabled ? undefined : () => handleSelect(c.date) };
  });
}

function shiftMonth(view, delta) {
  let m = view.m + delta, y = view.y;
  if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
  return { y, m };
}

export default function DatePicker({ label, id, selected, onSelect, today, minDate }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const cells = buildCells(view, selected, today, minDate, (d) => { onSelect(d); setOpen(false); });

  return (
    <div className="field" style={{ position: 'relative' }} ref={ref}>
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <input className="input" id={id} readOnly placeholder={`Select ${label.toLowerCase()}`} value={formatDate(selected)} style={{ cursor: 'pointer' }} />
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cal-icon">
          <rect x="3" y="4" width="18" height="18" rx="1" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </div>
      {open && (
        <div className="cal-pop card elev-lg">
          <div className="cal-pop-header">
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setView((v) => shiftMonth(v, -1))}>‹</button>
            <span className="cal-pop-label">{MONTHS[view.m]} {view.y}</span>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setView((v) => shiftMonth(v, 1))}>›</button>
          </div>
          <div className="cal-grid cal-grid-labels">
            {WEEKDAYS.map((wd, i) => <div key={i} className="cal-wd">{wd}</div>)}
          </div>
          <div className="cal-grid">
            {cells.map((cell) => (
              <div key={cell.key} className={cell.className} onClick={cell.onClick}>{cell.label}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
