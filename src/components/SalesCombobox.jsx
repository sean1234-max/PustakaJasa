import { useState, useRef, useEffect } from 'react';

// Type-to-search picker for the fixed salesman roster — the teacher types a
// few letters (e.g. "joy") and only names starting with that text are
// offered (e.g. "Joyce"), matching the front-of-name search staff expect.
// The committed value only ever changes on an explicit pick, so a stray
// blur can't leave a name outside the roster sitting in the order.
export default function SalesCombobox({ id, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(value || ''); } };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, value]);

  const filtered = options.filter((name) => name.toLowerCase().startsWith(query.trim().toLowerCase()));

  const pick = (name) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
  };

  return (
    <div className="field" style={{ position: 'relative' }} ref={ref}>
      <label htmlFor={id}>Sales</label>
      <input
        className="input"
        id={id}
        placeholder="Search sales representative"
        autoComplete="off"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered.length === 1) { pick(filtered[0]); e.preventDefault(); }
          else if (e.key === 'Escape') { setOpen(false); setQuery(value || ''); }
        }}
      />
      {open && (
        <div className="combo-pop card elev-lg">
          {filtered.length === 0 && <div className="combo-empty">No match</div>}
          {filtered.map((name) => (
            <div
              key={name}
              className={`combo-item${name === value ? ' combo-item-selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(name); }}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
