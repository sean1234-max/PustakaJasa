import { useEffect, useState } from 'react';
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

// A parent code has no stock of its own — only its leaf variants do — but
// Production still wants to see at a glance how much is left across all of
// them without expanding the group. Sums every tracked descendant leaf
// (any depth), returning null (rendered as "—") when none of them track
// stock at all, same "not tracked" meaning a single leaf's own null does.
function sumDescendantStock(node) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node.stockQty == null ? null : node.stockQty;
  }
  let total = 0;
  let anyTracked = false;
  node.children.forEach((child) => {
    const childTotal = sumDescendantStock(child);
    if (childTotal != null) { total += childTotal; anyTracked = true; }
  });
  return anyTracked ? total : null;
}

// One row per catalog node, recursing into its children. Each row can add
// a variant beneath it, edit its own price/stock, hide/unhide it, remove it
// (and everything beneath it), or drag it up/down among its own siblings —
// that's what controls which variant a teacher sees listed first. Groups
// with children start collapsed (see ProductionCatalog's collapsedIds) so
// opening the catalog shows only top-level codes, not every nested variant
// at once.
function CatalogRow({
  node, depth, parentId, canReorder, onAddChild, onRemove, onPriceChange, onStockChange, onToggleHidden,
  collapsedIds, onToggleCollapsed, dragActive,
}) {
  const [addingChild, setAddingChild] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [priceDraft, setPriceDraft] = useState(String(node.price ?? 0));
  const [stockDraft, setStockDraft] = useState(node.stockQty == null ? '' : String(node.stockQty));

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

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const collapsed = collapsedIds.has(node.id);
  const zone = stockZoneFor(node.stockQty, node.stockBaseline);
  const descendantStock = hasChildren ? sumDescendantStock(node) : null;

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
      <div ref={setNodeRef} className="catalog-admin-row" style={rowStyle}>
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
        {hasChildren && (
          <div className="input input-readonly catalog-admin-price" title="Total stock across all variants beneath this code">
            {descendantStock != null ? descendantStock : '—'}
          </div>
        )}
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
              canReorder={node.children.length > 1}
              onAddChild={onAddChild}
              onRemove={onRemove}
              onPriceChange={onPriceChange}
              onStockChange={onStockChange}
              onToggleHidden={onToggleHidden}
              collapsedIds={collapsedIds}
              onToggleCollapsed={onToggleCollapsed}
              dragActive={dragActive}
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

export default function ProductionCatalog() {
  const {
    state, addCatalogNode, removeCatalogNode, updateCatalogNodePrice, updateCatalogNodeStock, setCatalogNodeHidden, reorderCatalogSiblings,
  } = useAppState();
  const [newTopCode, setNewTopCode] = useState('');
  const [newTopPrice, setNewTopPrice] = useState('');
  // Seeded lazily (once, on first non-empty load) rather than derived fresh
  // every render — that would fight any group a Production user manually
  // expanded back closed on the very next catalog refresh.
  const [collapsedIds, setCollapsedIds] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  if (collapsedIds === null && state.plakCatalog.length > 0) {
    setCollapsedIds(collectParentIds(state.plakCatalog, new Set()));
  }

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
  const handlePriceChange = (id, price) => {
    updateCatalogNodePrice(id, price);
  };
  const handleStockChange = (id, stockQty) => {
    updateCatalogNodeStock(id, stockQty);
  };
  const handleToggleHidden = (id, hidden) => {
    setCatalogNodeHidden(id, hidden);
  };
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
            {/* Price and Stock Qty are two identical-looking plain number
                boxes side by side once filled in (the "Stock" placeholder
                only shows while empty) — this header labels the columns so
                it's obvious at a glance which is which. */}
            <div className="catalog-admin-row catalog-admin-header-row">
              <span style={{ display: 'inline-block', width: 28 }} />
              <span className="catalog-admin-code">Code</span>
              <span className="catalog-admin-price">Price (RM)</span>
              <span className="catalog-admin-price">Stock Qty</span>
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
                    onAddChild={(parentId, code, price) => handleAddChild(parentId, code, price, 0)}
                    onRemove={handleRemove}
                    onPriceChange={handlePriceChange}
                    onStockChange={handleStockChange}
                    onToggleHidden={handleToggleHidden}
                    collapsedIds={collapsedIds || new Set()}
                    onToggleCollapsed={toggleCollapsed}
                    dragActive={draggingId !== null}
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
