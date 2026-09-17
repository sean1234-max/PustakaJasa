import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { stockZoneFor } from '../data/catalog';

const STOCK_ZONE_COLOR = { red: '#c0392b', orange: '#d98c00', normal: undefined };

// Same constraint the old ▲/▼ buttons enforced: a drag can only ever
// preview/complete a drop among rows sharing the dragged row's own
// parentId — see AdminCatalog.jsx, which this drag-and-drop is ported from.
function sameParentClosestCenter(args) {
  const activeParentId = args.active.data.current?.parentId ?? null;
  const filtered = args.droppableContainers.filter(
    (c) => (c.data.current?.parentId ?? null) === activeParentId,
  );
  return closestCenter({ ...args, droppableContainers: filtered });
}

// Walks the tree looking for the children array (or the root list, for
// parentId === null) that a given parentId owns — the sibling group a drag
// needs to reorder within.
function findSiblingsByParentId(nodes, parentId) {
  if (parentId === null) return nodes;
  for (const node of nodes) {
    if (node.id === parentId) return node.children || [];
    if (node.children) {
      const found = findSiblingsByParentId(node.children, parentId);
      if (found) return found;
    }
  }
  return null;
}

const catalogAnnouncements = {
  onDragStart({ active }) {
    return `Picked up ${active.data.current?.code ?? 'item'}.`;
  },
  onDragOver({ active, over }) {
    if (!over) return 'Not over a droppable area.';
    return `${active.data.current?.code ?? 'Item'} is over ${over.data.current?.code ?? 'another item'}.`;
  },
  onDragEnd({ active, over }) {
    return over ? `${active.data.current?.code ?? 'Item'} was moved.` : `${active.data.current?.code ?? 'Item'} was dropped.`;
  },
  onDragCancel({ active }) {
    return `Reordering ${active.data.current?.code ?? 'item'} was cancelled.`;
  },
};

