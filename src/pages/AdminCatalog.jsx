import { useEffect, useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import { logAdminAction } from '../lib/adminApi';
import { stockZoneFor } from '../data/catalog';

const STOCK_ZONE_COLOR = { red: '#c0392b', orange: '#d98c00', normal: undefined };

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

// Admin-only fork of ProductionCatalog.jsx — same AppState handlers
// (addCatalogNode/removeCatalogNode/updateCatalogNodePrice/
// setCatalogNodeHidden/moveCatalogNode/reorderCatalogSiblings) and the
// same admin-audit-log calls, restyled to match the Admin Portal redesign
// plus drag-and-drop reordering and collapsible groups. Kept separate
// rather than sharing one component with /production/catalog because that
// route needs to keep Production's own (unredesigned, arrows-only) look —
// see AdminLayout.jsx's header comment.

// Custom collision detection: only ever considers droppable rows that
// share the dragged row's parentId, so a drag can never preview (or
// complete) a drop into a different sibling group/depth — same
// same-siblings-only constraint the ▲/▼ buttons already enforce.
function sameParentClosestCenter(args) {
  const activeParentId = args.active.data.current?.parentId ?? null;
  const filtered = args.droppableContainers.filter(
    (c) => (c.data.current?.parentId ?? null) === activeParentId,
  );
  return closestCenter({ ...args, droppableContainers: filtered });
}

// Walks the tree looking for the children array (or the root list, for
// parentId === null) that a given parentId owns — the sibling group a
// drag needs to reorder within. Distinct from AppState's
// findNodeAndSiblings (which searches by a node's own id); this searches
// by parent id instead, which is what handleDragEnd has on hand via each
// sortable item's `data.parentId`.
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

// Announces the actual product code being moved instead of dnd-kit's
// generic default text.
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

function CatalogRow({
  node, depth, parentId, canMoveUp, canMoveDown, onAddChild, onRemove, onPriceChange, onStockChange, onToggleHidden, onMove,
  collapsedIds, onToggleCollapsed, dragActive,
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
  const canReorder = canMoveUp || canMoveDown;
  const zone = stockZoneFor(node.stockQty, node.stockBaseline);

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: node.id,
    data: { parentId, code: node.code },
  });
  const rowStyle = {
    paddingLeft: 16 + depth * 32,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // A drag starting anywhere nearby can shift this row's vertical position
  // — closing an open inline form avoids the row heights jumping mid-drag.
  useEffect(() => {
    if (dragActive) setAddingChild(false);
  }, [dragActive]);

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
      <div
        ref={setNodeRef}
        style={rowStyle}
        className={`group flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-b border-outline-variant/50 hover:bg-surface-container-low transition-colors gap-4${depth > 0 ? ' bg-surface-bright/50' : ''}`}
      >
        <div className="flex-1 flex items-center gap-3">
          {hasChildren && (
            <button
              type="button"
              onClick={() => onToggleCollapsed(node.id)}
              aria-label={collapsed ? `Expand ${node.code}` : `Collapse ${node.code}`}
              className="text-outline hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">{collapsed ? 'chevron_right' : 'expand_more'}</span>
            </button>
          )}
          <span className={depth === 0 ? 'text-headline-sm text-primary uppercase' : 'text-body-md font-medium text-on-surface uppercase'}>
            {node.code}
          </span>
          {node.hidden && <span className="text-label-bold text-on-surface-variant uppercase">(hidden)</span>}
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
          <input
            className="w-20 px-3 py-1 border border-outline-variant rounded text-right text-body-md focus:ring-1 focus:ring-primary outline-none"
            type="number"
            step="0.01"
            value={priceDraft}
            onChange={(e) => setPriceDraft(e.target.value)}
            onBlur={commitPrice}
          />
          {!hasChildren && (
            <input
              className="w-20 px-3 py-1 border border-outline-variant rounded text-right text-body-md focus:ring-1 focus:ring-primary outline-none"
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
          <button
            type="button"
            {...attributes}
            {...listeners}
            disabled={!canReorder}
            aria-label={`Reorder ${node.code}`}
            className="touch-none cursor-grab active:cursor-grabbing text-outline hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm">drag_indicator</span>
          </button>
          <div className="flex flex-col gap-1">
            <button type="button" aria-label="Move up" disabled={!canMoveUp} onClick={() => onMove(node.id, 'up')} className="text-outline hover:text-primary disabled:opacity-30 disabled:hover:text-outline">
              <span className="material-symbols-outlined text-sm">arrow_drop_up</span>
            </button>
            <button type="button" aria-label="Move down" disabled={!canMoveDown} onClick={() => onMove(node.id, 'down')} className="text-outline hover:text-primary disabled:opacity-30 disabled:hover:text-outline">
              <span className="material-symbols-outlined text-sm">arrow_drop_down</span>
            </button>
          </div>
          <button type="button" onClick={() => setAddingChild((v) => !v)} className="text-secondary hover:text-primary text-label-bold font-semibold whitespace-nowrap">+ Variant</button>
          <button type="button" onClick={() => onToggleHidden(node.id, !node.hidden)} className="text-secondary hover:text-on-surface text-label-bold font-semibold">
            {node.hidden ? 'Unhide' : 'Hide'}
          </button>
          <button type="button" onClick={handleRemove} className="text-error hover:text-error/70 text-label-bold font-semibold">Remove</button>
        </div>
      </div>

      {addingChild && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 border-b border-outline-variant/50 bg-surface" style={{ paddingLeft: 16 + (depth + 1) * 32 }}>
          <input className="border border-outline-variant rounded-lg px-3 py-2 text-body-md outline-none focus:ring-2 focus:ring-primary" placeholder="Code (e.g. GOLD)" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
          <input className="w-24 border border-outline-variant rounded-lg px-3 py-2 text-body-md outline-none focus:ring-2 focus:ring-primary" type="number" step="0.01" placeholder="Price" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
          <button type="button" onClick={submitAddChild} className="bg-primary text-on-primary text-label-bold font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">Add</button>
          <button type="button" onClick={() => setAddingChild(false)} className="text-label-bold font-semibold text-on-surface hover:text-primary px-2">Cancel</button>
        </div>
      )}

      {hasChildren && !collapsed && (
        <SortableContext items={node.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {node.children.map((child, i) => (
            <CatalogRow
              key={child.id}
              node={child}
              depth={depth + 1}
              parentId={node.id}
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
              dragActive={dragActive}
            />
          ))}
        </SortableContext>
      )}
    </>
  );
}

export default function AdminCatalog() {
  const {
    state, addCatalogNode, removeCatalogNode, updateCatalogNodePrice, updateCatalogNodeStock, setCatalogNodeHidden, moveCatalogNode, reorderCatalogSiblings,
  } = useAppState();
  const [newTopCode, setNewTopCode] = useState('');
  const [newTopPrice, setNewTopPrice] = useState('');
  // Seeded lazily (once, on first non-empty load) rather than derived fresh
  // every render — that would fight any group Admin manually expanded back
  // closed on the very next catalog refresh.
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

  const logCatalogAction = (action, targetId, after) => {
    logAdminAction({ action, targetTable: 'plak_catalog_nodes', targetId, after });
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
  const handleStockChange = (id, stockQty) => {
    updateCatalogNodeStock(id, stockQty);
    logCatalogAction('Admin updated a catalog stock qty', id, { stockQty });
  };
  const handleToggleHidden = (id, hidden) => {
    setCatalogNodeHidden(id, hidden);
    logCatalogAction(hidden ? 'Admin hid a catalog code' : 'Admin unhid a catalog code', id);
  };
  const handleMove = (id, direction) => {
    moveCatalogNode(id, direction);
    logCatalogAction('Admin reordered the catalog', id, { direction });
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
    logCatalogAction('Admin reordered the catalog', active.id, { via: 'drag' });
  };

  const addTopLevel = () => {
    if (!newTopCode.trim()) return;
    handleAddChild(null, newTopCode.trim(), Number(newTopPrice) || 0, state.plakCatalog.length);
    setNewTopCode('');
    setNewTopPrice('');
  };

  return (
    <AdminLayout
      title="Jenis Plak Catalog"
      subtitle="Add, remove, reprice, or hide a code (or just one of its variants) — changes apply for every teacher immediately. Groups open collapsed to just their top-level code; use the chevron to expand one. Set Stock Qty on a code to start tracking its inventory — it turns orange under 25% and red under 15% of what you last entered, orders are automatically capped once stock runs low, and the code auto-hides at 0 (leave it blank to skip stock tracking). Drag the handle icon (or use the ▲▼ buttons) to reorder within a group."
    >
      <div className="bg-surface-container rounded-lg p-4 border border-outline-variant/50 flex flex-col sm:flex-row gap-4 items-center shadow-sm mb-6">
        <input
          className="flex-1 w-full px-4 py-2 border border-outline-variant rounded-md text-body-md bg-surface-container-lowest text-on-surface focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
          placeholder="New top-level code"
          value={newTopCode}
          onChange={(e) => setNewTopCode(e.target.value)}
        />
        <input
          className="w-full sm:w-48 px-4 py-2 border border-outline-variant rounded-md text-body-md bg-surface-container-lowest text-on-surface focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
          placeholder="Price"
          type="number"
          value={newTopPrice}
          onChange={(e) => setNewTopPrice(e.target.value)}
        />
        <button type="button" onClick={addTopLevel} className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-on-primary px-6 py-2 rounded-md text-label-bold font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-2">
          <span className="material-symbols-outlined text-sm">add</span>
          Add Code
        </button>
      </div>

      {!state.plakCatalogLoaded ? (
        <p className="text-body-md text-on-surface-variant">Loading catalog…</p>
      ) : state.plakCatalog.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No codes yet — add one above.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/30 overflow-hidden">
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
              {state.plakCatalog.map((node, i) => (
                <CatalogRow
                  key={node.id}
                  node={node}
                  depth={0}
                  parentId={null}
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
                  dragActive={draggingId !== null}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </AdminLayout>
  );
}
