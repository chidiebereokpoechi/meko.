import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardConnection, type ConnStatus, type Peer } from "../lib/board.ts";
import { resolveMedia } from "../lib/media.ts";
import type { Connection, Element, LineShape, TodoItem } from "../types.ts";
import { ContextMenu, Icon, type MenuItem } from "./kit/index.ts";
import { type Tool } from "./layout/ToolRail.tsx";
import { SelectionRail } from "./canvas/SelectionRail.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { type ActiveEditor } from "./EditableNote.tsx";
import { GRID_DOT_COLOR, WORLD_H, WORLD_W } from "./canvas/constants.ts";
import {
  ConnectionLines,
  ConnectionOverlay,
  LineLayer,
  LineOverlay,
  PeerCursor,
} from "./canvas/render.tsx";
import { CanvasModals } from "./canvas/CanvasModals.tsx";
import { CanvasChrome } from "./canvas/CanvasChrome.tsx";
import { serializeElements } from "./canvas/clipboard.ts";
import { ElementCard } from "./canvas/ElementCard.tsx";
import { useViewport } from "./canvas/useViewport.ts";
import { useEdges } from "./canvas/useEdges.ts";
import { useColumns } from "./canvas/useColumns.ts";
import { useImport } from "./canvas/useImport.ts";

