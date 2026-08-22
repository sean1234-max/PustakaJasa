import { useState, useRef, useEffect } from 'react';

// Every leaf in the tree, paired with its full path (["MP393", "CRYSTAL",
// "80-B"]) — used to search codes nested several levels deep, not just
// top-level ones (see PlakPicker's deepMatches below).
function collectLeaves(nodes, path = []) {
  return nodes.flatMap((node) => {
    const nextPath = [...path, node.code];
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    if (!hasChildren) return [{ path: nextPath, node }];
    return collectLeaves(node.children, nextPath);
  });
}

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
// known. Typing filters the top-level codes by prefix, same as the Sales
// picker; the committed value only changes on an explicit leaf pick, so a
// stray blur can't leave half-typed text sitting in the order.
export default function PlakPicker({ value, onChange, catalog }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  // Picking the OTHERS leaf (see isOthersLeaf above) doesn't commit
  // immediately — it switches the dropdown into a small text-entry prompt
  // so the teacher can describe the item Production should source, instead
  // of just recording the bare word "OTHERS".
  const [othersMode, setOthersMode] = useState(false);
  const [othersText, setOthersText] = useState('');
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

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = catalog.filter((node) => node.code.toLowerCase().startsWith(trimmedQuery));
  // Codes nested several levels deep (e.g. CRYSTAL / 80-B / DESIGN 1) never
  // match a top-level prefix search — surfaced separately here, matched
  // against every segment of a leaf's own path (not just its own code,
  // since an intermediate code like "80-B" isn't itself a leaf/selectable —
  // matching it still needs to surface the leaves underneath it), so
  // typing "80-B" finds every variant nested under it regardless of depth.
  const deepMatches = trimmedQuery
    ? collectLeaves(catalog).filter(({ path }) => path.length > 1 && path.some((seg) => seg.toLowerCase().includes(trimmedQuery)))
    : [];

  const handlePick = (path) => {
    if (isOthersLeaf(path[path.length - 1])) {
      setOthersMode(true);
      setOthersText('');
      return;
    }
    onChange(path.join(' / '));
    setQuery(path.join(' / '));
    setOpen(false);
  };

  const commitOthers = () => {
    const text = othersText.trim();
    if (!text) return;
    const finalValue = `${OTHERS_CODE} - ${text}`;
    onChange(finalValue);
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
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered.length === 1 && !filtered[0].children?.length) { handlePick([filtered[0].code]); e.preventDefault(); }
          else if (e.key === 'Escape') closeMenu();
        }}
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
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-primary" disabled={!othersText.trim()} onClick={commitOthers}>Confirm</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOthersMode(false)}>Cancel</button>
          </div>
        </div>
      )}
      {open && !othersMode && (
        <div className="plak-menu-root card elev-lg">
          {filtered.length === 0 && deepMatches.length === 0 && <div className="combo-empty">No match</div>}
          <PlakMenuLevel nodes={filtered} path={[]} onPick={handlePick} />
          {deepMatches.length > 0 && (
            <div className="plak-menu-deep-matches">
              <div className="combo-empty" style={{ padding: '6px 10px' }}>Matched variants</div>
              {deepMatches.map(({ path, node }) => (
                <div
                  key={node.id ?? path.join('/')}
                  className="plak-menu-item plak-menu-item-leaf"
                  onClick={() => handlePick(path)}
                >
                  {path.join(' / ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
