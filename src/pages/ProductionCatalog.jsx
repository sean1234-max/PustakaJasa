import { useState } from 'react';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { logAdminAction } from '../lib/adminApi';

// One row per catalog node, recursing into its children. Each row can add
// a variant beneath it, edit its own price, hide/unhide it, remove it (and
// everything beneath it), or move it up/down among its own siblings —
// that's what controls which variant a teacher sees listed first.
function CatalogRow({ node, depth, canMoveUp, canMoveDown, onAddChild, onRemove, onPriceChange, onToggleHidden, onMove }) {
  const [addingChild, setAddingChild] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [priceDraft, setPriceDraft] = useState(String(node.price ?? 0));

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  const commitPrice = () => {
    const val = Number(priceDraft);
    if (!Number.isNaN(val) && val !== node.price) onPriceChange(node.id, val);
    else setPriceDraft(String(node.price ?? 0));
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
        <span className={node.hidden ? 'catalog-admin-code catalog-admin-code-hidden' : 'catalog-admin-code'}>{node.code}</span>
        <input
          className="input catalog-admin-price"
          type="number"
          step="0.01"
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={commitPrice}
        />
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

      {hasChildren && node.children.map((child, i) => (
        <CatalogRow
          key={child.id}
          node={child}
          depth={depth + 1}
          canMoveUp={i > 0}
          canMoveDown={i < node.children.length - 1}
          onAddChild={onAddChild}
          onRemove={onRemove}
          onPriceChange={onPriceChange}
          onToggleHidden={onToggleHidden}
          onMove={onMove}
        />
      ))}
    </>
  );
}

// Shared as-is between /production/catalog and /admin/catalog (see
// src/App.jsx) — same component, same AppState handlers. The admin-audit-
// log calls below are role-gated, so Production's existing behavior is
// completely unaffected.
export default function ProductionCatalog() {
  const { state, addCatalogNode, removeCatalogNode, updateCatalogNodePrice, setCatalogNodeHidden, moveCatalogNode } = useAppState();
  const [newTopCode, setNewTopCode] = useState('');
  const [newTopPrice, setNewTopPrice] = useState('');

  const isAdmin = state.role === 'admin';
  const logCatalogAction = (action, targetId, after) => {
    if (isAdmin) logAdminAction({ action, targetTable: 'plak_catalog_nodes', targetId, after });
  };

  const handleAddChild = (parentId, code, price, siblingCount) => {
    addCatalogNode(parentId, code, price, siblingCount);
    logCatalogAction('Admin added a catalog code', null, { code, price });
  };
  const handleRemove = (id) => {
    removeCatalogNode(id);
    logCatalogAction('Admin removed a catalog code', id);
  };
  const handlePriceChange = (id, price) => {
    updateCatalogNodePrice(id, price);
    logCatalogAction('Admin updated a catalog price', id, { price });
  };
  const handleToggleHidden = (id, hidden) => {
    setCatalogNodeHidden(id, hidden);
    logCatalogAction(hidden ? 'Admin hid a catalog code' : 'Admin unhid a catalog code', id);
  };
  const handleMove = (id, direction) => {
    moveCatalogNode(id, direction);
    logCatalogAction('Admin reordered the catalog', id, { direction });
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
                onToggleHidden={handleToggleHidden}
                onMove={handleMove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
