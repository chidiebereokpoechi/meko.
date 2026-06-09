import { useState } from "react";
import type { BoardConnection } from "../../lib/board.ts";
import type { Element } from "../../types.ts";
import { startPointerDrag } from "./drag.ts";

type Pt = { x: number; y: number };

// Columns: cards can be nested inside a column (children are flat in the element map; the column
// references them by id and renders them inline). This hook owns the live drop-target highlight and
// the detached drag ghost, plus every column op — reparent, extract, drag a child, group a
// selection. Element selection + z + connection pruning live in Canvas and are passed in.
export function useColumns(deps: {
  connRef: React.RefObject<BoardConnection | null>;
  toWorld: (clientX: number, clientY: number) => Pt;
  selectedIds: string[];
  childToCol: Map<string, string>;
  readOnly: boolean;
  nextZ: () => number;
  pruneConnections: (ids: Set<string>) => void;
  selectId: (id: string) => void;
  selectNew: (id: string) => void;
  setDraggingId: (id: string | null) => void;
}) {
  const {
    connRef,
    toWorld,
    selectedIds,
    childToCol,
    readOnly,
    nextZ,
    pruneConnections,
    selectId,
    selectNew,
    setDraggingId,
  } = deps;

  // Live column drop target (highlight + insertion index) while dragging a card.
  const [colDrop, setColDrop] = useState<{
    colId: string;
    index: number;
  } | null>(null);
  // Floating preview of a column child detached under the cursor while dragging it out.
  const [childDragGhost, setChildDragGhost] = useState<{
    id: string;
    cx: number;
    cy: number;
  } | null>(null);

  // Column under a screen point + the child index a drop there would land at (via the live DOM).
  const columnDropAt = (
    clientX: number,
    clientY: number,
    excludeId?: string,
  ): { colId: string; index: number } | null => {
    for (const node of Array.from(
      document.querySelectorAll<HTMLElement>("[data-column-id]"),
    )) {
      const colId = node.getAttribute("data-column-id")!;
      if (colId === excludeId) continue;
      const r = node.getBoundingClientRect();
      if (
        clientX < r.left ||
        clientX > r.right ||
        clientY < r.top ||
        clientY > r.bottom
      )
        continue;
      const kids = Array.from(
        node.querySelectorAll<HTMLElement>("[data-col-child]"),
      );
      let index = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const kr = kids[i]!.getBoundingClientRect();
        if (clientY < kr.top + kr.height / 2) {
          index = i;
          break;
        }
      }
      return { colId, index };
    }
    return null;
  };

  // --- Column reparenting (one transaction so it's a single undo step) ---
  const moveChildToColumn = (childId: string, colId: string, index: number) => {
    const c = connRef.current;
    if (!c) return;
    c.doc.transact(() => {
      for (const e of c.elements.values()) {
        if (
          e.type === "column" &&
          e.children.includes(childId) &&
          e.id !== colId
        ) {
          c.elements.set(e.id, {
            ...e,
            children: e.children.filter((id) => id !== childId),
          });
        }
      }
      const col = c.elements.get(colId);
      if (col?.type !== "column") return;
      const next = col.children.filter((id) => id !== childId);
      next.splice(Math.max(0, Math.min(index, next.length)), 0, childId);
      c.elements.set(colId, { ...col, children: next });
      // A child lives inside the column now (its x/y is stale), so drop any arrows/lines that
      // pointed at it — otherwise they'd dangle to its old position.
      pruneConnections(new Set([childId]));
      for (const ln of Array.from(c.lines.values())) {
        if (ln.a.elementId === childId || ln.b.elementId === childId)
          c.lines.delete(ln.id);
      }
    });
  };
  // Pop a child out of its column to a free position on the canvas.
  const extractChild = (childId: string, x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    c.doc.transact(() => {
      for (const e of c.elements.values()) {
        if (e.type === "column" && e.children.includes(childId)) {
          c.elements.set(e.id, {
            ...e,
            children: e.children.filter((id) => id !== childId),
          });
        }
      }
      const child = c.elements.get(childId);
      if (child) c.elements.set(childId, { ...child, x, y });
    });
  };

  // Drag a card that lives inside a column: reorder within, move to another column, or pop it out
  // onto the canvas. A press without movement just selects it.
  const startColumnChildDrag = (childId: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    let moved = false;
    const clear = () => {
      setDraggingId(null);
      setColDrop(null);
      setChildDragGhost(null);
    };
    startPointerDrag({
      onMove: (ev) => {
        // Only treat it as a drag past a deliberate threshold — a precise click (e.g. an embed's
        // play button) jitters a few px and must still count as a click, not a drag.
        if (
          !moved &&
          Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) <
            8
        )
          return;
        moved = true;
        setDraggingId(childId);
        setColDrop(columnDropAt(ev.clientX, ev.clientY));
        setChildDragGhost({ id: childId, cx: ev.clientX, cy: ev.clientY });
      },
      onUp: (ev) => {
        clear();
        if (!moved) {
          selectId(childId);
          return;
        }
        const targets =
          selectedIds.includes(childId) && selectedIds.length > 1
            ? selectedIds.filter((tid) => childToCol.has(tid))
            : [childId];
        const drop = columnDropAt(ev.clientX, ev.clientY);
        if (drop)
          targets.forEach((t, i) =>
            moveChildToColumn(t, drop.colId, drop.index + i),
          );
        else {
          const w = toWorld(ev.clientX, ev.clientY);
          targets.forEach((t, i) => extractChild(t, w.x, w.y + i * 24));
        }
      },
      onCancel: clear, // Esc: leave the child where it was
    });
  };

  // Wrap the selected (non-column) elements into a new column at their top-left.
  const groupIntoColumn = (ids: string[]) => {
    const c = connRef.current;
    if (!c) return;
    const els = ids
      .map((id) => c.elements.get(id))
      .filter((e): e is Element => !!e && e.type !== "column");
    if (!els.length) return;
    const minX = Math.min(...els.map((e) => e.x));
    const minY = Math.min(...els.map((e) => e.y));
    const id = crypto.randomUUID();
    c.elements.set(id, {
      id,
      type: "column",
      x: minX,
      y: minY,
      w: 280,
      h: 120,
      title: "",
      children: els.map((e) => e.id),
      z: nextZ(),
      style: { fill: "#ffffff" },
    });
    selectNew(id);
  };

  return {
    colDrop,
    setColDrop,
    childDragGhost,
    columnDropAt,
    moveChildToColumn,
    startColumnChildDrag,
    groupIntoColumn,
  };
}
