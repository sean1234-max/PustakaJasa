import { useState, useRef, useEffect } from 'react';

// One level of the catalog tree, rendered as a vertical list. An item with
// children shows a flyout of this same component to its right on hover
// (nested arbitrarily deep — Eastern Trophy needs 4 levels); a leaf item
// (no children) is directly clickable and finishes the pick.
function PlakMenuLevel({ nodes, path, onPick }) {
  const [hoverCode, setHoverCode] = useState(null);
  return (
    <div className="plak-menu">
      {nodes.map((node) => {
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const nextPath = [...path, node.code];
        return (
          <div
            key={node.code}
            className="plak-menu-item-wrap"
            onMouseEnter={() => setHoverCode(node.code)}
            onMouseLeave={() => setHoverCode((c) => (c === node.code ? null : c))}
          >
            <div
              className={`plak-menu-item${hasChildren ? '' : ' plak-menu-item-leaf'}`}
              onClick={() => { if (!hasChildren) onPick(nextPath); }}
            >
              <span>{node.code}</span>
              {hasChildren && <span className="plak-menu-arrow">›</span>}
            </div>
            {hasChildren && hoverCode === node.code && (
              <div className="plak-menu-flyout">
                <PlakMenuLevel nodes={node.children} path={nextPath} onPick={onPick} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Type-to-search trigger + flyout menu for picking a Jenis Plak code out of
// the (possibly nested) catalog tree — replaces a plain <select>, which
// can't express "hover a code to reveal its variants" for codes like
// SM-13187 that need a color then a base tier picked before a price is
// known. Typing filters the top-level codes by prefix, same as the Sales
// picker; the committed value only changes on an explicit leaf pick, so a
// stray blur can't leave half-typed text sitting in the order.
export default function PlakPicker({ value, onChange, catalog }) {
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

  const filtered = catalog.filter((node) => node.code.toLowerCase().startsWith(query.trim().toLowerCase()));

  const handlePick = (path) => {
    onChange(path.join(' / '));
    setQuery(path.join(' / '));
    setOpen(false);
  };

  return (
    <div className="plak-picker" ref={ref}>
      <input
        className="input"
        placeholder="— Select —"
        autoComplete="off"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered.length === 1 && !filtered[0].children?.length) { handlePick([filtered[0].code]); e.preventDefault(); }
          else if (e.key === 'Escape') { setOpen(false); setQuery(value || ''); }
        }}
      />
      {open && (
        <div className="plak-menu-root card elev-lg">
          {filtered.length === 0 && <div className="combo-empty">No match</div>}
          <PlakMenuLevel nodes={filtered} path={[]} onPick={handlePick} />
        </div>
      )}
    </div>
  );
}
