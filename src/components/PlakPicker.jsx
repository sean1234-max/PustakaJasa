import { useState, useRef, useEffect } from 'react';

// One level of the catalog tree. An item with children shows a flyout of
// this same component to its right on hover (nested arbitrarily deep —
// Eastern Trophy needs 4 levels); a leaf item (no children) is directly
// clickable and finishes the pick. At the root level only, codes are split
// into two columns — plain codes on the left, codes that expand into a
// submenu on the right — so it's clear at a glance which ones have more to
// pick and which don't, instead of a single list with arrows scattered
// through it.
function PlakMenuLevel({ nodes, path, onPick }) {
  const [hoverCode, setHoverCode] = useState(null);
  const isRoot = path.length === 0;

  const renderItem = (node) => {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const nextPath = [...path, node.code];
    const key = node.id ?? node.code;
    return (
      <div
        key={key}
        className="plak-menu-item-wrap"
        onMouseEnter={() => setHoverCode(key)}
        onMouseLeave={() => setHoverCode((c) => (c === key ? null : c))}
      >
        <div
          className={`plak-menu-item${hasChildren ? '' : ' plak-menu-item-leaf'}`}
          onClick={() => { if (!hasChildren) onPick(nextPath); }}
        >
          <span>{node.code}</span>
          {hasChildren && <span className="plak-menu-arrow">›</span>}
        </div>
        {hasChildren && hoverCode === key && (
          <div className="plak-menu-flyout">
            <PlakMenuLevel nodes={node.children} path={nextPath} onPick={onPick} />
          </div>
        )}
      </div>
    );
  };

  if (!isRoot) {
    return <div className="plak-menu">{nodes.map(renderItem)}</div>;
  }

  const plainCodes = nodes.filter((n) => !(Array.isArray(n.children) && n.children.length > 0));
  const expandableCodes = nodes.filter((n) => Array.isArray(n.children) && n.children.length > 0);

  return (
    <div className="plak-menu-root-split">
      {plainCodes.length > 0 && <div className="plak-menu">{plainCodes.map(renderItem)}</div>}
      {expandableCodes.length > 0 && (
        <div className={`plak-menu${plainCodes.length > 0 ? ' plak-menu-col-divided' : ''}`}>
          {expandableCodes.map(renderItem)}
        </div>
      )}
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
