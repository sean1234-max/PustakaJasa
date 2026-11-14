import { useState, useRef, useEffect } from 'react';

import { searchLeaves } from '../utils/plakSearch';

// Search results shown at most (type more to narrow).
const MAX_RESULTS = 60;

// Production's catch-all code for a design that isn't in the catalog at all
// (discontinued, not yet added, or the teacher just doesn't see what they
// want) — picking it prompts for free text instead of immediately
// committing, see PlakPicker's othersMode below. Matches either spelling
// since the actual catalog code (Production-entered, not hardcoded) is
// "OTHER", not "OTHERS".
const OTHERS_CODE = 'OTHER';
function isOthersLeaf(code) {
  const normalized = (code || '').trim().toUpperCase();
  return normalized === 'OTHER' || normalized === 'OTHERS';
}

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
// known. Typing searches every code (searchLeaves) and Enter picks the
// highlighted one; the committed value only changes on an explicit leaf
// pick, so a stray blur can't leave half-typed text sitting in the order.
export default function PlakPicker({ value, onChange, catalog }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  // Picking the OTHERS leaf (see isOthersLeaf above) doesn't commit
  // immediately — it switches the dropdown into a small text-entry prompt
  // so the teacher can describe the item Production should source, instead
  // of just recording the bare word "OTHERS".
  const [othersMode, setOthersMode] = useState(false);
  const [othersText, setOthersText] = useState('');
  // OTHER has no website price, so its unit price is asked for here too
  // (Sean, 2026-10-07) and handed to onChange as the 2nd argument.
  const [othersPrice, setOthersPrice] = useState('');
  const othersPriceOk = othersPrice.trim() !== '' && Number(othersPrice) >= 0;
  const ref = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  const closeMenu = () => { setOpen(false); setOthersMode(false); setQuery(value || ''); };

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) closeMenu(); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  // Typing searches every code (searchLeaves: "628" finds "YK - 628"); the field as it was (its own
  // value, or empty) shows the full tree to browse instead.
  const searching = query.trim() !== '' && query !== (value || '');
  const results = searching ? searchLeaves(catalog, query) : [];
  // the highlighted result — Enter picks it, ↑ / ↓ move it (Sean, 2026-11-14)
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [query]);
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { closeMenu(); return; }
    if (!open || !searching) { if (e.key === 'Enter') { closeMenu(); e.preventDefault(); } return; }
    const shown = Math.min(results.length, MAX_RESULTS);
    if (e.key === 'ArrowDown' && shown) { setActive((i) => (i + 1) % shown); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && shown) { setActive((i) => (i - 1 + shown) % shown); e.preventDefault(); }
    else if (e.key === 'Enter') {
      if (results[active]) handlePick(results[active].path);
      e.preventDefault();
    }
  };

  const handlePick = (path) => {
    if (isOthersLeaf(path[path.length - 1])) {
      setOthersMode(true);
      setOthersText('');
      setOthersPrice('');
      return;
    }
    onChange(path.join(' / '));
    setQuery(path.join(' / '));
    setOpen(false);
  };

  const commitOthers = () => {
    const text = othersText.trim();
    if (!text || !othersPriceOk) return;
    const finalValue = `${OTHERS_CODE} - ${text}`;
    onChange(finalValue, Number(othersPrice));
    setQuery(finalValue);
    setOpen(false);
    setOthersMode(false);
  };

  return (
    <div className="plak-picker" ref={ref}>
      <input
        className="input"
        placeholder="— Select —"
        autoComplete="off"
        value={query}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && othersMode && (
        <div className="plak-menu-root card elev-lg" style={{ padding: 'var(--space-3)', width: 280 }}>
          <div className="hint-text" style={{ margin: '0 0 var(--space-2)' }}>Describe the item for Production (e.g. STAND MEDAL 1453):</div>
          <input
            className="input"
            autoFocus
            value={othersText}
            placeholder="e.g. STAND MEDAL 1453"
            onChange={(e) => setOthersText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitOthers(); e.preventDefault(); }
              else if (e.key === 'Escape') { setOthersMode(false); e.stopPropagation(); }
            }}
          />
          <div className="hint-text" style={{ margin: 'var(--space-2) 0' }}>Harga per unit (RM):</div>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={othersPrice}
            placeholder="e.g. 33"
            onChange={(e) => setOthersPrice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitOthers(); e.preventDefault(); }
              else if (e.key === 'Escape') { setOthersMode(false); e.stopPropagation(); }
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-primary" disabled={!othersText.trim() || !othersPriceOk} onClick={commitOthers}>Confirm</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOthersMode(false)}>Cancel</button>
          </div>
        </div>
      )}
      {open && !othersMode && !searching && (
        <div className="plak-menu-root card elev-lg">
          <PlakMenuLevel nodes={catalog} path={[]} onPick={handlePick} />
        </div>
      )}
      {open && !othersMode && searching && (
        <div className="plak-menu-root card elev-lg">
          {results.length === 0 && <div className="combo-empty">No match</div>}
          <div className="plak-menu-results" ref={listRef}>
            {results.slice(0, MAX_RESULTS).map(({ path, node }, i) => (
              <div
                key={node.id ?? path.join('/')}
                className={`plak-menu-item plak-menu-item-leaf${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => handlePick(path)}
              >
                {path.join(' / ')}
              </div>
            ))}
          </div>
          {results.length > MAX_RESULTS && (
            <div className="combo-empty">{results.length - MAX_RESULTS} more — type more to narrow</div>
          )}
        </div>
      )}
    </div>
  );
}
