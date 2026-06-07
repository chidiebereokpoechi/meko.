import { useCallback, useEffect, useRef, useState } from "react";
import { BoardConnection, type ConnStatus, type Peer } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import { type Unfurl, unfurlLink } from "../lib/links.ts";
import { api } from "../lib/api.ts";
import {
  embedDefaultSize,
  embedHeightFor,
  embeddableUrl,
  extractIframeSrc,
} from "../lib/embed.ts";
import type { Board, Connection, Element, LineShape } from "../types.ts";
import { Badge, ContextMenu, Icon, type MenuItem, toast } from "./kit/index.ts";
import { type Tool } from "./layout/ToolRail.tsx";
import { SelectionRail } from "./canvas/SelectionRail.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { NameModal } from "./NameModal.tsx";
import { type ActiveEditor } from "./EditableNote.tsx";
import {
  EMBED_CHOICE_KEY,
  GRID_DOT_COLOR,
  URL_CHOICE_KEY,
  WORLD_H,
  WORLD_W,
} from "./canvas/constants.ts";
import {
  escapeText,
  htmlVisibleText,
  isImageUrl,
  loadImageSize,
  parseClipboardHtmlAll,
  siteName,
} from "./canvas/url.ts";
import {
  ConnectionLines,
  ConnectionOverlay,
  LineLayer,
  LineOverlay,
  PeerCursor,
} from "./canvas/render.tsx";
import { EmbedChoiceModal, UrlChoiceModal } from "./canvas/ChoiceModals.tsx";
import { ElementCard } from "./canvas/ElementCard.tsx";
import { useViewport } from "./canvas/useViewport.ts";
import { useEdges } from "./canvas/useEdges.ts";
import { TOOL_SPECS } from "./canvas/tools.ts";

export interface BoardControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  exportPng: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  zoomToFit: () => void;
  toggleGrid: () => void;
  gridOn: boolean;
  zoomPct: number;
}