// Latest-render implementations of every per-card action. Re-captured on each render; the
// `stable` wrappers (useMemo below) delegate through this ref so memoised ElementCards keep ONE
// callback identity for the whole session — fresh closures per render would defeat React.memo.
type CardActions = {
  selectId: (id: string) => void;
  toggleSelect: (id: string) => void;
  openMenu: (id: string, e: React.MouseEvent) => void;
  edit: (id: string) => void;
  moveElement: (id: string, x: number, y: number) => void;
  patch: (id: string, p: Partial<Element>) => void;
  openElement: (id: string) => void;
  captionFocus: (id: string) => void;
  consumeFresh: () => void;
  toggleCollapse: (id: string) => void;
  startLink: (id: string, e: React.PointerEvent) => void;
  startColumnChildDrag: (id: string, e: React.PointerEvent) => void;
  renderColumnChild: (cid: string) => React.ReactNode;
  handleDragMove: (id: string, x: number, y: number) => void;
  handleDragRelease: (id: string, x: number, y: number) => void;
  handleDragCancel: () => void;
};

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
  const onRegisterEditor = useCallback((e: ActiveEditor | null) => {
    editorRef.current = e;
  }, []);
  const savedRange = useRef<Range | null>(null);
  const [, setTick] = useState(0);
  // Pan/zoom viewport state + helpers (toWorld, clamping, wheel/space) live in useViewport.
  // `view` is the committed (post-gesture) state; mid-gesture reads go through viewRef.
  const {
    view,
    viewRef,
    panRef,
    spaceRef,
    toWorld,
    viewportCentre,
    setViewClamped,
    commitView,
    setZoom,
    resetView,
    zoomToFit,
  } = useViewport(viewportRef, surfaceRef);
  // One stable callback set shared by every ElementCard (see CardActions above).
  const latestRef = useRef<CardActions>(null!);
  const stable = useMemo(
    () => ({
      onSelect: (id: string) => latestRef.current.selectId(id),
      onToggleSelect: (id: string) => latestRef.current.toggleSelect(id),
      onContextMenu: (id: string, e: React.MouseEvent) =>
        latestRef.current.openMenu(id, e),
      onEdit: (id: string) => latestRef.current.edit(id),
      onMove: (id: string, x: number, y: number) =>
        latestRef.current.moveElement(id, x, y),
      onResize: (id: string, w: number, h: number) =>
        latestRef.current.patch(id, { w, h }),
      onText: (id: string, text: string) =>
        latestRef.current.patch(id, { text } as Partial<Element>),
      onOpen: (id: string) => latestRef.current.openElement(id),
      onCaption: (id: string, caption: string) =>
        latestRef.current.patch(id, { caption } as Partial<Element>),
      onCaptionFocus: (id: string) => latestRef.current.captionFocus(id),
      onTodo: (id: string, p: { title?: string; items?: TodoItem[] }) =>
        latestRef.current.patch(id, p as Partial<Element>),
      onStartLink: (id: string, e: React.PointerEvent) =>
        latestRef.current.startLink(id, e),
      onConsumeFresh: () => latestRef.current.consumeFresh(),
      onEmbeddedDragStart: (id: string, e: React.PointerEvent) =>
        latestRef.current.startColumnChildDrag(id, e),
      onColumnTitle: (id: string, title: string) =>
        latestRef.current.patch(id, { title } as Partial<Element>),
      onToggleCollapse: (id: string) => latestRef.current.toggleCollapse(id),
      renderColumnChild: (cid: string) =>
        latestRef.current.renderColumnChild(cid),
      onDragMove: (id: string, cx: number, cy: number) =>
        latestRef.current.handleDragMove(id, cx, cy),
      onDragRelease: (id: string, cx: number, cy: number) =>
        latestRef.current.handleDragRelease(id, cx, cy),
      onDragCancel: () => latestRef.current.handleDragCancel(),
    }),
    [],
  );
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overDelete, setOverDelete] = useState(false);
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
    // Coalesce Yjs change bursts (a remote transaction, a multi-element drag) into one render per
    // animation frame instead of one per observed change.
    let bumpRaf = 0;
    const bump = () => {
      if (bumpRaf) return;
      bumpRaf = requestAnimationFrame(() => {
        bumpRaf = 0;
        setTick((t) => t + 1);
      });
    };
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
      if (bumpRaf) cancelAnimationFrame(bumpRaf);
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
  // Next stacking z (above everything). Defined early so the hooks below can place new elements.
  const nextZ = () => Math.max(0, ...elements.map((e) => e.z ?? 0)) + 1;
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
    cancelLineDraw,
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
  // Columns (nesting): drop-target highlight, drag ghost, and reparent/extract/drag/group ops.
  const {
    colDrop,
    setColDrop,
    childDragGhost,
    columnDropAt,
    moveChildToColumn,
    startColumnChildDrag,
    groupIntoColumn,
  } = useColumns({
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
  });
  const handleDragMove = (id: string, x: number, y: number) => {
    setDraggingId(id);
    setOverDelete(overDeleteZone(x, y));
    // A non-column element dragged over a column previews where it'd drop. Keep the previous
    // object when the target hasn't changed, so the (frequent) drag flushes don't re-render.
    const next =
      elementsById.get(id)?.type === "column" ? null : columnDropAt(x, y, id);
    setColDrop((prev) =>
      prev?.colId === next?.colId && prev?.index === next?.index ? prev : next,
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
  // Esc during a card move: the card reverts its own position; clear the canvas drag affordances.
  const handleDragCancel = () => {
    setDraggingId(null);
    setOverDelete(false);
    setColDrop(null);
  };
  // Open a card's destination (alt-/double-click): a link opens its URL, a board navigates.
  const openElement = (id: string) => {
    const e = elementsById.get(id);
    if (e?.type === "link") window.open(e.url, "_blank", "noopener,noreferrer");
    else if (e?.type === "board") onOpenBoard(e.boardId);
  };
  const captionFocus = (id: string) => {
    selectId(id);
    setCaptionEditing(true);
  };
  const toggleCollapse = (id: string) => {
    const e = connRef.current?.elements.get(id);
    if (e?.type === "column")
      patch(id, { collapsed: !e.collapsed } as Partial<Element>);
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

  // Copy/cut handling. With elements selected (and not editing text), copy them to the internal
  // clipboard and preventDefault — this stops the browser from copying a selected image's caption
  // text, and paste then duplicates the element (see useImport's paste listener). Any OTHER copy
  // (text selection, editing a field) clears the internal clipboard, so the next paste falls back to
  // the OS clipboard — i.e. copying real text after copying an element pastes the text again.
  useEffect(() => {
    const editableTarget = () => {
      const ae = document.activeElement as HTMLInputElement | null;
      return !!(
        ae &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA"
          ? !ae.readOnly && !ae.disabled
          : ae.isContentEditable)
      );
    };
    const elementCopy = () =>
      !readOnly && !editingId && !editableTarget() && selectedIds.length > 0;
    // Copy elements to the internal clipboard AND the OS clipboard (so they paste into another
    // board/tab), then preventDefault so the browser doesn't copy a selected image's caption text.
    const writeOsClipboard = (e: ClipboardEvent) => {
      const { html, text } = serializeElements(clipboardRef.current);
      e.clipboardData?.setData("text/html", html);
      e.clipboardData?.setData("text/plain", text);
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!elementCopy()) return void (clipboardRef.current = []);
      copyEls(selectedIds);
      writeOsClipboard(e);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (!elementCopy()) return void (clipboardRef.current = []);
      copyEls(selectedIds);
      writeOsClipboard(e);
      removeMany(selectedIds);
      e.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, editingId, readOnly]);

  // Esc cancels an in-progress marquee or line-draw. (The pointer drags that use window listeners —
  // element move, tool placement, column-child, arrow/line endpoints — handle their own Esc via
  // startPointerDrag.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (marqueeRef.current || marquee) {
        marqueeRef.current = null;
        setMarquee(null);
      }
      if (lineDraw) cancelLineDraw();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marquee, lineDraw]);

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

  // Publish the full control set whenever undo state or the view changes (the undo events feed
  // canUndo/canRedo above; zoom/grid come from local state).
  useEffect(() => {
    onControls({
      undo: () => connRef.current?.undo(),
      redo: () => connRef.current?.redo(),
      canUndo,
      canRedo,
      exportPng: () => onExport(),
      zoomIn: () => setZoom(viewRef.current.zoom * 1.2),
      zoomOut: () => setZoom(viewRef.current.zoom / 1.2),
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
    // Release keyboard focus trapped in an activated embed iframe so key handlers work again.
    if (document.activeElement instanceof HTMLIFrameElement)
      document.activeElement.blur();
    if (armLine) {
      // Line tool armed: press = start point (snapped), drag to end.
      beginLineDraw(e.clientX, e.clientY);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (spaceRef.current || e.button === 1) {
      // Anchor on the LIVE view (viewRef) — committed `view` state can lag a gesture.
      const v = viewRef.current;
      panRef.current = { cx: e.clientX, cy: e.clientY, px: v.x, py: v.y };
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
    if (panRef.current) {
      panRef.current = null;
      commitView(); // pan moved the surface via the DOM only — sync React state now
    }
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

  // Copy elements (deep, with column children) into the internal clipboard. Defined before useImport
  // so the paste listener there can prefer internal elements over the OS clipboard.
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
  // Paste a list of elements with fresh ids near (x,y), remapping column children. The source can be
  // the internal clipboard (same-app) or elements deserialized from the OS clipboard (another tab).
  const pasteElements = (clip: Element[], x: number, y: number) => {
    const c = connRef.current;
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
  const pasteEls = (x: number, y: number) =>
    pasteElements(clipboardRef.current, x, y);

  // Content creation + import: create tools (note/todo/column + drag-place), and all drop/paste/URL/
  // image/embed/board/link flows with their dialogs. Owns the dialog/choice state and the busy flag.
  const {
    busy,
    linkModal,
    setLinkModal,
    boardModal,
    setBoardModal,
    embedModal,
    setEmbedModal,
    urlChoice,
    setUrlChoice,
    embedChoice,
    setEmbedChoice,
    createNote,
    createTodo,
    createColumn,
    startPlace,
    cancelFill,
    pickImageAt,
    createBoardElement,
    createEmbed,
    createLink,
    applyUrlChoice,
    applyEmbedChoice,
    onPickImage,
    onExport,
    onDrop: importDrop,
  } = useImport({
    connRef,
    boardId,
    workspaceId,
    toWorld,
    viewportCentre,
    readOnly,
    editingId,
    nextZ,
    patch,
    selectNew,
    setEditingId,
    setDraggingId,
    setColDrop,
    columnDropAt,
    moveChildToColumn,
    setMediaUrls,
    fileRef,
    fillRef,
    dropCoords,
    pasteElements,
  });

  // --- Context-menu actions ---
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
  // All callbacks come from `stable` (one identity for the whole session, id-taking) so the
  // memoised ElementCard only re-renders when its data props actually change.
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
      onRegister={onRegisterEditor}
      onSize={reportHeight}
      freshlyCreated={justCreated === el.id}
      readOnly={readOnly}
      colDropIndex={
        el.type === "column" && colDrop?.colId === el.id
          ? colDrop.index
          : undefined
      }
      shrink={draggingId === el.id && overDelete}
      dragging={draggingId === el.id}
      anyDragging={draggingId !== null}
      zoom={view.zoom}
      toWorld={toWorld}
      {...stable}
    />
  );
  // Resolve + render a column's child element (embedded).
  const renderColumnChild = (childId: string) => {
    const child = elementsById.get(childId);
    return child ? renderElementCard(child, true) : null;
  };
  // Re-point the stable wrappers at this render's implementations.
  latestRef.current = {
    selectId,
    toggleSelect,
    openMenu,
    edit: (id) => setEditingId(id),
    moveElement,
    patch,
    openElement,
    captionFocus,
    consumeFresh: () => setJustCreated(null),
    toggleCollapse,
    startLink,
    startColumnChildDrag,
    renderColumnChild,
    handleDragMove,
    handleDragRelease,
    handleDragCancel,
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
      <CanvasModals
        fileRef={fileRef}
        onPickImage={onPickImage}
        linkModal={linkModal}
        boardModal={boardModal}
        embedModal={embedModal}
        setLinkModal={setLinkModal}
        setBoardModal={setBoardModal}
        setEmbedModal={setEmbedModal}
        cancelFill={cancelFill}
        createLink={createLink}
        createBoardElement={createBoardElement}
        createEmbed={createEmbed}
        urlChoice={urlChoice}
        embedChoice={embedChoice}
        applyUrlChoice={applyUrlChoice}
        applyEmbedChoice={applyEmbedChoice}
        setUrlChoice={setUrlChoice}
        setEmbedChoice={setEmbedChoice}
      />

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
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          importDrop(e);
        }}
      >
        <CanvasChrome
          status={status}
          showComments={showComments}
          unreadComments={unreadComments}
          onToggleComments={() => {
            const next = !showComments;
            setShowComments(next);
            showCommentsRef.current = next;
            if (next) setUnreadComments(false);
          }}
          dragOver={dragOver}
          marquee={marquee}
          zoom={view.zoom}
          onZoom={setZoom}
        />
        <div className="h-full w-full">
          <div
            ref={surfaceRef}
            className="absolute left-0 top-0 origin-top-left [background-size:24px_24px]"
            // The pan/zoom transform is written imperatively by useViewport (per gesture event,
            // no React render) — never set it here or a mid-gesture render would snap it back.
            style={{
              width: WORLD_W,
              height: WORLD_H,
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
