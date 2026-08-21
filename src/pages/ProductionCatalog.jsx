import { useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { stockZoneFor } from '../data/catalog';

const STOCK_ZONE_COLOR = { red: '#c0392b', orange: '#d98c00', normal: undefined };

// One row per catalog node, recursing into its children. Each row can add
// a variant beneath it, edit its own price/stock, hide/unhide it, remove it
// (and everything beneath it), or move it up/down among its own siblings —
// that's what controls which variant a teacher sees listed first. Groups
// with children start collapsed (see ProductionCatalog's collapsedIds) so
// opening the catalog shows only top-level codes, not every nested variant
// at once.
function CatalogRow({
  node, depth, canMoveUp, canMoveDown, onAddChild, onRemove, onPriceChange, onStockChange, onToggleHidden, onMove,
  collapsedIds, onToggleCollapsed,
}) {
  const [addingChild, setAddingChild] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [priceDraft, setPriceDraft] = useState(String(node.price ?? 0));
  const [stockDraft, setStockDraft] = useState(node.stockQty == null ? '' : String(node.stockQty));

  // Unlike price, stock changes constantly from a source outside this
  // page — every teacher order deducts it — so the mount-only useState
  // above goes stale the moment any other Production/Admin action
  // refetches the catalog (e.g. hiding a different code) while this row
  // stays mounted: the colour (computed fresh from `node` every render)
  // would update but the number next to it wouldn't, showing a wrong
  // count next to a correctly-alarming colour. Re-sync whenever the
  // fetched value actually changes.
  useEffect(() => {
    setStockDraft(node.stockQty == null ? '' : String(node.stockQty));
  }, [node.stockQty]);

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const collapsed = collapsedIds.has(node.id);
  const zone = stockZoneFor(node.stockQty, node.stockBaseline);

  const commitPrice = () => {
    const val = Number(priceDraft);
    if (!Number.isNaN(val) && val !== node.price) onPriceChange(node.id, val);
    else setPriceDraft(String(node.price ?? 0));
  };

  const commitStock = () => {
    if (stockDraft.trim() === '') {
      if (node.stockQty != null) onStockChange(node.id, null);
      return;
    }
    const val = Math.round(Number(stockDraft));
    if (!Number.isNaN(val) && val >= 0 && val !== node.stockQty) onStockChange(node.id, val);
    else setStockDraft(node.stockQty == null ? '' : String(node.stockQty));
  };

  const submitAddChild = () => {
    if (!newCode.trim()) return;
    onAddChild(node.id, newCode.trim(), Number(newPrice) || 0);
    setNewCode('');
    setNewPrice('');
    setAddingChild(false);
  };

  const handleRemove = () => {
    const label = hasChildren ? `"${node.code}" and all its variants` : `"${node.code}"`;
    if (window.confirm(`Remove ${label}? This can't be undone.`)) onRemove(node.id);
  };

  return (
    <>
      <div className="catalog-admin-row" style={{ paddingLeft: depth * 20 }}>
        {hasChildren ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={collapsed ? `Expand ${node.code}` : `Collapse ${node.code}`}
            onClick={() => onToggleCollapsed(node.id)}
          >
            {collapsed ? '▶' : '▼'}
          </button>
        ) : <span style={{ display: 'inline-block', width: 28 }} />}
        <span className={node.hidden ? 'catalog-admin-code catalog-admin-code-hidden' : 'catalog-admin-code'}>{node.code}</span>
        <input
          className="input catalog-admin-price"
          type="number"
          step="0.01"
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={commitPrice}
        />
        {!hasChildren && (
          <input
            className="input catalog-admin-price"
            type="number"
            step="1"
            min="0"
            placeholder="Stock"
            title="Stock Qty — setting a new number resets the 15%/25% warning thresholds against it"
            value={stockDraft}
            style={zone !== 'normal' ? { color: STOCK_ZONE_COLOR[zone], fontWeight: 700 } : undefined}
            onChange={(e) => setStockDraft(e.target.value)}
            onBlur={commitStock}
          />
        )}
        <div className="catalog-admin-actions">
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Move up" disabled={!canMoveUp} onClick={() => onMove(node.id, 'up')}>▲</button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Move down" disabled={!canMoveDown} onClick={() => onMove(node.id, 'down')}>▼</button>
          <button type="button" className="btn btn-ghost" onClick={() => setAddingChild((v) => !v)}>+ Variant</button>
          <button type="button" className={`btn ${node.hidden ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => onToggleHidden(node.id, !node.hidden)}>
            {node.hidden ? 'Unhide' : 'Hide'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleRemove}>Remove</button>
        </div>
      </div>

      {addingChild && (
        <div className="catalog-admin-row catalog-admin-add-row" style={{ paddingLeft: (depth + 1) * 20 }}>
          <input className="input" placeholder="Code (e.g. GOLD)" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
          <input className="input catalog-admin-price" type="number" step="0.01" placeholder="Price" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={submitAddChild}>Add</button>
          <button type="button" className="btn btn-ghost" onClick={() => setAddingChild(false)}>Cancel</button>
        </div>
      )}

      {hasChildren && !collapsed && node.children.map((child, i) => (
        <CatalogRow
          key={child.id}
          node={child}
          depth={depth + 1}
          canMoveUp={i > 0}
          canMoveDown={i < node.children.length - 1}
          onAddChild={onAddChild}
          onRemove={onRemove}
          onPriceChange={onPriceChange}
          onStockChange={onStockChange}
          onToggleHidden={onToggleHidden}
          onMove={onMove}
          collapsedIds={collapsedIds}
          onToggleCollapsed={onToggleCollapsed}
        />
      ))}
    </>
  );
}

// Collects the id of every node (at any depth) that has children — used to
// seed collapsedIds so the catalog opens showing only top-level codes.
function collectParentIds(nodes, out) {
  (nodes || []).forEach((node) => {
    if (Array.isArray(node.children) && node.children.length > 0) {
      out.add(node.id);
      collectParentIds(node.children, out);
    }
  });
  return out;
}

export default function ProductionCatalog() {
  const {
    state, addCatalogNode, removeCatalogNode, updateCatalogNodePrice, updateCatalogNodeStock, setCatalogNodeHidden, moveCatalogNode,
  } = useAppState();
  const [newTopCode, setNewTopCode] = useState('');
  const [newTopPrice, setNewTopPrice] = useState('');
  // Seeded lazily (once, on first non-empty load) rather than derived fresh
  // every render — that would fight any group a Production user manually
  // expanded back closed on the very next catalog refresh.
  const [collapsedIds, setCollapsedIds] = useState(null);
  if (collapsedIds === null && state.plakCatalog.length > 0) {
    setCollapsedIds(collectParentIds(state.plakCatalog, new Set()));
  }

  const handleAddChild = (parentId, code, price, siblingCount) => {
    addCatalogNode(parentId, code, price, siblingCount);
  };
  const handleRemove = (id) => {
    removeCatalogNode(id);
  };
  const handlePriceChange = (id, price) => {
    updateCatalogNodePrice(id, price);
  };
  const handleStockChange = (id, stockQty) => {
    updateCatalogNodeStock(id, stockQty);
  };
  const handleToggleHidden = (id, hidden) => {
    setCatalogNodeHidden(id, hidden);
  };
  const handleMove = (id, direction) => {
    moveCatalogNode(id, direction);
  };
  const toggleCollapsed = (id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addTopLevel = () => {
    if (!newTopCode.trim()) return;
    handleAddChild(null, newTopCode.trim(), Number(newTopPrice) || 0, state.plakCatalog.length);
    setNewTopCode('');
    setNewTopPrice('');
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Production</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Jenis Plak Catalog</div>
        <p className="hint-text">
          Add, remove, reprice, or hide a code (or just one of its variants) — changes apply for every teacher immediately. Hiding is safer than removing when stock runs out, since it's a one-click undo once restocked.
          Set Stock Qty on a code to start tracking its inventory — it turns orange under 25% and red under 15% of what you last entered, and orders are automatically capped (and the code auto-hidden at 0) once stock runs low. Leave it blank to skip stock tracking for a code.
        </p>

        <div className="catalog-admin-row catalog-admin-add-row" style={{ marginBottom: 'var(--space-4)' }}>
          <input className="input" placeholder="New top-level code" value={newTopCode} onChange={(e) => setNewTopCode(e.target.value)} />
          <input className="input catalog-admin-price" type="number" step="0.01" placeholder="Price" value={newTopPrice} onChange={(e) => setNewTopPrice(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={addTopLevel}>+ Add Code</button>
        </div>

        {!state.plakCatalogLoaded ? (
          <p className="hint-text">Loading catalog…</p>
        ) : state.plakCatalog.length === 0 ? (
          <p className="hint-text">No codes yet — add one above.</p>
        ) : (
          <div className="catalog-admin-list">
            {state.plakCatalog.map((node, i) => (
              <CatalogRow
                key={node.id}
                node={node}
                depth={0}
                canMoveUp={i > 0}
                canMoveDown={i < state.plakCatalog.length - 1}
                onAddChild={(parentId, code, price) => handleAddChild(parentId, code, price, 0)}
                onRemove={handleRemove}
                onPriceChange={handlePriceChange}
                onStockChange={handleStockChange}
                onToggleHidden={handleToggleHidden}
                onMove={handleMove}
                collapsedIds={collapsedIds || new Set()}
                onToggleCollapsed={toggleCollapsed}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