export function Canvas({
  boardId,
  workspaceId,
  onControls,
  onOpenBoard,
}: {
  boardId: string;
  workspaceId: string;
  onControls: (c: BoardControls | null) => void;
  onOpenBoard: (boardId: string) => void;
}) {
  const connRef = useRef<BoardConnection | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null); // the transformed "world"
  const viewportRef = useRef<HTMLDivElement>(null); // the clipping viewport
  const deleteRef = useRef<HTMLDivElement>(null);
  const dropCoords = useRef<{ x: number; y: number } | null>(null);
  // When set, the next image/link/embed/board dialog fills this placeholder instead of creating new.
  const fillRef = useRef<{
    id: string;
    kind: "image" | "link" | "embed" | "board";
  } | null>(null);
  // Internal element clipboard (copy/cut within meko + paste-styles).
  const clipboardRef = useRef<Element[]>([]);
  const editorRef = useRef<ActiveEditor | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [, setTick] = useState(0);
  // Pan/zoom viewport state + helpers (toWorld, clamping, wheel/space) live in useViewport.
  const {
    view,
    panRef,
    spaceRef,
    toWorld,
    viewportCentre,
    setViewClamped,
    setZoom,
    resetView,
    zoomToFit,
  } = useViewport(viewportRef, surfaceRef);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overDelete, setOverDelete] = useState(false);
  const [linkModal, setLinkModal] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [boardModal, setBoardModal] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [embedModal, setEmbedModal] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  // Marquee selection rectangle in screen coords while dragging empty canvas.
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    additive: boolean;
  } | null>(null);
  const [captionEditing, setCaptionEditing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [showComments, setShowComments] = useState(false);
  const showCommentsRef = useRef(false);
  const [commentSignal, setCommentSignal] = useState(0);
  const [unreadComments, setUnreadComments] = useState(false);
  const [urlChoice, setUrlChoice] = useState<{
    u: Unfurl;
    url: string;
    at: { x: number; y: number };
  } | null>(null);
  const [embedChoice, setEmbedChoice] = useState<{
    url: string;
    embed: string;
    at: { x: number; y: number };
  } | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Read-only until the server's hello confirms edit access — viewers never mutate locally.
  const [readOnly, setReadOnly] = useState(true);
  // Measured rendered heights for auto-height cards, keyed by element id (for connection geometry).
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const reportHeight = useCallback((id: string, h: number) => {
    setCardHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
  }, []);
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
  // Right-click context menu: screen position + the element ids it acts on.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    ids: string[];
  } | null>(null);

  useEffect(() => {
    const c = new BoardConnection(boardId);
    connRef.current = c;
    c.onStatus = setStatus;
    c.onPresence = setPeers;
    c.onComment = () => {
      setCommentSignal((s) => s + 1);
      if (!showCommentsRef.current) setUnreadComments(true);
    };
    c.onAccess = (canEdit) => setReadOnly(!canEdit);
    const bump = () => setTick((t) => t + 1);
    c.elements.observe(bump);
    c.connections.observe(bump);
    c.lines.observe(bump);

    // Mirror undo/redo availability into state; the controls publisher (below) builds the full
    // BoardControls object whenever undo state or the view changes.
    const mgr = c.undoMgr;
    const sync = () => {
      setCanUndo(mgr.canUndo());
      setCanRedo(mgr.canRedo());
    };
    mgr.on("stack-item-added", sync);
    mgr.on("stack-item-popped", sync);
    sync();

    void c.connect();
    return () => {
      mgr.off("stack-item-added", sync);
      mgr.off("stack-item-popped", sync);
      c.elements.unobserve(bump);
      c.connections.unobserve(bump);
      c.lines.unobserve(bump);
      c.destroy();
      connRef.current = null;
      onControls(null);
    };
  }, [boardId]);

  const elements: Element[] = connRef.current
    ? Array.from(connRef.current.elements.values())
    : [];
  const elementsById = new Map(elements.map((e) => [e.id, e]));
  // Map a child element id → the column containing it (children are flat in the map; columns
  // reference them by id and render them inline). Top-level = everything not inside a column.
  const childToCol = new Map<string, string>();
  for (const e of elements)
    if (e.type === "column")
      for (const cid of e.children) childToCol.set(cid, e.id);
  // Top-level (not inside a column), painted in stacking order (z, then insertion order).
  const topElements = elements
    .filter((e) => !childToCol.has(e.id))
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const connections: Connection[] = connRef.current
    ? Array.from(connRef.current.connections.values())
    : [];
  // Auto-height elements (todo/link/image) don't keep el.h in sync with their rendered height, so
  // connection endpoints would miss. Use measured heights for connection geometry.
  const sizedElements = elements.map((e) => ({
    ...e,
    h: cardHeights[e.id] ?? e.h,
  }));
  const lines: LineShape[] = connRef.current
    ? Array.from(connRef.current.lines.values())
    : [];
  // Edges (arrows + standalone lines): all edge state, drags, and derived geometry live in useEdges.
  // Element selection still lives here, so the hook gets the element-selection setters.
  const edges = useEdges({
    connRef,
    toWorld,
    zoom: view.zoom,
    elements,
    sizedElements,
    childToCol,
    connections,
    lines,
    readOnly,
    setSelectedIds,
  });
  const {
    selectedConn,
    setSelectedConn,
    selectedLine,
    setSelectedLine,
    editingConnLabel,
    setEditingConnLabel,
    editingLineLabel,
    setEditingLineLabel,
    armLine,
    setArmLine,
    lineDraw,
    linking,
    linkEnd,
    linkTarget,
    connLines,
    lineGeo,
    snapPt,
    removeConnection,
    setConnectionLabel,
    patchConnection,
    patchLine,
    removeLine,
    setLineLabel,
    startLink,
    startEndpointDrag,
    startBendDrag,
    startLineEndpointDrag,
    startLineBendDrag,
    beginLineDraw,
    updateLineDraw,
    commitLineDraw,
  } = edges;
  // Single-element ops/rails use selectedId (only when exactly one is selected); marquee can
  // select many.
  const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const selectId = (id: string) => {
    setSelectedIds([id]);
    setSelectedConn(null);
  };
  // Cmd/Ctrl-click toggles an element in/out of a multi-selection.
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setSelectedConn(null);
    setSelectedLine(null);
    setEditingId(null);
  };
  // Select a just-created element so its first click drags/selects (doesn't jump into edit mode).
  const selectNew = (id: string) => {
    setSelectedIds([id]);
    setSelectedConn(null);
    setJustCreated(id);
  };

  useEffect(() => {
    for (const el of elements) {
      if (el.type === "image" && el.mediaId && !mediaUrls[el.mediaId]) {
        const id = el.mediaId;
        void resolveMedia(id).then(
          (url) => url && setMediaUrls((m) => ({ ...m, [id]: url })),
        );
      }
    }
  });

  const patch = (id: string, p: Partial<Element>) => {
    const c = connRef.current;
    const cur = c?.elements.get(id);
    if (c && cur) c.elements.set(id, { ...cur, ...p } as Element);
  };

  // Move an element to (x,y). If it's part of a multi-selection, shift every selected element by
  // the same delta in one transaction (group move, single undo step).
  const moveElement = (id: string, x: number, y: number) => {
    const c = connRef.current;
    const cur = c?.elements.get(id);
    if (!c || !cur) return;
    if (selectedIds.length > 1 && selectedIds.includes(id)) {
      const dx = x - cur.x;
      const dy = y - cur.y;
      c.doc.transact(() => {
        for (const sid of selectedIds) {
          const e = c.elements.get(sid);
          if (e) c.elements.set(sid, { ...e, x: e.x + dx, y: e.y + dy });
        }
      });
    } else {
      patch(id, { x, y });
    }
  };
  // Drop any connections that touch the given elements so no arrow dangles after a delete.
  const pruneConnections = (ids: Set<string>) => {
    const c = connRef.current;
    if (!c) return;
    for (const cn of Array.from(c.connections.values())) {
      if (ids.has(cn.from) || ids.has(cn.to)) c.connections.delete(cn.id);
    }
  };
  // Expand a delete set to also include the children of any column being deleted.
  const withColumnChildren = (ids: string[]): Set<string> => {
    const set = new Set(ids);
    for (const id of ids) {
      const e = connRef.current?.elements.get(id);
      if (e?.type === "column") for (const cid of e.children) set.add(cid);
    }
    return set;
  };
  // Delete a set of elements: drop them, prune their connections, and unlink them from any column
  // that still references them (so deleting a card inside a column actually removes it).
  const deleteSet = (all: Set<string>) => {
    const c = connRef.current;
    if (!c) return;
    c.doc.transact(() => {
      for (const e of c.elements.values()) {
        if (e.type === "column" && e.children.some((cid) => all.has(cid))) {
          c.elements.set(e.id, {
            ...e,
            children: e.children.filter((cid) => !all.has(cid)),
          });
        }
      }
      all.forEach((x) => c.elements.delete(x));
      pruneConnections(all);
    });
  };
  const remove = (id: string) => {
    const all = withColumnChildren([id]);
    deleteSet(all);
    setSelectedIds((ids) => ids.filter((x) => !all.has(x)));
    setEditingId((s) => (s && all.has(s) ? null : s));
  };
  const removeMany = (ids: string[]) => {
    deleteSet(withColumnChildren(ids));
    setSelectedIds([]);
    setEditingId(null);
  };
  const deselect = () => {
    setSelectedIds([]);
    setEditingId(null);
    setCaptionEditing(false);
    setSelectedConn(null);
    setEditingConnLabel(null);
    setSelectedLine(null);
    setEditingLineLabel(null);
  };

  const overDeleteZone = (x: number, y: number) => {
    const r = deleteRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
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
  const handleDragMove = (id: string, x: number, y: number) => {
    setDraggingId(id);
    setOverDelete(overDeleteZone(x, y));
    // A non-column element dragged over a column previews where it'd drop.
    setColDrop(
      elementsById.get(id)?.type === "column" ? null : columnDropAt(x, y, id),
    );
  };
  // Drop over Delete removes; over a column reparents; otherwise just ends the drag. Operates on the
  // whole selection when the dragged element is part of a multi-selection.
  const handleDragRelease = (id: string, x: number, y: number) => {
    const targets =
      selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id];
    if (overDeleteZone(x, y)) {
      removeMany(targets);
    } else {
      const drop = columnDropAt(x, y, id);
      if (drop) {
        const movables = targets.filter(
          (t) => elementsById.get(t)?.type !== "column",
        );
        movables.forEach((t, i) =>
          moveChildToColumn(t, drop.colId, drop.index + i),
        );
      }
    }
    setDraggingId(null);
    setOverDelete(false);
    setColDrop(null);
  };

  // Backspace/Delete removes the selected element — unless a text field is focused (editing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (readOnly) return;
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (editingId) return;
      // Only bail when an actually-editable field is focused — a selected card's read-only inputs
      // (e.g. a to-do's items) must not block deletion.
      const ae = document.activeElement as HTMLInputElement | null;
      const editable =
        ae &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA"
          ? !ae.readOnly && !ae.disabled
          : ae.isContentEditable);
      if (editable) return;
      if (selectedIds.length) {
        e.preventDefault();
        removeMany(selectedIds);
      } else if (selectedLine) {
        e.preventDefault();
        removeLine(selectedLine);
      } else if (selectedConn) {
        e.preventDefault();
        removeConnection(selectedConn);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, editingId, readOnly, selectedLine, selectedConn]);

  // Undo/redo hotkeys: ⌘/Ctrl+Z, and ⌘/Ctrl+Y or ⇧⌘/Ctrl+Z. Skipped while typing so the browser
  // handles in-note text undo instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable)
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        connRef.current?.undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        connRef.current?.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Run a rich-text command on the focused note editor, then persist its sanitised HTML. Restore
  // the last in-editor selection first: interacting with the colour picker can collapse it, which
  // would otherwise make hiliteColor/foreColor apply to nothing.
  const exec = (command: string, value?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    ed.commit();
  };

  // Remember the selection while it's inside the focused note, so exec() can restore it.
  useEffect(() => {
    const onSel = () => {
      const ed = editorRef.current?.el;
      const sel = window.getSelection();
      if (ed && sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        if (ed.contains(r.commonAncestorContainer))
          savedRange.current = r.cloneRange();
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // Drag a card that lives inside a column: reorder within, move to another column, or pop it out
  // onto the canvas. A press without movement just selects it.
  const startColumnChildDrag = (childId: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (
        !moved &&
        Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4
      )
        return;
      moved = true;
      setDraggingId(childId);
      setColDrop(columnDropAt(ev.clientX, ev.clientY));
      setChildDragGhost({ id: childId, cx: ev.clientX, cy: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraggingId(null);
      setColDrop(null);
      setChildDragGhost(null);
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
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Publish the full control set whenever undo state or the view changes (the undo events feed
  // canUndo/canRedo above; zoom/grid come from local state).
  useEffect(() => {
    onControls({
      undo: () => connRef.current?.undo(),
      redo: () => connRef.current?.redo(),
      canUndo,
      canRedo,
      exportPng: () => onExport(),
      zoomIn: () => setZoom(view.zoom * 1.2),
      zoomOut: () => setZoom(view.zoom / 1.2),
      resetView,
      zoomToFit: () => zoomToFit(elements),
      toggleGrid: () => setShowGrid((g) => !g),
      gridOn: showGrid,
      zoomPct: Math.round(view.zoom * 100),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, view.zoom, showGrid, boardId]);

  // Empty-canvas drag: Space/middle-button pans; otherwise draws a marquee selection.
  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (armLine) {
      // Line tool armed: press = start point (snapped), drag to end.
      beginLineDraw(e.clientX, e.clientY);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (spaceRef.current || e.button === 1) {
      panRef.current = { cx: e.clientX, cy: e.clientY, px: view.x, py: view.y };
    } else {
      marqueeRef.current = {
        x0: e.clientX,
        y0: e.clientY,
        additive: e.metaKey || e.ctrlKey || e.shiftKey,
      };
      setMarquee({
        x0: e.clientX,
        y0: e.clientY,
        x1: e.clientX,
        y1: e.clientY,
      });
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onViewportPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    connRef.current?.sendCursor(w.x, w.y);
    if (lineDraw) {
      updateLineDraw(e.clientX, e.clientY);
      return;
    }
    const p = panRef.current;
    if (p) {
      setViewClamped((v) => ({
        ...v,
        x: p.px + e.clientX - p.cx,
        y: p.py + e.clientY - p.cy,
      }));
      return;
    }
    const m = marqueeRef.current;
    if (m) setMarquee({ x0: m.x0, y0: m.y0, x1: e.clientX, y1: e.clientY });
  };
  const onViewportPointerUp = () => {
    if (lineDraw) {
      commitLineDraw();
      return;
    }
    panRef.current = null;
    const m = marqueeRef.current;
    marqueeRef.current = null;
    if (!m) return;
    if (!marquee) return;
    const moved =
      Math.abs(marquee.x1 - marquee.x0) + Math.abs(marquee.y1 - marquee.y0) > 4;
    if (!moved) {
      if (!m.additive) deselect(); // a click on empty canvas (keep selection when modifier held)
    } else {
      // Select TOP-LEVEL elements intersecting the marquee (column children have stale x/y and live
      // inside their column, so they're excluded). Use MEASURED heights (sizedElements) so an
      // auto-height card like an expanded column is hit across its full rendered height, not its
      // stale stored h. Cmd/Ctrl/Shift adds to the current selection.
      const a = toWorld(
        Math.min(marquee.x0, marquee.x1),
        Math.min(marquee.y0, marquee.y1),
      );
      const b = toWorld(
        Math.max(marquee.x0, marquee.x1),
        Math.max(marquee.y0, marquee.y1),
      );
      const hits = sizedElements
        .filter((el) => !childToCol.has(el.id))
        .filter(
          (el) =>
            el.x < b.x && el.x + el.w > a.x && el.y < b.y && el.y + el.h > a.y,
        )
        .map((el) => el.id);
      setSelectedIds((prev) =>
        m.additive ? Array.from(new Set([...prev, ...hits])) : hits,
      );
      setEditingId(null);
      setCaptionEditing(false);
    }
    setMarquee(null);
  };

  const createNote = (x: number, y: number, text = "") => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, {
      id,
      type: "note",
      x,
      y,
      w: 220,
      h: 120,
      text,
      style: { fill: "#ffffff" },
      z: nextZ(),
    });
    selectNew(id);
    setEditingId(null);
  };

  const createTodo = (x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, {
      id,
      type: "todo",
      x,
      y,
      w: 240,
      h: 140,
      title: "",
      items: [{ id: crypto.randomUUID(), text: "", done: false }],
      style: { fill: "#ffffff" },
      z: nextZ(),
    });
    selectNew(id);
  };

  const createColumn = (x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, {
      id,
      type: "column",
      x,
      y,
      w: 280,
      h: 120,
      title: "",
      children: [],
      style: { fill: "#ffffff" },
      z: nextZ(),
    });
    selectNew(id);
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

  // --- Context-menu actions ---
  const nextZ = () => Math.max(0, ...elements.map((e) => e.z ?? 0)) + 1;
  const bringToFront = (ids: string[]) => {
    const c = connRef.current;
    if (!c) return;
    let z = nextZ();
    c.doc.transact(() =>
      ids.forEach((id) => {
        const e = c.elements.get(id);
        if (e) c.elements.set(id, { ...e, z: z++ });
      }),
    );
  };
  const sendToBack = (ids: string[]) => {
    const c = connRef.current;
    if (!c) return;
    let z = Math.min(0, ...elements.map((e) => e.z ?? 0)) - ids.length;
    c.doc.transact(() =>
      ids.forEach((id) => {
        const e = c.elements.get(id);
        if (e) c.elements.set(id, { ...e, z: z++ });
      }),
    );
  };
  const toggleLock = (ids: string[]) => {
    const c = connRef.current;
    if (!c) return;
    const allLocked = ids.every((id) => c.elements.get(id)?.locked);
    c.doc.transact(() =>
      ids.forEach((id) => {
        const e = c.elements.get(id);
        if (e) c.elements.set(id, { ...e, locked: !allLocked });
      }),
    );
  };
  // Duplicate elements (offset, on top). Columns deep-copy their children with fresh ids.
  const duplicate = (ids: string[]) => {
    const c = connRef.current;
    if (!c) return;
    const fresh: string[] = [];
    c.doc.transact(() => {
      let z = nextZ();
      for (const id of ids) {
        const e = c.elements.get(id);
        if (!e) continue;
        const nid = crypto.randomUUID();
        if (e.type === "column") {
          const map = new Map<string, string>();
          for (const cid of e.children) {
            const ch = c.elements.get(cid);
            if (!ch) continue;
            const ncid = crypto.randomUUID();
            map.set(cid, ncid);
            c.elements.set(ncid, { ...ch, id: ncid, z: z++ } as Element);
          }
          c.elements.set(nid, {
            ...e,
            id: nid,
            x: e.x + 24,
            y: e.y + 24,
            z: z++,
            children: e.children
              .map((cid) => map.get(cid))
              .filter(Boolean) as string[],
          } as Element);
        } else {
          c.elements.set(nid, {
            ...e,
            id: nid,
            x: e.x + 24,
            y: e.y + 24,
            z: z++,
          } as Element);
        }
        fresh.push(nid);
      }
    });
    setSelectedIds(fresh);
    setSelectedConn(null);
    setSelectedLine(null);
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

  // Copy elements (deep, with column children) into the internal clipboard.
  const copyEls = (ids: string[]) => {
    const c = connRef.current;
    if (!c) return;
    const out: Element[] = [];
    for (const id of ids) {
      const e = c.elements.get(id);
      if (!e) continue;
      out.push(structuredClone(e));
      if (e.type === "column")
        for (const cid of e.children) {
          const ch = c.elements.get(cid);
          if (ch) out.push(structuredClone(ch));
        }
    }
    clipboardRef.current = out;
  };
  // Paste clipboard elements with fresh ids near (x,y), remapping column children.
  const pasteEls = (x: number, y: number) => {
    const c = connRef.current;
    const clip = clipboardRef.current;
    if (!c || !clip.length) return;
    const idMap = new Map<string, string>();
    for (const e of clip) idMap.set(e.id, crypto.randomUUID());
    // Anchor the paste so the first element lands at (x,y).
    const ox = x - clip[0]!.x;
    const oy = y - clip[0]!.y;
    const roots: string[] = [];
    const childIds = new Set(
      clip
        .filter((e) => e.type === "column")
        .flatMap((e) => (e.type === "column" ? e.children : [])),
    );
    let z = nextZ();
    c.doc.transact(() => {
      for (const e of clip) {
        const nid = idMap.get(e.id)!;
        const copy: Element = {
          ...structuredClone(e),
          id: nid,
          x: e.x + ox,
          y: e.y + oy,
          z: z++,
        } as Element;
        if (copy.type === "column")
          copy.children = copy.children.map((cid) => idMap.get(cid) ?? cid);
        c.elements.set(nid, copy);
        if (!childIds.has(e.id)) roots.push(nid);
      }
    });
    setSelectedIds(roots);
    setSelectedConn(null);
    setSelectedLine(null);
  };
  // Apply the copied element's style to the selection (paste-styles).
  const pasteStyles = (ids: string[]) => {
    const src = clipboardRef.current[0];
    if (!src?.style) return;
    const c = connRef.current;
    c?.doc.transact(() =>
      ids.forEach((id) => {
        const e = c.elements.get(id);
        if (e)
          c.elements.set(id, { ...e, style: { ...e.style, ...src.style } });
      }),
    );
  };
  // Rename: drop into edit mode for elements with an editable title/text.
  const renameEl = (id: string) => {
    const e = elementsById.get(id);
    if (!e) return;
    selectId(id);
    if (e.type === "note" || e.type === "text" || e.type === "todo")
      setEditingId(id);
  };

  // Open the menu for an element: select it (unless already in a multi-selection), then position.
  const openMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) return;
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (!selectedIds.includes(id)) selectId(id);
    setMenu({ x: e.clientX, y: e.clientY, ids });
  };
  // Right-click empty canvas → a small menu (paste / select all).
  const openCanvasMenu = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, ids: [] });
  };
  // Build the menu items for the current target ids ([] = empty-canvas menu).
  const menuItems = (ids: string[]): MenuItem[] => {
    if (!ids.length) {
      const at = menu ? toWorld(menu.x, menu.y) : viewportCentre();
      return [
        {
          label: "Paste",
          shortcut: "⌘V",
          disabled: !clipboardRef.current.length,
          onClick: () => pasteEls(at.x, at.y),
        },
        {
          label: "Select all",
          onClick: () => setSelectedIds(topElements.map((el) => el.id)),
        },
      ];
    }
    const els = ids
      .map((id) => elementsById.get(id))
      .filter(Boolean) as Element[];
    const allLocked = els.length > 0 && els.every((e) => e.locked);
    const groupable =
      els.length >= 1 &&
      els.every((e) => e.type !== "column") &&
      ids.every((id) => !childToCol.has(id));
    const renamable =
      ids.length === 1 &&
      ["note", "text", "todo", "column"].includes(els[0]?.type ?? "");
    return [
      { label: "Copy", shortcut: "⌘C", onClick: () => copyEls(ids) },
      {
        label: "Cut",
        shortcut: "⌘X",
        onClick: () => {
          copyEls(ids);
          removeMany(ids);
        },
      },
      {
        label: "Paste styles",
        disabled: !clipboardRef.current[0]?.style,
        onClick: () => pasteStyles(ids),
      },
      { label: "Duplicate", shortcut: "⌘D", onClick: () => duplicate(ids) },
      ...(renamable
        ? ([
            { label: "Rename", onClick: () => renameEl(ids[0]!) },
          ] as MenuItem[])
        : []),
      ...(groupable
        ? ([
            { label: "Group into column", onClick: () => groupIntoColumn(ids) },
          ] as MenuItem[])
        : []),
      {
        label: allLocked ? "Unlock position" : "Lock position",
        onClick: () => toggleLock(ids),
      },
      "separator",
      { label: "Bring to front", onClick: () => bringToFront(ids) },
      { label: "Send to back", onClick: () => sendToBack(ids) },
      "separator",
      {
        label: "Delete",
        shortcut: "⌫",
        danger: true,
        onClick: () => removeMany(ids),
      },
    ];
  };

  // Press-and-drag from a tool: spawn the default/placeholder element under the cursor; it follows
  // until release. Input tools (image/link/embed/board) then open their dialog to fill the
  // placeholder (fillRef tells those flows to patch the placeholder rather than create new).
  const startPlace = (toolKey: string, e: React.PointerEvent) => {
    if (readOnly) return;
    const c = connRef.current;
    if (!c) return;
    const spec = TOOL_SPECS[toolKey];
    if (!spec) return;
    const id = crypto.randomUUID();
    const w0 = toWorld(e.clientX, e.clientY);
    const size = { w: spec.w, h: spec.h };
    const fill = spec.fill ?? null;
    c.elements.set(id, {
      ...spec.make({
        id,
        x: w0.x - spec.w / 2,
        y: w0.y - spec.h / 2,
        w: spec.w,
        h: spec.h,
      }),
      z: nextZ(),
    });
    selectNew(id);
    setDraggingId(id);
    const intoColumn = !!spec.nestable; // columns can't nest
    const move = (ev: PointerEvent) => {
      const w = toWorld(ev.clientX, ev.clientY);
      patch(id, { x: w.x - size.w / 2, y: w.y - size.h / 2 });
      setColDrop(intoColumn ? columnDropAt(ev.clientX, ev.clientY, id) : null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraggingId(null);
      setColDrop(null);
      // Dropped onto a column → add as a child.
      if (intoColumn) {
        const drop = columnDropAt(ev.clientX, ev.clientY, id);
        if (drop) moveChildToColumn(id, drop.colId, drop.index);
      }
      if (!fill) return;
      fillRef.current = { id, kind: fill };
      if (fill === "image") fileRef.current?.click();
      else if (fill === "link") setLinkModal({ x: 0, y: 0 });
      else if (fill === "embed") setEmbedModal({ x: 0, y: 0 });
      else if (fill === "board") setBoardModal({ x: 0, y: 0 });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Remove an unfilled placeholder when its fill dialog is dismissed.
  const cancelFill = (kind: "image" | "link" | "embed" | "board") => {
    if (fillRef.current?.kind === kind) {
      connRef.current?.elements.delete(fillRef.current.id);
      fillRef.current = null;
    }
  };

  // Create a new board in this workspace and drop a tile that opens it (nested boards). When filling
  // a placeholder (drag-placed Board tool), patch that element instead of creating a new tile.
  const createBoardElement = async (title: string) => {
    const c = connRef.current;
    const at = boardModal ?? viewportCentre();
    const target =
      fillRef.current?.kind === "board" ? fillRef.current.id : null;
    fillRef.current = null;
    if (!c) return;
    try {
      const b = await api<Board>(`/api/workspaces/${workspaceId}/boards`, {
        method: "POST",
        body: JSON.stringify({ title, parentBoardId: boardId }),
      });
      if (target) {
        const cur = c.elements.get(target);
        if (cur?.type === "board")
          patch(target, { boardId: b.id, title: b.title } as Partial<Element>);
      } else {
        const id = crypto.randomUUID();
        c.elements.set(id, {
          id,
          type: "board",
          x: at.x,
          y: at.y,
          w: 200,
          h: 116,
          boardId: b.id,
          title: b.title,
          style: { fill: "#ffffff" },
          z: nextZ(),
        });
        selectNew(id);
      }
    } catch {
      toast("Couldn't create board", "error");
      if (target) c.elements.delete(target);
    }
  };

  // Drop an embed element with a resolved iframe src.
  const dropEmbed = (src: string, x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    const { w, h } = embedDefaultSize(src);
    c.elements.set(id, { id, type: "embed", x, y, w, h, src, z: nextZ() });
    selectNew(id);
  };
  // Embed tool: raw embed code only — paste an <iframe …> snippet.
  const createEmbed = (input: string) => {
    const at = embedModal ?? viewportCentre();
    const target =
      fillRef.current?.kind === "embed" ? fillRef.current.id : null;
    fillRef.current = null;
    const src = extractIframeSrc(input);
    if (!src) {
      toast("Paste embed code (an <iframe> snippet)", "error");
      if (target) connRef.current?.elements.delete(target);
      return;
    }
    if (target) {
      const cur = connRef.current?.elements.get(target);
      if (cur?.type === "embed")
        patch(target, {
          src,
          h: embedHeightFor(src, cur.w),
        } as Partial<Element>);
    } else dropEmbed(src, at.x, at.y);
  };

  // Unfurl + drop a link card at a point; returns an approximate height for column stacking.
  const makeLinkAt = async (
    url: string,
    x: number,
    y: number,
  ): Promise<number> => {
    try {
      const u = await unfurlLink(boardId, url);
      dropLink(u, url, { x, y });
      return u.imageUrl ? 230 : 120;
    } catch {
      dropLink({ url, title: null, description: null, imageUrl: null }, url, {
        x,
        y,
      });
      return 120;
    }
  };

  // Place creators in a vertical column (Milanote-style); each returns its height to stack the next.
  const pasteColumn = async (
    makers: Array<(x: number, y: number) => Promise<number> | number>,
    start?: { x: number; y: number },
  ) => {
    const at = start ?? viewportCentre();
    let py = at.y;
    for (const make of makers) {
      const h = await make(at.x, py);
      py += (h || 160) + 16;
    }
  };

  // Build element creators from clipboard/drop data and lay them out in a column. Handles multiple
  // items (image files, or an HTML payload with several images/links/embeds). Returns true if handled.
  const dropClipboard = (
    files: File[],
    text: string,
    html: string,
    start?: { x: number; y: number },
  ): boolean => {
    const makers: Array<(x: number, y: number) => Promise<number> | number> =
      [];
    for (const f of files) makers.push((x, y) => addImageFile(f, x, y));
    const firstTok = text.split(/\s+/)[0] ?? "";
    if (!files.length) {
      const iframeSrc = extractIframeSrc(text);
      if (iframeSrc) {
        makers.push((x, y) => {
          dropEmbed(iframeSrc, x, y);
          return embedHeightFor(iframeSrc, 360);
        });
      } else if (/^https?:\/\//i.test(firstTok)) {
        const at = start ?? viewportCentre();
        void handleUrl(firstTok, at.x, at.y); // single URL — may prompt image/link or embed
        return true;
      } else {
        const items = parseClipboardHtmlAll(html);
        if (items.length) {
          for (const it of items) {
            if (it.kind === "iframe")
              makers.push((x, y) => {
                dropEmbed(it.value, x, y);
                return embedHeightFor(it.value, 360);
              });
            else if (it.kind === "img")
              makers.push((x, y) => createImageUrl(it.value, x, y));
            else makers.push((x, y) => makeLinkAt(it.value, x, y));
          }
        } else if (text) {
          makers.push((x, y) => {
            createNote(x, y, text.slice(0, 10000));
            return 140;
          });
        }
      }
    } else {
      // Images plus accompanying note text (the text often lives in the HTML, not text/plain).
      const noteText = text || htmlVisibleText(html);
      if (noteText && !/^https?:\/\//i.test(noteText.split(/\s+/)[0] ?? "")) {
        makers.push((x, y) => {
          createNote(x, y, noteText.slice(0, 10000));
          return 140;
        });
      }
    }
    if (!makers.length) return false;
    void pasteColumn(makers, start);
    return true;
  };

  const pickImageAt = (x: number, y: number) => {
    dropCoords.current = { x, y };
    fileRef.current?.click();
  };

  // Drop a link preview card from an already-fetched unfurl.
  const dropLink = (
    u: Unfurl,
    url: string,
    at: { x: number; y: number },
    embedSrc?: string,
  ) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    const w = embedSrc ? 360 : 260;
    const previewH = embedSrc
      ? embedHeightFor(embedSrc, w)
      : u.imageUrl
        ? 230
        : 0;
    c.elements.set(id, {
      id,
      type: "link",
      x: at.x,
      y: at.y,
      w,
      h: previewH + 96,
      url: u.url || url,
      title: u.title ?? undefined,
      description: u.description ?? undefined,
      image: u.imageUrl ?? undefined,
      embedSrc,
      z: nextZ(),
    });
    selectNew(id);
  };

  // Manual "Add link" dialog: always a link card (unfurled).
  const createLink = async (url: string, coords?: { x: number; y: number }) => {
    const at = coords ?? linkModal ?? viewportCentre();
    const target = fillRef.current?.kind === "link" ? fillRef.current.id : null;
    fillRef.current = null;
    try {
      const u = await unfurlLink(boardId, url);
      if (target) {
        const cur = connRef.current?.elements.get(target);
        if (cur?.type === "link")
          patch(target, {
            url: u.url || url,
            title: u.title ?? undefined,
            description: u.description ?? undefined,
            image: u.imageUrl ?? undefined,
          } as Partial<Element>);
      } else dropLink(u, url, at);
    } catch {
      toast("Couldn't load that link", "error");
      if (target) connRef.current?.elements.delete(target);
    }
  };

  // Dropped/pasted URL: an image URL becomes an image; otherwise unfurl, and if the page has a
  // preview image the result is ambiguous (image vs link) — prompt, honouring a remembered choice.
  const handleUrl = async (url: string, x: number, y: number) => {
    if (isImageUrl(url)) return void createImageUrl(url, x, y);
    // Known embeddable providers (YouTube, Vimeo, Figma, Spotify, …): link-with-preview or a bare
    // embed — prompt, honouring a remembered choice.
    const embed = embeddableUrl(url);
    if (embed) {
      const remembered = localStorage.getItem(EMBED_CHOICE_KEY);
      if (remembered === "embed") return dropEmbed(embed, x, y);
      if (remembered === "link")
        return void createProviderLink(url, embed, { x, y });
      setEmbedChoice({ url, embed, at: { x, y } });
      return;
    }
    const at = { x, y };
    let u: Unfurl;
    try {
      u = await unfurlLink(boardId, url);
    } catch {
      toast("Couldn't load that link", "error");
      return;
    }
    if (!u.imageUrl) return dropLink(u, url, at); // nothing to choose between
    const remembered = localStorage.getItem(URL_CHOICE_KEY);
    if (remembered === "image")
      return void createImageUrl(u.imageUrl, at.x, at.y, url);
    if (remembered === "link") return dropLink(u, url, at);
    setUrlChoice({ u, url, at });
  };

  const applyUrlChoice = (kind: "image" | "link", remember: boolean) => {
    const choice = urlChoice;
    setUrlChoice(null);
    if (!choice) return;
    if (remember) localStorage.setItem(URL_CHOICE_KEY, kind);
    if (kind === "image" && choice.u.imageUrl)
      void createImageUrl(
        choice.u.imageUrl,
        choice.at.x,
        choice.at.y,
        choice.url,
      );
    else dropLink(choice.u, choice.url, choice.at);
  };

  // Provider link: unfurl for the title (track/video name), then a link card with the live embed
  // as its preview. Falls back to a bare card if the unfurl fails.
  const createProviderLink = async (
    url: string,
    embed: string,
    at: { x: number; y: number },
  ) => {
    let u: Unfurl = { url, title: null, description: null, imageUrl: null };
    try {
      u = await unfurlLink(boardId, url);
    } catch {
      /* keep fallback */
    }
    dropLink(u, url, at, embed);
  };

  const applyEmbedChoice = (kind: "link" | "embed", remember: boolean) => {
    const choice = embedChoice;
    setEmbedChoice(null);
    if (!choice) return;
    if (remember) localStorage.setItem(EMBED_CHOICE_KEY, kind);
    if (kind === "embed") dropEmbed(choice.embed, choice.at.x, choice.at.y);
    else void createProviderLink(choice.url, choice.embed, choice.at);
  };

  const addImageFile = async (
    file: File,
    x: number,
    y: number,
  ): Promise<number> => {
    const c = connRef.current;
    if (!c) return 0;
    setBusy(true);
    try {
      const { mediaId, displayUrl } = await uploadImage(boardId, file);
      setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
      const { w, h } = await loadImageSize(displayUrl);
      const id = crypto.randomUUID();
      const width = 280;
      const height = Math.max(40, Math.round((width * h) / w));
      c.elements.set(id, {
        id,
        type: "image",
        x,
        y,
        w: width,
        h: height,
        src: displayUrl,
        mediaId,
        alt: file.name,
        z: nextZ(),
      });
      selectNew(id);
      toast("Image added", "success");
      return height;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
      return 0;
    } finally {
      setBusy(false);
    }
  };

  // Image element from an external URL (no upload) — used for image URLs dropped/pasted in. When
  // it came from a web page (the image vs link chooser), attribute the source as a caption.
  const createImageUrl = async (
    src: string,
    x: number,
    y: number,
    sourceUrl?: string,
  ): Promise<number> => {
    const c = connRef.current;
    if (!c) return 0;
    const { w, h } = await loadImageSize(src);
    const width = 280;
    const id = crypto.randomUUID();
    const height = Math.max(40, Math.round((width * h) / w));
    // Caption attributes the source page as "from {site}" (hyperlinked to it).
    const caption = sourceUrl
      ? `<a href="${sourceUrl}">${escapeText(`from ${siteName(sourceUrl)}`)}</a>`
      : undefined;
    c.elements.set(id, {
      id,
      type: "image",
      x,
      y,
      w: width,
      h: height,
      src,
      z: nextZ(),
      ...(caption ? { caption, showCaption: true } : {}),
    });
    selectNew(id);
    return height + (caption ? 40 : 0);
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target =
      fillRef.current?.kind === "image" ? fillRef.current.id : null;
    fillRef.current = null;
    if (!file) {
      if (target) connRef.current?.elements.delete(target); // picker canceled → drop placeholder
      return;
    }
    if (target) {
      setBusy(true);
      try {
        const { mediaId, displayUrl } = await uploadImage(boardId, file);
        setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
        const { w, h } = await loadImageSize(displayUrl);
        const cur = connRef.current?.elements.get(target);
        if (cur?.type === "image")
          patch(target, {
            src: displayUrl,
            mediaId,
            alt: file.name,
            h: Math.max(40, Math.round((cur.w * h) / w)),
          } as Partial<Element>);
        toast("Image added", "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Upload failed", "error");
        connRef.current?.elements.delete(target);
      } finally {
        setBusy(false);
      }
      return;
    }
    const at = dropCoords.current ?? viewportCentre();
    await addImageFile(file, at.x, at.y);
  };

  const onExport = async () => {
    setBusy(true);
    toast("Preparing export…");
    try {
      window.open(await requestExport(boardId, "png"), "_blank");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setBusy(false);
    }
  };

  // The whole canvas is a drop zone: internal tools, image files, URLs, or plain text. Read the
  // dataTransfer synchronously (it's cleared after the first await).
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    const { x, y } = toWorld(e.clientX, e.clientY);

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    const uri = (
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain")
    ).trim();
    const html = e.dataTransfer.getData("text/html");
    dropClipboard(files, uri, html, { x, y });
  };

  // Paste anywhere on the board: an image from the clipboard uploads; an image URL becomes an
  // image; another URL becomes a link; other text becomes a note. Skipped while editing a note so
  // normal text paste works.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly) return;
      const ae = document.activeElement as HTMLElement | null;
      if (
        editingId ||
        (ae &&
          (ae.tagName === "INPUT" ||
            ae.tagName === "TEXTAREA" ||
            ae.isContentEditable))
      )
        return;
      const dt = e.clipboardData;
      if (!dt) return;
      // Read all image files synchronously (clipboard items expire after the event).
      const files = Array.from(dt.items)
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      const text = dt.getData("text").trim();
      const html = dt.getData("text/html");
      if (dropClipboard(files, text, html)) e.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editingId, readOnly]);

  const createTools: Tool[] = [
    {
      key: "note",
      label: "Note",
      icon: <Icon.NoteIcon />,
      onStartPlace: (e) => startPlace("note", e),
      onPlace: () => createNote(viewportCentre().x, viewportCentre().y),
    },
    {
      key: "image",
      label: "Image",
      icon: <Icon.ImageIcon />,
      onStartPlace: (e) => startPlace("image", e),
      onPlace: () => pickImageAt(viewportCentre().x, viewportCentre().y),
      disabled: busy,
    },
    {
      key: "link",
      label: "Link",
      icon: <Icon.LinkIcon />,
      onStartPlace: (e) => startPlace("link", e),
      onPlace: () => setLinkModal(viewportCentre()),
    },
    {
      key: "todo",
      label: "To-do",
      icon: <Icon.TodoIcon />,
      onStartPlace: (e) => startPlace("todo", e),
      onPlace: () => createTodo(viewportCentre().x, viewportCentre().y),
    },
    {
      key: "board",
      label: "Board",
      icon: <Icon.BoardIcon />,
      onStartPlace: (e) => startPlace("board", e),
      onPlace: () => setBoardModal(viewportCentre()),
    },
    {
      key: "column",
      label: "Column",
      icon: <Icon.ColumnIcon />,
      onStartPlace: (e) => startPlace("column", e),
      onPlace: () => createColumn(viewportCentre().x, viewportCentre().y),
    },
    {
      key: "embed",
      label: "Embed",
      icon: <Icon.EmbedIcon />,
      onStartPlace: (e) => startPlace("embed", e),
      onPlace: () => setEmbedModal(viewportCentre()),
    },
    {
      key: "line",
      label: "Line",
      icon: <Icon.LineIcon />,
      active: armLine,
      // Click to arm, then drag on the canvas to draw (snaps to element anchors).
      onClick: () => {
        deselect();
        setArmLine((a) => !a);
      },
    },
  ];

  // Merge a hex into the selected element's style, or delete the key when null.
  const setStyleKey = (key: "fill" | "strip", hex: string | null) => {
    if (!selected) return;
    const style = { ...selected.style };
    if (hex) style[key] = hex;
    else delete style[key];
    patch(selected.id, { style } as Partial<Element>);
  };

  // --- Multi-selection: common-settings rail applies one change across all selected elements. ---
  const selectedEls = elements.filter((e) => selectedIds.includes(e.id));
  const eachSelected = (fn: (e: Element) => Partial<Element> | null) => {
    const c = connRef.current;
    if (!c) return;
    c.doc.transact(() => {
      for (const id of selectedIds) {
        const e = c.elements.get(id);
        if (!e) continue;
        const p = fn(e);
        if (p) c.elements.set(id, { ...e, ...p } as Element);
      }
    });
  };
  const setStyleAll = (key: "fill" | "strip", hex: string | null) =>
    eachSelected((e) => {
      const style = { ...e.style };
      if (hex) style[key] = hex;
      else delete style[key];
      return { style } as Partial<Element>;
    });
  const captionVisible = (e: Element) =>
    e.type === "image"
      ? !!e.showCaption
      : e.type === "link"
        ? !e.hideCaption
        : false;
  const toggleCaptionAll = () => {
    const target = !selectedEls.every(captionVisible);
    eachSelected((e) =>
      e.type === "image"
        ? ({ showCaption: target } as Partial<Element>)
        : e.type === "link"
          ? ({ hideCaption: !target } as Partial<Element>)
          : null,
    );
  };
  const togglePreviewAll = () => {
    const target = !selectedEls.every((e) => e.type === "link" && !e.hideImage);
    eachSelected((e) =>
      e.type === "link" ? ({ hideImage: !target } as Partial<Element>) : null,
    );
  };

  // Render one element card. `embedded` cards live inside a column (relative flow, drag = reparent).
  const renderElementCard = (el: Element, embedded: boolean) => (
    <ElementCard
      key={el.id}
      el={el}
      embedded={embedded}
      selected={selectedIds.includes(el.id)}
      editing={el.id === editingId}
      imgUrl={
        el.type === "image"
          ? (el.mediaId && mediaUrls[el.mediaId]) || el.src
          : undefined
      }
      onSelect={() => selectId(el.id)}
      onToggleSelect={() => toggleSelect(el.id)}
      onContextMenu={(e) => openMenu(el.id, e)}
      onEdit={() => setEditingId(el.id)}
      onMove={(x, y) => moveElement(el.id, x, y)}
      onResize={(w, h) => patch(el.id, { w, h })}
      onText={(text) => patch(el.id, { text } as Partial<Element>)}
      onRegister={(e) => (editorRef.current = e)}
      onOpen={
        el.type === "link"
          ? () => window.open(el.url, "_blank", "noopener,noreferrer")
          : el.type === "board"
            ? () => onOpenBoard(el.boardId)
            : undefined
      }
      onCaption={
        el.type === "image"
          ? (h) => patch(el.id, { caption: h } as Partial<Element>)
          : undefined
      }
      onTodo={
        el.type === "todo"
          ? (p) => patch(el.id, p as Partial<Element>)
          : undefined
      }
      onStartLink={(e) => startLink(el.id, e)}
      onSize={reportHeight}
      freshlyCreated={justCreated === el.id}
      onConsumeFresh={() => setJustCreated(null)}
      readOnly={readOnly}
      onCaptionFocus={() => {
        selectId(el.id);
        setCaptionEditing(true);
      }}
      onEmbeddedDragStart={(e) => startColumnChildDrag(el.id, e)}
      onColumnTitle={
        el.type === "column"
          ? (t) => patch(el.id, { title: t } as Partial<Element>)
          : undefined
      }
      onToggleCollapse={
        el.type === "column"
          ? () => patch(el.id, { collapsed: !el.collapsed } as Partial<Element>)
          : undefined
      }
      colDropIndex={
        el.type === "column" && colDrop?.colId === el.id
          ? colDrop.index
          : undefined
      }
      renderColumnChild={
        el.type === "column"
          ? (cid: string) => renderColumnChild(cid)
          : undefined
      }
      shrink={draggingId === el.id && overDelete}
      dragging={draggingId === el.id}
      zoom={view.zoom}
      toWorld={toWorld}
      onDragMove={(x, y) => handleDragMove(el.id, x, y)}
      onDragRelease={(x, y) => handleDragRelease(el.id, x, y)}
    />
  );
  // Resolve + render a column's child element (embedded).
  const renderColumnChild = (childId: string) => {
    const child = elementsById.get(childId);
    return child ? renderElementCard(child, true) : null;
  };

  return (
    <div className="flex flex-1 select-none overflow-hidden">
      <SelectionRail
        readOnly={readOnly}
        selected={selected}
        connections={connections}
        lines={lines}
        selectedConn={selectedConn}
        selectedLine={selectedLine}
        selectedId={selectedId}
        selectedIds={selectedIds}
        selectedEls={selectedEls}
        editingId={editingId}
        captionEditing={captionEditing}
        deleteRef={deleteRef}
        overDelete={overDelete}
        createTools={createTools}
        editorRef={editorRef}
        patch={patch}
        patchConnection={patchConnection}
        patchLine={patchLine}
        remove={remove}
        removeMany={removeMany}
        removeConnection={removeConnection}
        removeLine={removeLine}
        setEditingConnLabel={setEditingConnLabel}
        setEditingLineLabel={setEditingLineLabel}
        setSelectedConn={setSelectedConn}
        setSelectedLine={setSelectedLine}
        setEditingId={setEditingId}
        setCaptionEditing={setCaptionEditing}
        exec={exec}
        setStyleKey={setStyleKey}
        setStyleAll={setStyleAll}
        toggleCaptionAll={toggleCaptionAll}
        togglePreviewAll={togglePreviewAll}
        deselect={deselect}
        onOpenBoard={onOpenBoard}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />
      <NameModal
        open={!!linkModal}
        title="Add a link"
        label="Paste a URL"
        submitLabel="Add"
        onClose={() => {
          setLinkModal(null);
          cancelFill("link");
        }}
        onSubmit={createLink}
      />

      <NameModal
        open={!!boardModal}
        title="New board"
        label="Board title"
        submitLabel="Create"
        onClose={() => {
          setBoardModal(null);
          cancelFill("board");
        }}
        onSubmit={createBoardElement}
      />

      <NameModal
        open={!!embedModal}
        title="Embed code"
        label="Paste an <iframe> embed snippet"
        submitLabel="Embed"
        onClose={() => {
          setEmbedModal(null);
          cancelFill("embed");
        }}
        onSubmit={createEmbed}
      />

      {urlChoice && (
        <UrlChoiceModal
          preview={urlChoice.u}
          onPick={applyUrlChoice}
          onClose={() => setUrlChoice(null)}
        />
      )}

      {embedChoice && (
        <EmbedChoiceModal
          embed={embedChoice.embed}
          onPick={applyEmbedChoice}
          onClose={() => setEmbedChoice(null)}
        />
      )}

      <div
        ref={viewportRef}
        className={`relative flex-1 touch-none overflow-hidden bg-slate-100 ${armLine ? "cursor-crosshair" : ""}`}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onContextMenu={openCanvasMenu}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <div
          className="absolute right-4 top-4 z-30 flex items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Badge tone={status === "online" ? "green" : "slate"}>{status}</Badge>
          <button
            onClick={() => {
              const next = !showComments;
              setShowComments(next);
              showCommentsRef.current = next;
              if (next) setUnreadComments(false);
            }}
            aria-label="Comments"
            title="Comments"
            className={`relative grid h-8 w-8 place-items-center rounded-lg border-2 shadow-sm ${showComments ? "border-primary bg-primary text-white" : "border-line-subtle bg-white text-slate-500 hover:text-primary"}`}
          >
            <Icon.ChatIcon className="text-base" />
            {unreadComments && !showComments && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary" />
            )}
          </button>
        </div>
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 m-2 rounded-xl border-2 border-dashed border-primary bg-primary/5" />
        )}
        {/* Marquee selection rectangle (screen coords). */}
        {marquee && (
          <div
            className="pointer-events-none fixed z-40 rounded border-2 border-primary bg-primary/10"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
        {/* Zoom control */}
        <div
          className="absolute bottom-4 left-4 z-30 flex items-center gap-1 rounded-lg border-2 border-line-subtle bg-white px-1 py-1 text-xs font-bold text-slate-500 shadow-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="h-6 w-6 rounded hover:bg-slate-100"
            onClick={() => setZoom(view.zoom / 1.2)}
          >
            −
          </button>
          <button
            className="w-12 rounded hover:bg-slate-100"
            onClick={() => setZoom(1)}
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <button
            className="h-6 w-6 rounded hover:bg-slate-100"
            onClick={() => setZoom(view.zoom * 1.2)}
          >
            +
          </button>
        </div>
        <div className="h-full w-full">
          <div
            ref={surfaceRef}
            className="absolute left-0 top-0 origin-top-left [background-size:24px_24px]"
            style={{
              width: WORLD_W,
              height: WORLD_H,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              backgroundImage: showGrid
                ? `radial-gradient(circle, ${GRID_DOT_COLOR} 1px, transparent 1px)`
                : undefined,
            }}
          >
            {/* Lines render behind elements; handles + labels render above (after the cards). */}
            <ConnectionLines
              lines={connLines}
              temp={
                linking && linkEnd
                  ? {
                      from:
                        sizedElements.find((e) => e.id === linking.from) ??
                        null,
                      end: linkEnd,
                      target: linkTarget
                        ? (sizedElements.find((e) => e.id === linkTarget) ??
                          null)
                        : null,
                    }
                  : null
              }
              readOnly={readOnly}
              selectedId={selectedConn}
              onSelect={(id) => {
                setSelectedConn(id);
                setSelectedIds([]);
                setEditingId(null);
              }}
            />
            <LineLayer
              geo={lineGeo}
              draw={
                lineDraw
                  ? {
                      a: { x: lineDraw.a.x, y: lineDraw.a.y },
                      b: { x: lineDraw.b.x, y: lineDraw.b.y },
                    }
                  : null
              }
              readOnly={readOnly}
              selectedId={selectedLine}
              onSelect={(id) => {
                setSelectedLine(id);
                setSelectedIds([]);
                setSelectedConn(null);
                setEditingId(null);
              }}
            />
            {topElements.map((el) => renderElementCard(el, false))}
            {/* Highlight the element a connection drag would land on. */}
            {linkTarget &&
              (() => {
                const t = sizedElements.find((e) => e.id === linkTarget);
                return t ? (
                  <div
                    className="pointer-events-none absolute z-[6] rounded-lg border-2 border-primary bg-primary/5"
                    style={{
                      left: t.x - 3,
                      top: t.y - 3,
                      width: t.w + 6,
                      height: t.h + 6,
                    }}
                  />
                ) : null;
              })()}
            <ConnectionOverlay
              lines={connLines}
              zoom={view.zoom}
              readOnly={readOnly}
              selectedId={selectedConn}
              editingId={editingConnLabel}
              onSelect={(id) => {
                setSelectedConn(id);
                setSelectedIds([]);
                setEditingId(null);
              }}
              onEndpointDown={startEndpointDrag}
              onBendDown={startBendDrag}
              onBendReset={(id) => patchConnection(id, { bend: undefined })}
              onLabelCommit={(id, label) => {
                setConnectionLabel(id, label);
                setEditingConnLabel(null);
              }}
            />
            <LineOverlay
              geo={lineGeo}
              zoom={view.zoom}
              readOnly={readOnly}
              selectedId={selectedLine}
              editingId={editingLineLabel}
              snapPt={snapPt}
              onSelect={(id) => {
                setSelectedLine(id);
                setSelectedIds([]);
                setSelectedConn(null);
              }}
              onEndpointDown={startLineEndpointDrag}
              onBendDown={startLineBendDrag}
              onBendReset={(id) => patchLine(id, { bend: undefined })}
              onLabelCommit={(id, label) => {
                setLineLabel(id, label);
                setEditingLineLabel(null);
              }}
            />
            {peers.map((p) => (
              <PeerCursor key={p.clientId} peer={p} zoom={view.zoom} />
            ))}
          </div>
        </div>
      </div>
      <CommentsPanel
        boardId={boardId}
        open={showComments}
        signal={commentSignal}
        onClose={() => {
          setShowComments(false);
          showCommentsRef.current = false;
        }}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.ids)}
          onClose={() => setMenu(null)}
        />
      )}

      {/* Detached preview of a column child following the cursor while dragging it out. */}
      {childDragGhost && elementsById.get(childDragGhost.id) && (
        <div
          className="pointer-events-none fixed z-[120] w-60 -translate-x-1/2 -translate-y-1/2 opacity-80 drop-shadow-xl"
          style={{ left: childDragGhost.cx, top: childDragGhost.cy }}
        >
          {renderElementCard(elementsById.get(childDragGhost.id)!, true)}
        </div>
      )}
    </div>
  );
}