// One row per catalog node, recursing into its children. Each row can add
// a variant beneath it, edit its own price/stock, hide/unhide it, remove it
// (and everything beneath it), or drag it up/down among its own siblings —
// that's what controls which variant a teacher sees listed first. Groups
// with children start collapsed (see ProductionCatalog's collapsedIds) so
// opening the catalog shows only top-level codes, not every nested variant
// at once.
function CatalogRow({
  node, depth, parentId, path, canReorder, onAddChild, onRemove, onRename, ordersUsingPath, onPriceChange, onStockChange, onToggleHidden,
  onLinkStockGroup, onUnlinkStockGroup, existingGroupKeys,
  collapsedIds, onToggleCollapsed, dragActive, highlightedId,
}) {
  const fullPath = [...path, node.code].join(' / ');
  const [addingChild, setAddingChild] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [codeDraft, setCodeDraft] = useState(node.code);
  const [priceDraft, setPriceDraft] = useState(String(node.price ?? 0));
  const [stockDraft, setStockDraft] = useState(node.stockQty == null ? '' : String(node.stockQty));
  const [groupDraft, setGroupDraft] = useState(node.stockGroupKey || '');

  useEffect(() => { setCodeDraft(node.code); }, [node.code]);

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: node.id,
    data: { parentId, code: node.code },
  });
  const rowStyle = {
    paddingLeft: depth * 20,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // A drag starting anywhere nearby can shift this row's vertical position
  // — closing an open inline form avoids the row heights jumping mid-drag.
  useEffect(() => {
    if (dragActive) setAddingChild(false);
  }, [dragActive]);

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

  useEffect(() => { setGroupDraft(node.stockGroupKey || ''); }, [node.stockGroupKey]);

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const collapsed = collapsedIds.has(node.id);
  const zone = stockZoneFor(node.stockQty, node.stockBaseline);

  const commitCode = () => {
    const next = codeDraft.trim();
    if (!next || next === node.code) { setCodeDraft(node.code); return; }
    // Renaming only changes what NEW orders see. An order already placed
    // stored this code as the joined path text and nothing rewrites it —
    // so its Jenis Plak stops resolving (CSV export blocks on it, stock
    // won't restore). Warn hard when there are such orders.
    const affected = ordersUsingPath(fullPath);
    const msg = affected > 0
      ? `${affected} order(s) already use "${node.code}". Renaming it will break their Jenis Plak — the CSV export won't run for them until you rename it back or fix each order by hand.\n\nRename anyway?`
      : `Rename "${node.code}" to "${next}"?\n\nOrders placed later use "${next}"; any placed before keep the old name.`;
    if (window.confirm(msg)) {
      onRename(node.id, next);
    } else {
      setCodeDraft(node.code);
    }
  };

  const commitPrice = () => {
    const val = Number(priceDraft);
    if (!Number.isNaN(val) && val !== node.price) onPriceChange(node.id, val);
    else setPriceDraft(String(node.price ?? 0));
  };

  const commitStock = () => {
    if (stockDraft.trim() === '') {
      if (node.stockQty != null) onStockChange(node.id, null, node.stockGroupKey);
      return;
    }
    const val = Math.round(Number(stockDraft));
    if (!Number.isNaN(val) && val >= 0 && val !== node.stockQty) onStockChange(node.id, val, node.stockGroupKey);
    else setStockDraft(node.stockQty == null ? '' : String(node.stockQty));
  };

  // Typing a brand new name asks for a starting number right away (linking
  // never sums/averages whatever independent numbers this node and its
  // new group-mates had before — nothing sensible to derive it from).
  // Typing an existing name just joins it, no number needed. Clearing the
  // field unlinks — confirmed first since it resets this node's own stock
  // back to "not tracked yet".
  const commitStockGroup = async () => {
    const next = groupDraft.trim();
    const current = node.stockGroupKey || '';
    if (next === current) return;
    if (!next) {
      if (window.confirm(`Unlink "${node.code}" from Stock Group "${current}"? It goes back to independent tracking, starting from "not tracked" — you'll need to type a fresh Stock Qty.`)) {
        onUnlinkStockGroup(node.id);
      } else {
        setGroupDraft(current);
      }
      return;
    }
    const isNewGroup = !existingGroupKeys.has(next);
    let initialStockQty;
    if (isNewGroup) {
      const input = window.prompt(`"${next}" is a new Stock Group. Enter its starting Stock Qty:`);
      if (input === null) { setGroupDraft(current); return; }
      initialStockQty = Math.round(Number(input));
      if (Number.isNaN(initialStockQty) || initialStockQty < 0) {
        window.alert('Enter a valid non-negative number.');
        setGroupDraft(current);
        return;
      }
    }
    try {
      await onLinkStockGroup(node.id, next, initialStockQty);
    } catch (err) {
      window.alert(err.message || 'Failed to link Stock Group.');
      setGroupDraft(current);
    }
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
      <div
        ref={setNodeRef}
        id={`catalog-node-${node.id}`}
        className={`catalog-admin-row${node.id === highlightedId ? ' catalog-row-flash' : ''}`}
        style={rowStyle}
      >
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
        <input
          className={node.hidden ? 'input catalog-admin-code catalog-admin-code-hidden' : 'input catalog-admin-code'}
          value={codeDraft}
          aria-label={`Rename ${node.code}`}
          onChange={(e) => setCodeDraft(e.target.value)}
          onBlur={commitCode}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        />
        <input
          className="input catalog-admin-price"
          type="number"
          step="0.01"
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onBlur={commitPrice}
        />
        <input
          className="input catalog-admin-price"
          type="number"
          step="1"
          min="0"
          placeholder="Stock"
          title="Stock Qty — independent of any child variants beneath this code. Setting a new number resets the 15%/25% warning thresholds against it."
          value={stockDraft}
          style={zone !== 'normal' ? { color: STOCK_ZONE_COLOR[zone], fontWeight: 700 } : undefined}
          onChange={(e) => setStockDraft(e.target.value)}
          onBlur={commitStock}
        />
        <div className="catalog-admin-group-cell">
          <input
            className="input catalog-admin-group"
            placeholder="Stock Group"
            title="Type the same name on every code that should share one stock count with this one. Leave blank to track this code's stock independently."
            list="plak-stock-group-keys"
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            onBlur={commitStockGroup}
          />
          {node.stockGroupKey && node.stockGroupSize > 1 && (
            <div className="hint-text" style={{ fontSize: 11, marginTop: 2 }}>🔗 shared with {node.stockGroupSize - 1} other code(s)</div>
          )}
        </div>
        <div className="catalog-admin-actions">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="btn btn-ghost btn-icon"
            disabled={!canReorder}
            aria-label={`Reorder ${node.code}`}
            style={{ cursor: canReorder ? 'grab' : 'not-allowed', touchAction: 'none' }}
          >
            ⠿
          </button>
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

      {hasChildren && !collapsed && (
        <SortableContext items={node.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {node.children.map((child) => (
            <CatalogRow
              key={child.id}
              node={child}
              depth={depth + 1}
              parentId={node.id}
              path={[...path, node.code]}
              canReorder={node.children.length > 1}
              onAddChild={onAddChild}
              onRemove={onRemove}
              onRename={onRename}
              ordersUsingPath={ordersUsingPath}
              onPriceChange={onPriceChange}
              onStockChange={onStockChange}
              onToggleHidden={onToggleHidden}
              onLinkStockGroup={onLinkStockGroup}
              onUnlinkStockGroup={onUnlinkStockGroup}
              existingGroupKeys={existingGroupKeys}
              collapsedIds={collapsedIds}
              onToggleCollapsed={onToggleCollapsed}
              dragActive={dragActive}
              highlightedId={highlightedId}
            />
          ))}
        </SortableContext>
      )}
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

// Every stockGroupKey used anywhere in the tree, at any depth.
function collectStockGroupKeys(nodes, out) {
  (nodes || []).forEach((node) => {
    if (node.stockGroupKey) out.add(node.stockGroupKey);
    if (Array.isArray(node.children)) collectStockGroupKeys(node.children, out);
  });
  return out;
}

// Every ancestor id (not including targetId itself) on the path down to
// targetId — used to jump-to-and-flash a code from a Dashboard Low Stock
// alert: those ancestor groups need expanding (removed from collapsedIds)
// before the target row exists in the DOM to scroll to.
function findAncestorIds(nodes, targetId, trail) {
  for (const node of (nodes || [])) {
    if (node.id === targetId) return trail;
    if (Array.isArray(node.children)) {
      const found = findAncestorIds(node.children, targetId, [...trail, node.id]);
      if (found) return found;
    }
  }
  return null;
}

export default function ProductionCatalog() {
  const {
    state, addCatalogNode, removeCatalogNode, updateCatalogNodePrice, renameCatalogNode, updateCatalogNodeStock, setCatalogNodeHidden, reorderCatalogSiblings,
    linkCatalogNodeStockGroup, unlinkCatalogNodeStockGroup,
  } = useAppState();
  const [newTopCode, setNewTopCode] = useState('');
  const [newTopPrice, setNewTopPrice] = useState('');
  // Seeded lazily (once, on first non-empty load) rather than derived fresh
  // every render — that would fight any group a Production user manually
  // expanded back closed on the very next catalog refresh.
  const [collapsedIds, setCollapsedIds] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  if (collapsedIds === null && state.plakCatalog.length > 0) {
    setCollapsedIds(collectParentIds(state.plakCatalog, new Set()));
  }

  // Arrived via a Dashboard Low Stock alert's "jump to this code" link —
  // expand every ancestor group on its path (it may be several levels deep
  // inside a collapsed group), scroll it into view, and flash it 3 times so
  // it's unmistakable among everything else on the page. Consumed once: the
  // nav state is cleared immediately so a later revisit (back button, or
  // just staying on this page) doesn't replay it.
  useEffect(() => {
    const targetId = location.state?.highlightNodeId;
    if (!targetId || collapsedIds === null) return;
    const ancestorIds = findAncestorIds(state.plakCatalog, targetId, []);
    if (ancestorIds === null) return;
    if (ancestorIds.length > 0) {
      setCollapsedIds((prev) => {
        const next = new Set(prev || []);
        ancestorIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    navigate(location.pathname, { replace: true, state: null });
    // One extra frame past the collapse-state update above so the target
    // row actually exists in the DOM before scrollIntoView runs.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`catalog-node-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(targetId);
        setTimeout(() => setHighlightedId(null), 1800);
      });
    });
    // Only ever wants to run once per navigation-with-state; collapsedIds
    // and state.plakCatalog change on every unrelated catalog edit too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, collapsedIds !== null]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleAddChild = (parentId, code, price, siblingCount) => {
    addCatalogNode(parentId, code, price, siblingCount);
  };
  const handleRemove = (id) => {
    removeCatalogNode(id);
  };
  const handleRename = (id, code) => {
    renameCatalogNode(id, code);
  };
  // How many orders' items still reference this exact Jenis Plak path (or a
  // path under it) — Production/Admin see every order here, so this count is
  // complete. Used to warn before a rename that would orphan them.
  const ordersUsingPath = (fullPath) => (state.orders || []).filter((o) => {
    const hit = (it) => it && (it.jenisPlak === fullPath || String(it.jenisPlak || '').startsWith(`${fullPath} / `));
    return (o.items || []).some(hit) || (o.pendingAddonItems || []).some(hit);
  }).length;
  const handlePriceChange = (id, price) => {
    updateCatalogNodePrice(id, price);
  };
  const handleStockChange = (id, stockQty, stockGroupKey) => {
    updateCatalogNodeStock(id, stockQty, stockGroupKey);
  };
  const handleToggleHidden = (id, hidden) => {
    setCatalogNodeHidden(id, hidden);
  };
  // Every Stock Group name already in use anywhere in the catalog — lets a
  // row tell "join this existing group" apart from "create a brand new one"
  // (which needs a starting number) the moment Production blurs the field.
  const existingGroupKeys = new Set();
  collectStockGroupKeys(state.plakCatalog, existingGroupKeys);
  const toggleCollapsed = (id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDragStart = (event) => {
    setDraggingId(event.active.id);
  };

  const handleDragEnd = (event) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const parentId = active.data.current?.parentId ?? null;
    const overParentId = over.data.current?.parentId ?? null;
    if (parentId !== overParentId) return;
    const siblings = findSiblingsByParentId(state.plakCatalog, parentId);
    if (!siblings) return;
    const oldIndex = siblings.findIndex((n) => n.id === active.id);
    const newIndex = siblings.findIndex((n) => n.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrderIds = arrayMove(siblings, oldIndex, newIndex).map((n) => n.id);
    reorderCatalogSiblings(newOrderIds);
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
          Set Stock Qty on a code to start tracking its inventory — it turns orange under 25% and red under 15% of what you last entered, and orders are automatically capped (and the code auto-hidden at 0) once stock runs low. Leave it blank to skip stock tracking for a code. A code with variants beneath it can track its own stock too — ordering any variant checks and deducts every tracked level along the way (e.g. GOLD's own count AND the specific base variant's, if both track stock).
          Type the same Stock Group name on several codes to make them share one stock count instead of tracking separately — e.g. the same physical base sold under different colors or designs. A first-time name asks for a starting number; an existing name just joins it.
        </p>

        <div className="catalog-admin-row catalog-admin-add-row" style={{ marginBottom: 'var(--space-4)' }}>
          <input className="input" placeholder="New top-level code" value={newTopCode} onChange={(e) => setNewTopCode(e.target.value)} />
          <input className="input catalog-admin-price" type="number" step="0.01" placeholder="Price" value={newTopPrice} onChange={(e) => setNewTopPrice(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={addTopLevel}>+ Add Code</button>
        </div>

        {/* Autocomplete only — typing a name NOT in this list is exactly how
            a brand new Stock Group gets created, so this must never
            restrict input, just suggest. */}
        <datalist id="plak-stock-group-keys">
          {[...existingGroupKeys].map((key) => <option key={key} value={key} />)}
        </datalist>

        {!state.plakCatalogLoaded ? (
          <p className="hint-text">Loading catalog…</p>
        ) : state.plakCatalog.length === 0 ? (
          <p className="hint-text">No codes yet — add one above.</p>
        ) : (
          <div className="catalog-admin-list">
            {/* Price and Stock Qty are two identical-looking plain number
                boxes side by side once filled in (the "Stock" placeholder
                only shows while empty) — this header labels the columns so
                it's obvious at a glance which is which. The invisible
                actions block mirrors CatalogRow's real one below so its
                fixed width is subtracted from the flex-1 code column the
                same way here as in every row — otherwise Code has nothing
                to compete with, grows wider than the real rows, and pushes
                the Price/Stock labels off to the right of their columns. */}
            <div className="catalog-admin-row catalog-admin-header-row">
              <span style={{ display: 'inline-block', width: 28 }} />
              <span className="catalog-admin-code">Code</span>
              <span className="catalog-admin-price">Price (RM)</span>
              <span className="catalog-admin-price">Stock Qty</span>
              <span className="catalog-admin-group-cell">Stock Group</span>
              <div className="catalog-admin-actions" style={{ visibility: 'hidden' }} aria-hidden="true">
                <button type="button" className="btn btn-ghost btn-icon" tabIndex={-1}>⠿</button>
                <button type="button" className="btn btn-ghost" tabIndex={-1}>+ Variant</button>
                <button type="button" className="btn btn-ghost" tabIndex={-1}>Unhide</button>
                <button type="button" className="btn btn-ghost" tabIndex={-1}>Remove</button>
              </div>
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={sameParentClosestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDraggingId(null)}
              accessibility={{ announcements: catalogAnnouncements }}
            >
              <SortableContext items={state.plakCatalog.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                {state.plakCatalog.map((node) => (
                  <CatalogRow
                    key={node.id}
                    node={node}
                    depth={0}
                    parentId={null}
                    canReorder={state.plakCatalog.length > 1}
                    path={[]}
                    onAddChild={(parentId, code, price) => handleAddChild(parentId, code, price, 0)}
                    onRemove={handleRemove}
                    onRename={handleRename}
                    ordersUsingPath={ordersUsingPath}
                    onPriceChange={handlePriceChange}
                    onStockChange={handleStockChange}
                    onToggleHidden={handleToggleHidden}
                    onLinkStockGroup={linkCatalogNodeStockGroup}
                    onUnlinkStockGroup={unlinkCatalogNodeStockGroup}
                    existingGroupKeys={existingGroupKeys}
                    collapsedIds={collapsedIds || new Set()}
                    onToggleCollapsed={toggleCollapsed}
                    dragActive={draggingId !== null}
                    highlightedId={highlightedId}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>
    </div>
  );
}
