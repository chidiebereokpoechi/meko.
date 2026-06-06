import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BoardConnection, type ConnStatus, type Peer } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import { type Unfurl, unfurlLink } from "../lib/links.ts";
import { api } from "../lib/api.ts";
import { embedDefaultSize, embedHeightFor, embeddableUrl, extractIframeSrc, faviconUrl } from "../lib/embed.ts";
import type { AnchorKey, Board, Connection, Element, LineEndpoint, LineShape, TodoItem } from "../types.ts";
import { Badge, Button, Icon, Modal, toast } from "./kit/index.ts";
import { ToolRail, type Tool } from "./layout/ToolRail.tsx";
import { NoteSubRail } from "./NoteSubRail.tsx";
import { LinkSubRail } from "./LinkSubRail.tsx";
import { ImageSubRail } from "./ImageSubRail.tsx";
import { CommonSubRail } from "./CommonSubRail.tsx";
import { TodoSubRail } from "./TodoSubRail.tsx";
import { BoardSubRail } from "./BoardSubRail.tsx";
import { ConnectionSubRail } from "./ConnectionSubRail.tsx";
import { EmbedSubRail } from "./EmbedSubRail.tsx";
import { ColumnSubRail } from "./ColumnSubRail.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { NameModal } from "./NameModal.tsx";
import { EditableNote, type ActiveEditor } from "./EditableNote.tsx";
import { sanitizeHtml } from "../lib/sanitize.ts";

const WORLD_W = 4000;
const WORLD_H = 3000;
// Remembered choice for a dropped URL that could be an image or a link card (localStorage).
const URL_CHOICE_KEY = "meko.urlDropChoice";
// Remembered choice for an embeddable provider URL: "link" (with preview) or "embed".
const EMBED_CHOICE_KEY = "meko.embedDropChoice";

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
  const fillRef = useRef<{ id: string; kind: "image" | "link" | "embed" | "board" } | null>(null);
  const editorRef = useRef<ActiveEditor | null>(null);
  const savedRange = useRef<Range | null>(null);
  const panRef = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const [, setTick] = useState(0);
  // Pan offset (screen px) + zoom applied to the world via CSS transform.
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
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
  const [boardModal, setBoardModal] = useState<{ x: number; y: number } | null>(null);
  const [embedModal, setEmbedModal] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Marquee selection rectangle in screen coords while dragging empty canvas.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeRef = useRef<{ x0: number; y0: number; additive: boolean } | null>(null);
  const spaceRef = useRef(false); // space held → drag pans instead of marquees
  const [captionEditing, setCaptionEditing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [showComments, setShowComments] = useState(false);
  const showCommentsRef = useRef(false);
  const [commentSignal, setCommentSignal] = useState(0);
  const [unreadComments, setUnreadComments] = useState(false);
  const [urlChoice, setUrlChoice] = useState<{ u: Unfurl; url: string; at: { x: number; y: number } } | null>(null);
  const [embedChoice, setEmbedChoice] = useState<{ url: string; embed: string; at: { x: number; y: number } } | null>(null);
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
  // In-progress arrow drag from an element's connect ball; linkEnd is the live pointer (world).
  const [linking, setLinking] = useState<{ from: string } | null>(null);
  const [linkEnd, setLinkEnd] = useState<{ x: number; y: number } | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null); // hovered valid drop element
  const [selectedConn, setSelectedConn] = useState<string | null>(null);
  // Inline label editing + live endpoint reassignment for the selected connection.
  const [editingConnLabel, setEditingConnLabel] = useState<string | null>(null);
  const [connDrag, setConnDrag] = useState<{ id: string; which: "from" | "to"; pos: { x: number; y: number } } | null>(null);
  // Standalone line tool: arm (tool clicked), in-progress draw, selection, endpoint drag, label.
  const [armLine, setArmLine] = useState(false);
  const [lineDraw, setLineDraw] = useState<{ a: LineEndpoint; b: LineEndpoint } | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [lineDrag, setLineDrag] = useState<{ id: string; which: "a" | "b"; ep: LineEndpoint } | null>(null);
  const [editingLineLabel, setEditingLineLabel] = useState<string | null>(null);
  // Live column drop target (highlight + insertion index) while dragging a card.
  const [colDrop, setColDrop] = useState<{ colId: string; index: number } | null>(null);

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
  for (const e of elements) if (e.type === "column") for (const cid of e.children) childToCol.set(cid, e.id);
  const topElements = elements.filter((e) => !childToCol.has(e.id));
  const connections: Connection[] = connRef.current
    ? Array.from(connRef.current.connections.values())
    : [];
  // Auto-height elements (todo/link/image) don't keep el.h in sync with their rendered height, so
  // connection endpoints would miss. Use measured heights for connection geometry.
  const sizedElements = elements.map((e) => ({ ...e, h: cardHeights[e.id] ?? e.h }));
  const connLines = computeLines(sizedElements, connections, connDrag);
  const lines: LineShape[] = connRef.current ? Array.from(connRef.current.lines.values()) : [];
  const lineGeo = computeLineGeo(lines, sizedElements, lineDrag);
  // Snap indicator ring while drawing or dragging an endpoint onto an element anchor.
  const snapPt = lineDraw?.b.elementId ? { x: lineDraw.b.x, y: lineDraw.b.y } : lineDrag?.ep.elementId ? { x: lineDrag.ep.x, y: lineDrag.ep.y } : null;
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
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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

  // --- Connections (arrows between elements) ---
  const addConnection = (from: string, to: string) => {
    const c = connRef.current;
    if (!c || from === to) return;
    // Avoid duplicate arrows in the same direction.
    if (Array.from(c.connections.values()).some((cn) => cn.from === from && cn.to === to)) return;
    const id = crypto.randomUUID();
    c.connections.set(id, { id, from, to, arrowEnd: true });
  };
  const removeConnection = (id: string) => {
    connRef.current?.connections.delete(id);
    setSelectedConn((s) => (s === id ? null : s));
  };
  const setConnectionLabel = (id: string, label: string) => {
    const c = connRef.current;
    const cur = c?.connections.get(id);
    if (c && cur) c.connections.set(id, { ...cur, label: label || undefined });
  };
  const patchConnection = (id: string, p: Partial<Connection>) => {
    const c = connRef.current;
    const cur = c?.connections.get(id);
    if (c && cur) c.connections.set(id, { ...cur, ...p });
  };

  // --- Standalone lines ---
  const patchLine = (id: string, p: Partial<LineShape>) => {
    const c = connRef.current;
    const cur = c?.lines.get(id);
    if (c && cur) c.lines.set(id, { ...cur, ...p });
  };
  const removeLine = (id: string) => {
    connRef.current?.lines.delete(id);
    setSelectedLine((s) => (s === id ? null : s));
  };
  const setLineLabel = (id: string, label: string) => patchLine(id, { label: label || undefined });

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
  const remove = (id: string) => {
    const c = connRef.current;
    const all = withColumnChildren([id]);
    c?.doc.transact(() => {
      all.forEach((x) => c.elements.delete(x));
      pruneConnections(all);
    });
    setSelectedIds((ids) => ids.filter((x) => !all.has(x)));
    setEditingId((s) => (s && all.has(s) ? null : s));
  };
  const removeMany = (ids: string[]) => {
    const c = connRef.current;
    const all = withColumnChildren(ids);
    c?.doc.transact(() => {
      all.forEach((id) => c.elements.delete(id));
      pruneConnections(all);
    });
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
  const columnDropAt = (clientX: number, clientY: number, excludeId?: string): { colId: string; index: number } | null => {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-column-id]"))) {
      const colId = node.getAttribute("data-column-id")!;
      if (colId === excludeId) continue;
      const r = node.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
      const kids = Array.from(node.querySelectorAll<HTMLElement>("[data-col-child]"));
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
    setColDrop(elementsById.get(id)?.type === "column" ? null : columnDropAt(x, y, id));
  };
  // Drop over Delete removes; over a column reparents; otherwise just ends the drag. Operates on the
  // whole selection when the dragged element is part of a multi-selection.
  const handleDragRelease = (id: string, x: number, y: number) => {
    const targets = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id];
    if (overDeleteZone(x, y)) {
      removeMany(targets);
    } else {
      const drop = columnDropAt(x, y, id);
      if (drop) {
        const movables = targets.filter((t) => elementsById.get(t)?.type !== "column");
        movables.forEach((t, i) => moveChildToColumn(t, drop.colId, drop.index + i));
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
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable)
      )
        return;
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

  // Screen point → world coords. The world's bounding rect already reflects the pan/zoom transform,
  // so dividing the offset by zoom yields world coordinates.
  const toWorld = (clientX: number, clientY: number) => {
    const r = surfaceRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (clientX - r.left) / view.zoom, y: (clientY - r.top) / view.zoom };
  };

  // Drag from an element's connect ball: track the pointer (world), and on release wire an arrow
  // to whatever element sits under the cursor.
  // A valid drop target: topmost element under the point that isn't the source and isn't already
  // connected from the source in that direction.
  const linkTargetAt = (w: { x: number; y: number }, from: string): string | null => {
    const el = [...sizedElements].reverse().find((e) => e.id !== from && w.x >= e.x && w.x <= e.x + e.w && w.y >= e.y && w.y <= e.y + e.h);
    if (!el) return null;
    const dup = Array.from(connRef.current?.connections.values() ?? []).some((cn) => cn.from === from && cn.to === el.id);
    return dup ? null : el.id;
  };
  const startLink = (from: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    setLinking({ from });
    setLinkEnd(toWorld(e.clientX, e.clientY));
    const move = (ev: PointerEvent) => {
      const w = toWorld(ev.clientX, ev.clientY);
      setLinkEnd(w);
      setLinkTarget(linkTargetAt(w, from));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const target = linkTargetAt(toWorld(ev.clientX, ev.clientY), from);
      if (target) addConnection(from, target);
      setLinking(null);
      setLinkEnd(null);
      setLinkTarget(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag a card that lives inside a column: reorder within, move to another column, or pop it out
  // onto the canvas. A press without movement just selects it.
  const startColumnChildDrag = (childId: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true;
      setDraggingId(childId);
      setColDrop(columnDropAt(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraggingId(null);
      setColDrop(null);
      if (!moved) {
        selectId(childId);
        return;
      }
      const targets = selectedIds.includes(childId) && selectedIds.length > 1 ? selectedIds.filter((tid) => childToCol.has(tid)) : [childId];
      const drop = columnDropAt(ev.clientX, ev.clientY);
      if (drop) targets.forEach((t, i) => moveChildToColumn(t, drop.colId, drop.index + i));
      else {
        const w = toWorld(ev.clientX, ev.clientY);
        targets.forEach((t, i) => extractChild(t, w.x, w.y + i * 24));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag a selected connection's endpoint to re-anchor it: the endpoint follows the cursor, and on
  // release it reassigns to whatever element is under the pointer (must differ from the other end).
  const startEndpointDrag = (id: string, which: "from" | "to", e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    setConnDrag({ id, which, pos: toWorld(e.clientX, e.clientY) });
    const move = (ev: PointerEvent) => setConnDrag({ id, which, pos: toWorld(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const w = toWorld(ev.clientX, ev.clientY);
      const cn = connRef.current?.connections.get(id);
      const target = [...sizedElements].reverse().find((el) => w.x >= el.x && w.x <= el.x + el.w && w.y >= el.y && w.y <= el.y + el.h);
      if (cn && target) {
        const other = which === "from" ? cn.to : cn.from;
        if (target.id !== other) patchConnection(id, { [which]: target.id });
      }
      setConnDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag the midpoint handle to curve the line; releasing near the straight midpoint snaps it back.
  const startBendDrag = (id: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    const apply = (clientX: number, clientY: number) => {
      const c = connRef.current;
      const cn = c?.connections.get(id);
      const from = elements.find((el) => el.id === cn?.from);
      const to = elements.find((el) => el.id === cn?.to);
      if (!cn || !from || !to) return;
      const mid = { x: (from.x + from.w / 2 + to.x + to.w / 2) / 2, y: (from.y + from.h / 2 + to.y + to.h / 2) / 2 };
      const w = toWorld(clientX, clientY);
      // ctrl ≈ 2*(handle - mid) so the curve's midpoint tracks the cursor.
      const bend = { x: 2 * (w.x - mid.x), y: 2 * (w.y - mid.y) };
      patchConnection(id, { bend: Math.hypot(bend.x, bend.y) < 8 ? undefined : bend });
    };
    const move = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Snap a pointer position to the nearest element anchor (corner / edge-mid / centre), else free.
  const snapEndpoint = (clientX: number, clientY: number): LineEndpoint => {
    const w = toWorld(clientX, clientY);
    const hit = nearestAnchor(w, sizedElements, 12 / view.zoom);
    return hit ? { x: hit.pt.x, y: hit.pt.y, elementId: hit.elementId, anchor: hit.anchor } : { x: w.x, y: w.y };
  };
  // Drag a line endpoint: it follows the cursor and snaps/pins to an element anchor on release.
  const startLineEndpointDrag = (id: string, which: "a" | "b", e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    setLineDrag({ id, which, ep: snapEndpoint(e.clientX, e.clientY) });
    const move = (ev: PointerEvent) => setLineDrag({ id, which, ep: snapEndpoint(ev.clientX, ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      patchLine(id, { [which]: snapEndpoint(ev.clientX, ev.clientY) });
      setLineDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Bend a line by dragging its midpoint handle (quadratic control); snaps back near straight.
  const startLineBendDrag = (id: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    const byId = new Map(sizedElements.map((el) => [el.id, el]));
    const apply = (clientX: number, clientY: number) => {
      const ln = connRef.current?.lines.get(id);
      if (!ln) return;
      const a = resolveEnd(ln.a, byId);
      const b = resolveEnd(ln.b, byId);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const w = toWorld(clientX, clientY);
      const bend = { x: 2 * (w.x - mid.x), y: 2 * (w.y - mid.y) };
      patchLine(id, { bend: Math.hypot(bend.x, bend.y) < 8 ? undefined : bend });
    };
    const move = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const viewportCentre = () => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return { x: 200, y: 200 };
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return { x: c.x - 110, y: c.y - 60 };
  };

  // --- Pan & zoom ---
  const clampZoom = (z: number) => Math.min(3, Math.max(0.2, z));
  // Clamp pan so the world can't be dragged out of view: world edges stay flush to the viewport;
  // when the world is smaller than the viewport (zoomed out) it's centred.
  const clampView = (v: { x: number; y: number; zoom: number }) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return v;
    const axis = (pos: number, world: number, viewSize: number) =>
      world <= viewSize ? (viewSize - world) / 2 : Math.min(0, Math.max(viewSize - world, pos));
    return { zoom: v.zoom, x: axis(v.x, WORLD_W * v.zoom, vp.width), y: axis(v.y, WORLD_H * v.zoom, vp.height) };
  };
  const setViewClamped = (fn: (v: typeof view) => typeof view) => setView((v) => clampView(fn(v)));

  // Zoom toward a screen point, keeping that point fixed in world space.
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return;
    setViewClamped((v) => {
      const z = clampZoom(v.zoom * factor);
      const k = z / v.zoom;
      const px = clientX - r.left;
      const py = clientY - r.top;
      return { zoom: z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };
  const setZoom = (z: number) => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, clampZoom(z) / view.zoom);
  };

  // --- View options (surfaced to the top bar's View menu) ---
  const resetView = () => setView(clampView({ zoom: 1, x: 0, y: 0 }));
  const zoomToFit = () => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp || elements.length === 0) return resetView();
    const minX = Math.min(...elements.map((e) => e.x));
    const minY = Math.min(...elements.map((e) => e.y));
    const maxX = Math.max(...elements.map((e) => e.x + e.w));
    const maxY = Math.max(...elements.map((e) => e.y + e.h));
    const pad = 80;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const zoom = clampZoom(Math.min((vp.width - pad * 2) / bw, (vp.height - pad * 2) / bh));
    setView(clampView({ zoom, x: (vp.width - bw * zoom) / 2 - minX * zoom, y: (vp.height - bh * zoom) / 2 - minY * zoom }));
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
      zoomToFit,
      toggleGrid: () => setShowGrid((g) => !g),
      gridOn: showGrid,
      zoomPct: Math.round(view.zoom * 100),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, view.zoom, showGrid, boardId]);

  // Wheel: ⌘/Ctrl (or pinch) zooms toward the cursor; otherwise pans. Native listener so we can
  // preventDefault (React's onWheel is passive).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      else setViewClamped((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [view.zoom]);

  // Track Space to switch empty-drag from marquee to pan.
  useEffect(() => {
    const set = (down: boolean) => (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = down;
    };
    const d = set(true);
    const u = set(false);
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, []);

  // Empty-canvas drag: Space/middle-button pans; otherwise draws a marquee selection.
  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (armLine) {
      // Line tool armed: press = start point (snapped), drag to end.
      const a = snapEndpoint(e.clientX, e.clientY);
      setLineDraw({ a, b: a });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (spaceRef.current || e.button === 1) {
      panRef.current = { cx: e.clientX, cy: e.clientY, px: view.x, py: view.y };
    } else {
      marqueeRef.current = { x0: e.clientX, y0: e.clientY, additive: e.metaKey || e.ctrlKey || e.shiftKey };
      setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onViewportPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    connRef.current?.sendCursor(w.x, w.y);
    if (lineDraw) {
      setLineDraw((d) => (d ? { a: d.a, b: snapEndpoint(e.clientX, e.clientY) } : d));
      return;
    }
    const p = panRef.current;
    if (p) {
      setViewClamped((v) => ({ ...v, x: p.px + e.clientX - p.cx, y: p.py + e.clientY - p.cy }));
      return;
    }
    const m = marqueeRef.current;
    if (m) setMarquee({ x0: m.x0, y0: m.y0, x1: e.clientX, y1: e.clientY });
  };
  const onViewportPointerUp = () => {
    if (lineDraw) {
      // Commit the drawn line if it has length; otherwise discard a stray click.
      const len = Math.hypot(lineDraw.b.x - lineDraw.a.x, lineDraw.b.y - lineDraw.a.y);
      if (len > 8) {
        const c = connRef.current;
        if (c) {
          const id = crypto.randomUUID();
          c.lines.set(id, { id, a: lineDraw.a, b: lineDraw.b, arrowStart: false, arrowEnd: false });
          setSelectedLine(id);
          setSelectedIds([]);
          setSelectedConn(null);
        }
      }
      setLineDraw(null);
      setArmLine(false);
      return;
    }
    panRef.current = null;
    const m = marqueeRef.current;
    marqueeRef.current = null;
    if (!m) return;
    if (!marquee) return;
    const moved = Math.abs(marquee.x1 - marquee.x0) + Math.abs(marquee.y1 - marquee.y0) > 4;
    if (!moved) {
      if (!m.additive) deselect(); // a click on empty canvas (keep selection when modifier held)
    } else {
      // Select TOP-LEVEL elements intersecting the marquee (column children have stale x/y and live
      // inside their column, so they're excluded). Cmd/Ctrl/Shift adds to the current selection.
      const a = toWorld(Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1));
      const b = toWorld(Math.max(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1));
      const hits = topElements.filter((el) => el.x < b.x && el.x + el.w > a.x && el.y < b.y && el.y + el.h > a.y).map((el) => el.id);
      setSelectedIds((prev) => (m.additive ? Array.from(new Set([...prev, ...hits])) : hits));
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
    });
    selectNew(id);
  };

  const createColumn = (x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, { id, type: "column", x, y, w: 280, h: 120, title: "", children: [], style: { fill: "#ffffff" } });
    selectNew(id);
  };

  // --- Column reparenting (one transaction so it's a single undo step) ---
  const moveChildToColumn = (childId: string, colId: string, index: number) => {
    const c = connRef.current;
    if (!c) return;
    c.doc.transact(() => {
      for (const e of c.elements.values()) {
        if (e.type === "column" && e.children.includes(childId) && e.id !== colId) {
          c.elements.set(e.id, { ...e, children: e.children.filter((id) => id !== childId) });
        }
      }
      const col = c.elements.get(colId);
      if (col?.type !== "column") return;
      const next = col.children.filter((id) => id !== childId);
      next.splice(Math.max(0, Math.min(index, next.length)), 0, childId);
      c.elements.set(colId, { ...col, children: next });
    });
  };
  // Pop a child out of its column to a free position on the canvas.
  const extractChild = (childId: string, x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    c.doc.transact(() => {
      for (const e of c.elements.values()) {
        if (e.type === "column" && e.children.includes(childId)) {
          c.elements.set(e.id, { ...e, children: e.children.filter((id) => id !== childId) });
        }
      }
      const child = c.elements.get(childId);
      if (child) c.elements.set(childId, { ...child, x, y });
    });
  };

  // Press-and-drag from a tool: spawn the default/placeholder element under the cursor; it follows
  // until release. Input tools (image/link/embed/board) then open their dialog to fill the
  // placeholder (fillRef tells those flows to patch the placeholder rather than create new).
  const startPlace = (toolKey: string, e: React.PointerEvent) => {
    if (readOnly) return;
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    const w0 = toWorld(e.clientX, e.clientY);
    let size = { w: 220, h: 120 };
    let fill: "image" | "link" | "embed" | "board" | null = null;
    const base = (w: number, h: number) => {
      size = { w, h };
      return { id, x: w0.x - w / 2, y: w0.y - h / 2, w, h };
    };
    switch (toolKey) {
      case "note": c.elements.set(id, { ...base(220, 120), type: "note", text: "", style: { fill: "#ffffff" } }); break;
      case "todo": c.elements.set(id, { ...base(240, 140), type: "todo", title: "", items: [{ id: crypto.randomUUID(), text: "", done: false }], style: { fill: "#ffffff" } }); break;
      case "column": c.elements.set(id, { ...base(280, 120), type: "column", title: "", children: [], style: { fill: "#ffffff" } }); break;
      case "image": c.elements.set(id, { ...base(280, 180), type: "image", src: "" }); fill = "image"; break;
      case "link": c.elements.set(id, { ...base(260, 96), type: "link", url: "" }); fill = "link"; break;
      case "embed": c.elements.set(id, { ...base(360, 203), type: "embed", src: "" }); fill = "embed"; break;
      case "board": c.elements.set(id, { ...base(200, 116), type: "board", boardId: "", title: "" }); fill = "board"; break;
      default: return;
    }
    selectNew(id);
    setDraggingId(id);
    const intoColumn = toolKey !== "column"; // columns can't nest
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
    const target = fillRef.current?.kind === "board" ? fillRef.current.id : null;
    fillRef.current = null;
    if (!c) return;
    try {
      const b = await api<Board>(`/api/workspaces/${workspaceId}/boards`, { method: "POST", body: JSON.stringify({ title, parentBoardId: boardId }) });
      if (target) {
        const cur = c.elements.get(target);
        if (cur?.type === "board") patch(target, { boardId: b.id, title: b.title } as Partial<Element>);
      } else {
        const id = crypto.randomUUID();
        c.elements.set(id, { id, type: "board", x: at.x, y: at.y, w: 200, h: 116, boardId: b.id, title: b.title, style: { fill: "#ffffff" } });
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
    c.elements.set(id, { id, type: "embed", x, y, w, h, src });
    selectNew(id);
  };
  // Embed tool: raw embed code only — paste an <iframe …> snippet.
  const createEmbed = (input: string) => {
    const at = embedModal ?? viewportCentre();
    const target = fillRef.current?.kind === "embed" ? fillRef.current.id : null;
    fillRef.current = null;
    const src = extractIframeSrc(input);
    if (!src) {
      toast("Paste embed code (an <iframe> snippet)", "error");
      if (target) connRef.current?.elements.delete(target);
      return;
    }
    if (target) {
      const cur = connRef.current?.elements.get(target);
      if (cur?.type === "embed") patch(target, { src, h: embedHeightFor(src, cur.w) } as Partial<Element>);
    } else dropEmbed(src, at.x, at.y);
  };

  // Unfurl + drop a link card at a point; returns an approximate height for column stacking.
  const makeLinkAt = async (url: string, x: number, y: number): Promise<number> => {
    try {
      const u = await unfurlLink(boardId, url);
      dropLink(u, url, { x, y });
      return u.imageUrl ? 230 : 120;
    } catch {
      dropLink({ url, title: null, description: null, imageUrl: null }, url, { x, y });
      return 120;
    }
  };

  // Place creators in a vertical column (Milanote-style); each returns its height to stack the next.
  const pasteColumn = async (makers: Array<(x: number, y: number) => Promise<number> | number>, start?: { x: number; y: number }) => {
    const at = start ?? viewportCentre();
    let py = at.y;
    for (const make of makers) {
      const h = await make(at.x, py);
      py += (h || 160) + 16;
    }
  };

  // Build element creators from clipboard/drop data and lay them out in a column. Handles multiple
  // items (image files, or an HTML payload with several images/links/embeds). Returns true if handled.
  const dropClipboard = (files: File[], text: string, html: string, start?: { x: number; y: number }): boolean => {
    const makers: Array<(x: number, y: number) => Promise<number> | number> = [];
    for (const f of files) makers.push((x, y) => addImageFile(f, x, y));
    const firstTok = text.split(/\s+/)[0] ?? "";
    if (!files.length) {
      const iframeSrc = extractIframeSrc(text);
      if (iframeSrc) {
        makers.push((x, y) => { dropEmbed(iframeSrc, x, y); return embedHeightFor(iframeSrc, 360); });
      } else if (/^https?:\/\//i.test(firstTok)) {
        const at = start ?? viewportCentre();
        void handleUrl(firstTok, at.x, at.y); // single URL — may prompt image/link or embed
        return true;
      } else {
        const items = parseClipboardHtmlAll(html);
        if (items.length) {
          for (const it of items) {
            if (it.kind === "iframe") makers.push((x, y) => { dropEmbed(it.value, x, y); return embedHeightFor(it.value, 360); });
            else if (it.kind === "img") makers.push((x, y) => createImageUrl(it.value, x, y));
            else makers.push((x, y) => makeLinkAt(it.value, x, y));
          }
        } else if (text) {
          makers.push((x, y) => { createNote(x, y, text.slice(0, 10000)); return 140; });
        }
      }
    } else {
      // Images plus accompanying note text (the text often lives in the HTML, not text/plain).
      const noteText = text || htmlVisibleText(html);
      if (noteText && !/^https?:\/\//i.test(noteText.split(/\s+/)[0] ?? "")) {
        makers.push((x, y) => { createNote(x, y, noteText.slice(0, 10000)); return 140; });
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
  const dropLink = (u: Unfurl, url: string, at: { x: number; y: number }, embedSrc?: string) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    const w = embedSrc ? 360 : 260;
    const previewH = embedSrc ? embedHeightFor(embedSrc, w) : u.imageUrl ? 230 : 0;
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
        if (cur?.type === "link") patch(target, { url: u.url || url, title: u.title ?? undefined, description: u.description ?? undefined, image: u.imageUrl ?? undefined } as Partial<Element>);
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
      if (remembered === "link") return void createProviderLink(url, embed, { x, y });
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
    if (remembered === "image") return void createImageUrl(u.imageUrl, at.x, at.y, url, u.title);
    if (remembered === "link") return dropLink(u, url, at);
    setUrlChoice({ u, url, at });
  };

  const applyUrlChoice = (kind: "image" | "link", remember: boolean) => {
    const choice = urlChoice;
    setUrlChoice(null);
    if (!choice) return;
    if (remember) localStorage.setItem(URL_CHOICE_KEY, kind);
    if (kind === "image" && choice.u.imageUrl) void createImageUrl(choice.u.imageUrl, choice.at.x, choice.at.y, choice.url, choice.u.title);
    else dropLink(choice.u, choice.url, choice.at);
  };

  // Provider link: unfurl for the title (track/video name), then a link card with the live embed
  // as its preview. Falls back to a bare card if the unfurl fails.
  const createProviderLink = async (url: string, embed: string, at: { x: number; y: number }) => {
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

  const addImageFile = async (file: File, x: number, y: number): Promise<number> => {
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
      c.elements.set(id, { id, type: "image", x, y, w: width, h: height, src: displayUrl, mediaId, alt: file.name });
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
  const createImageUrl = async (src: string, x: number, y: number, sourceUrl?: string, title?: string | null): Promise<number> => {
    const c = connRef.current;
    if (!c) return 0;
    const { w, h } = await loadImageSize(src);
    const width = 280;
    const id = crypto.randomUUID();
    const height = Math.max(40, Math.round((width * h) / w));
    // Caption is the page title (hyperlinked to the source), falling back to the site name.
    const text = (title ?? "").trim() || (sourceUrl ? siteName(sourceUrl) : "");
    const caption = sourceUrl ? `<a href="${sourceUrl}">${escapeText(text)}</a>` : undefined;
    c.elements.set(id, {
      id,
      type: "image",
      x,
      y,
      w: width,
      h: height,
      src,
      ...(caption ? { caption, showCaption: true } : {}),
    });
    selectNew(id);
    return height + (caption ? 40 : 0);
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = fillRef.current?.kind === "image" ? fillRef.current.id : null;
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
        if (cur?.type === "image") patch(target, { src: displayUrl, mediaId, alt: file.name, h: Math.max(40, Math.round((cur.w * h) / w)) } as Partial<Element>);
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

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    const uri = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
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

  const isNoteSelected =
    selected && (selected.type === "note" || selected.type === "text");
  const isLinkSelected = selected && selected.type === "link";
  const isImageSelected = selected && selected.type === "image";
  const isTodoSelected = selected && selected.type === "todo";
  const isBoardSelected = selected && selected.type === "board";
  const isEmbedSelected = selected && selected.type === "embed";
  const isColumnSelected = selected && selected.type === "column";
  // Merge a hex into the selected element's style, or delete the key when null.
  const setStyleKey = (key: "fill" | "strip", hex: string | null) => {
    if (!selected) return;
    const style = { ...selected.style };
    if (hex) style[key] = hex;
    else delete style[key];
    patch(selected.id, { style } as Partial<Element>);
  };

  // --- Multi-selection: common-settings rail applies one change across all selected elements. ---
  const isMulti = selectedIds.length > 1;
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
    e.type === "image" ? !!e.showCaption : e.type === "link" ? !e.hideCaption : false;
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
    eachSelected((e) => (e.type === "link" ? ({ hideImage: !target } as Partial<Element>) : null));
  };

  // Render one element card. `embedded` cards live inside a column (relative flow, drag = reparent).
  const renderElementCard = (el: Element, embedded: boolean) => (
    <ElementCard
      key={el.id}
      el={el}
      embedded={embedded}
      selected={selectedIds.includes(el.id)}
      editing={el.id === editingId}
      imgUrl={el.type === "image" ? (el.mediaId && mediaUrls[el.mediaId]) || el.src : undefined}
      onSelect={() => selectId(el.id)}
      onToggleSelect={() => toggleSelect(el.id)}
      onEdit={() => setEditingId(el.id)}
      onMove={(x, y) => moveElement(el.id, x, y)}
      onResize={(w, h) => patch(el.id, { w, h })}
      onText={(text) => patch(el.id, { text } as Partial<Element>)}
      onRegister={(e) => (editorRef.current = e)}
      onOpen={el.type === "link" ? () => window.open(el.url, "_blank", "noopener,noreferrer") : el.type === "board" ? () => onOpenBoard(el.boardId) : undefined}
      onCaption={el.type === "image" ? (h) => patch(el.id, { caption: h } as Partial<Element>) : undefined}
      onTodo={el.type === "todo" ? (p) => patch(el.id, p as Partial<Element>) : undefined}
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
      onColumnTitle={el.type === "column" ? (t) => patch(el.id, { title: t } as Partial<Element>) : undefined}
      onToggleCollapse={el.type === "column" ? () => patch(el.id, { collapsed: !el.collapsed } as Partial<Element>) : undefined}
      colDropIndex={el.type === "column" && colDrop?.colId === el.id ? colDrop.index : undefined}
      renderColumnChild={el.type === "column" ? (cid: string) => renderColumnChild(cid) : undefined}
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
      {readOnly ? (
        <nav className="flex w-20 shrink-0 flex-col items-center gap-2 border-r-2 border-slate-100 bg-white py-3 text-center">
          <Icon.EyeIcon className="text-xl text-slate-400" />
          <span className="px-1 text-[10px] font-bold leading-tight text-slate-400">View only</span>
        </nav>
      ) : selectedConn && connections.find((c) => c.id === selectedConn) ? (
        <ConnectionSubRail
          conn={connections.find((c) => c.id === selectedConn)!}
          onDone={() => setSelectedConn(null)}
          onColor={(hex: string) => patchConnection(selectedConn, { color: hex })}
          onToggleStart={() => patchConnection(selectedConn, { arrowStart: !(connections.find((c) => c.id === selectedConn)!.arrowStart ?? false) })}
          onToggleEnd={() => patchConnection(selectedConn, { arrowEnd: !(connections.find((c) => c.id === selectedConn)!.arrowEnd ?? true) })}
          onLabel={() => setEditingConnLabel(selectedConn)}
          onToggleDashed={() => patchConnection(selectedConn, { dashed: !connections.find((c) => c.id === selectedConn)!.dashed })}
          onCycleWeight={() => {
            const w = connections.find((c) => c.id === selectedConn)!.weight ?? 2;
            patchConnection(selectedConn, { weight: w === 2 ? 4 : w === 4 ? 6 : 2 });
          }}
          onDelete={() => removeConnection(selectedConn)}
        />
      ) : selectedLine && lines.find((l) => l.id === selectedLine) ? (
        <ConnectionSubRail
          conn={lines.find((l) => l.id === selectedLine)!}
          onDone={() => setSelectedLine(null)}
          onColor={(hex: string) => patchLine(selectedLine, { color: hex })}
          onToggleStart={() => patchLine(selectedLine, { arrowStart: !lines.find((l) => l.id === selectedLine)!.arrowStart })}
          onToggleEnd={() => patchLine(selectedLine, { arrowEnd: !lines.find((l) => l.id === selectedLine)!.arrowEnd })}
          onLabel={() => setEditingLineLabel(selectedLine)}
          onToggleDashed={() => patchLine(selectedLine, { dashed: !lines.find((l) => l.id === selectedLine)!.dashed })}
          onCycleWeight={() => {
            const w = lines.find((l) => l.id === selectedLine)!.weight ?? 2;
            patchLine(selectedLine, { weight: w === 2 ? 4 : w === 4 ? 6 : 2 });
          }}
          onDelete={() => removeLine(selectedLine)}
        />
      ) : isMulti ? (
        <CommonSubRail
          els={selectedEls}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onFillAll={(hex) => setStyleAll("fill", hex)}
          onStripAll={(hex) => setStyleAll("strip", hex)}
          onToggleCaption={toggleCaptionAll}
          onTogglePreview={togglePreviewAll}
          onDelete={() => removeMany(selectedIds)}
        />
      ) : isNoteSelected ? (
        <NoteSubRail
          el={selected}
          editing={editingId === selected.id}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onBack={() => setEditingId(null)}
          onExec={exec}
          onFill={(hex) => setStyleKey("fill", hex)}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : isLinkSelected ? (
        <LinkSubRail
          el={selected}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onPatch={(p) => patch(selected.id, p as Partial<Element>)}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : isImageSelected && captionEditing ? (
        // Caption is focused → note-style text-formatting rail acting on the caption editor.
        <NoteSubRail
          el={selected}
          editing
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onBack={() => {
            setCaptionEditing(false);
            editorRef.current?.el.blur();
          }}
          onExec={exec}
          onFill={() => {}}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : isImageSelected ? (
        <ImageSubRail
          el={selected}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onPatch={(p) => patch(selected.id, p as Partial<Element>)}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : isTodoSelected ? (
        <TodoSubRail
          el={selected}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onFill={(hex) => setStyleKey("fill", hex)}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : isBoardSelected ? (
        <BoardSubRail
          el={selected}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onOpen={() => onOpenBoard(selected.boardId)}
          onFill={(hex) => setStyleKey("fill", hex)}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : isEmbedSelected ? (
        <EmbedSubRail
          el={selected}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : isColumnSelected ? (
        <ColumnSubRail
          el={selected}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onToggleCollapse={() => patch(selected.id, { collapsed: !selected.collapsed } as Partial<Element>)}
          onFill={(hex) => setStyleKey("fill", hex)}
          onStrip={(hex) => setStyleKey("strip", hex)}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : (
        <ToolRail
          tools={createTools}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDelete={selectedIds.length ? () => removeMany(selectedIds) : undefined}
        />
      )}
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

      {urlChoice && <UrlChoiceModal preview={urlChoice.u} onPick={applyUrlChoice} onClose={() => setUrlChoice(null)} />}

      {embedChoice && <EmbedChoiceModal embed={embedChoice.embed} onPick={applyEmbedChoice} onClose={() => setEmbedChoice(null)} />}

      <div
        ref={viewportRef}
        className={`relative flex-1 touch-none overflow-hidden bg-slate-50 ${armLine ? "cursor-crosshair" : ""}`}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
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
            className={`relative grid h-8 w-8 place-items-center rounded-lg border-2 shadow-sm ${showComments ? "border-primary bg-primary text-white" : "border-slate-100 bg-white text-slate-500 hover:text-primary"}`}
          >
            <Icon.ChatIcon className="text-base" />
            {unreadComments && !showComments && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary" />}
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
        <div className="absolute bottom-4 left-4 z-30 flex items-center gap-1 rounded-lg border-2 border-slate-100 bg-white px-1 py-1 text-xs font-bold text-slate-500 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
          <button className="h-6 w-6 rounded hover:bg-slate-100" onClick={() => setZoom(view.zoom / 1.2)}>
            −
          </button>
          <button className="w-12 rounded hover:bg-slate-100" onClick={() => setZoom(1)}>
            {Math.round(view.zoom * 100)}%
          </button>
          <button className="h-6 w-6 rounded hover:bg-slate-100" onClick={() => setZoom(view.zoom * 1.2)}>
            +
          </button>
        </div>
        <div className="h-full w-full">
          <div
            ref={surfaceRef}
            className={`absolute left-0 top-0 origin-top-left [background-size:24px_24px] ${showGrid ? "bg-[radial-gradient(circle,#d8dde6_1px,transparent_1px)]" : ""}`}
            style={{ width: WORLD_W, height: WORLD_H, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          >
            {/* Lines render behind elements; handles + labels render above (after the cards). */}
            <ConnectionLines
              lines={connLines}
              temp={linking && linkEnd ? { from: sizedElements.find((e) => e.id === linking.from) ?? null, end: linkEnd, target: linkTarget ? sizedElements.find((e) => e.id === linkTarget) ?? null : null } : null}
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
              draw={lineDraw ? { a: { x: lineDraw.a.x, y: lineDraw.a.y }, b: { x: lineDraw.b.x, y: lineDraw.b.y } } : null}
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
            {linkTarget && (() => {
              const t = sizedElements.find((e) => e.id === linkTarget);
              return t ? (
                <div
                  className="pointer-events-none absolute z-[6] rounded-lg border-2 border-primary bg-primary/5"
                  style={{ left: t.x - 3, top: t.y - 3, width: t.w + 6, height: t.h + 6 }}
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
    </div>
  );
}

// A remote peer's live cursor, positioned in world coords but counter-scaled so it stays a
// constant size on screen at any zoom.
function PeerCursor({ peer, zoom }: { peer: Peer; zoom: number }) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-50"
      style={{ transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px) scale(${1 / zoom})`, transformOrigin: "top left" }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="drop-shadow">
        <path d="M2 2l6 14 2.5-5.5L16 8 2 2z" fill={peer.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span
        className="ml-3 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-bold text-white shadow"
        style={{ background: peer.color }}
      >
        {peer.name}
      </span>
    </div>
  );
}

// Point on an element's border in the direction of (tx,ty) — where an arrow should touch.
function edgePoint(e: Element, tx: number, ty: number): { x: number; y: number } {
  const x = e.x + e.w / 2;
  const y = e.y + e.h / 2;
  const dx = tx - x;
  const dy = ty - y;
  if (!dx && !dy) return { x, y };
  const s = 1 / Math.max(Math.abs(dx) / (e.w / 2 || 1), Math.abs(dy) / (e.h / 2 || 1));
  return { x: x + dx * s, y: y + dy * s };
}

// The 9 snap anchors of an element: corners, edge-midpoints, centre.
const ANCHOR_KEYS: AnchorKey[] = ["tl", "tm", "tr", "lm", "c", "rm", "bl", "bm", "br"];
function anchorPoint(el: Element, key: AnchorKey): { x: number; y: number } {
  const left = key === "tl" || key === "lm" || key === "bl";
  const right = key === "tr" || key === "rm" || key === "br";
  const top = key === "tl" || key === "tm" || key === "tr";
  const bottom = key === "bl" || key === "bm" || key === "br";
  return {
    x: left ? el.x : right ? el.x + el.w : el.x + el.w / 2,
    y: top ? el.y : bottom ? el.y + el.h : el.y + el.h / 2,
  };
}
// Nearest element anchor to a world point within threshold; null if none close.
function nearestAnchor(p: { x: number; y: number }, els: Element[], threshold: number): { elementId: string; anchor: AnchorKey; pt: { x: number; y: number } } | null {
  let best: { elementId: string; anchor: AnchorKey; pt: { x: number; y: number } } | null = null;
  let bestD = threshold;
  for (const el of els) {
    for (const k of ANCHOR_KEYS) {
      const a = anchorPoint(el, k);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { elementId: el.id, anchor: k, pt: a };
      }
    }
  }
  return best;
}
// Resolve a line endpoint to a world point — a pinned endpoint tracks its element's anchor.
function resolveEnd(ep: LineEndpoint, byId: Map<string, Element>): { x: number; y: number } {
  if (ep.elementId && ep.anchor) {
    const el = byId.get(ep.elementId);
    if (el) return anchorPoint(el, ep.anchor);
  }
  return { x: ep.x, y: ep.y };
}

type Pt = { x: number; y: number };
export interface ConnLine {
  c: Connection;
  p1: Pt; // visible edge endpoints (for handles + label midpoint)
  p2: Pt;
  ctrl: Pt | null; // quadratic control point when bent, else null (straight)
  handle: Pt; // midpoint bend handle (sits on the line)
  d: string; // SVG path — drawn from element CENTRES (behind the card) for ends without an arrow,
}

// Resolve each connection's geometry. The path is drawn from a card's CENTRE when that end has no
// arrowhead, so the line tucks behind the card and emerges cleanly at its edge regardless of the
// card's exact size; the arrowhead end anchors on the border so the head sits at the edge. Handles
// and the label use the visible edge points. A dragged endpoint follows the cursor.
function computeLines(elements: Element[], connections: Connection[], connDrag: { id: string; which: "from" | "to"; pos: Pt } | null): ConnLine[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out: ConnLine[] = [];
  for (const c of connections) {
    const from = byId.get(c.from);
    const to = byId.get(c.to);
    if (!from || !to) continue;
    const fromC = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const toC = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const ctrl = c.bend ? { x: (fromC.x + toC.x) / 2 + c.bend.x, y: (fromC.y + toC.y) / 2 + c.bend.y } : null;
    const dragFrom = connDrag?.id === c.id && connDrag.which === "from";
    const dragTo = connDrag?.id === c.id && connDrag.which === "to";
    const fromAim = ctrl ?? (dragTo ? connDrag!.pos : toC);
    const toAim = ctrl ?? (dragFrom ? connDrag!.pos : fromC);
    const edge1 = dragFrom ? connDrag!.pos : edgePoint(from, fromAim.x, fromAim.y);
    const edge2 = dragTo ? connDrag!.pos : edgePoint(to, toAim.x, toAim.y);
    const startArrow = c.arrowStart ?? false;
    const endArrow = c.arrowEnd ?? true;
    // Draw from centre (behind card) on ends without an arrowhead; from edge when arrowed.
    const draw1 = dragFrom ? connDrag!.pos : startArrow ? edge1 : fromC;
    const draw2 = dragTo ? connDrag!.pos : endArrow ? edge2 : toC;
    const handle = ctrl
      ? { x: 0.25 * edge1.x + 0.5 * ctrl.x + 0.25 * edge2.x, y: 0.25 * edge1.y + 0.5 * ctrl.y + 0.25 * edge2.y }
      : { x: (edge1.x + edge2.x) / 2, y: (edge1.y + edge2.y) / 2 };
    out.push({ c, p1: edge1, p2: edge2, ctrl, handle, d: connPath(draw1, draw2, ctrl) });
  }
  return out;
}

// Straight by default; a quadratic through the control point when bent.
function connPath(p1: Pt, p2: Pt, ctrl: Pt | null): string {
  return ctrl ? `M${p1.x},${p1.y} Q${ctrl.x},${ctrl.y} ${p2.x},${p2.y}` : `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
}

const CONN_DEFAULT = "#475569"; // slate-600

export interface LineGeo {
  l: LineShape;
  a: Pt;
  b: Pt;
  ctrl: Pt | null;
  handle: Pt;
  d: string;
}
// Resolve standalone-line geometry (endpoints + optional bend), honouring a dragged endpoint.
function computeLineGeo(lines: LineShape[], elements: Element[], lineDrag: { id: string; which: "a" | "b"; ep: LineEndpoint } | null): LineGeo[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return lines.map((l) => {
    const aEp = lineDrag?.id === l.id && lineDrag.which === "a" ? lineDrag.ep : l.a;
    const bEp = lineDrag?.id === l.id && lineDrag.which === "b" ? lineDrag.ep : l.b;
    const a = resolveEnd(aEp, byId);
    const b = resolveEnd(bEp, byId);
    const ctrl = l.bend ? { x: (a.x + b.x) / 2 + l.bend.x, y: (a.y + b.y) / 2 + l.bend.y } : null;
    const handle = ctrl ? { x: 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { l, a, b, ctrl, handle, d: connPath(a, b, ctrl) };
  });
}

// Standalone-line paths (behind elements). `draw` is the in-progress line being drawn.
function LineLayer({ geo, draw, readOnly, selectedId, onSelect }: { geo: LineGeo[]; draw: { a: Pt; b: Pt } | null; readOnly?: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={WORLD_W} height={WORLD_H}>
      {geo.map(({ l, d }) => {
        const sel = l.id === selectedId;
        return (
          <g
            key={l.id}
            style={{ pointerEvents: readOnly ? "none" : "stroke", cursor: readOnly ? "default" : "pointer" }}
            onPointerDown={readOnly ? undefined : (e) => { e.stopPropagation(); onSelect(l.id); }}
          >
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
            <path
              d={d}
              fill="none"
              stroke={l.color ?? CONN_DEFAULT}
              strokeWidth={(l.weight ?? 2) + (sel ? 1 : 0)}
              strokeDasharray={l.dashed ? "6 5" : undefined}
              markerStart={l.arrowStart ? "url(#conn-arrow-start)" : undefined}
              markerEnd={l.arrowEnd ? "url(#conn-arrow)" : undefined}
            />
          </g>
        );
      })}
      {draw && <path d={connPath(draw.a, draw.b, null)} fill="none" stroke="#6e24ff" strokeWidth={2} strokeDasharray="5 4" />}
    </svg>
  );
}

// Interactive overlay for standalone lines: endpoint handles (drag to move/pin), bend handle, label.
function LineOverlay({
  geo,
  zoom,
  readOnly,
  selectedId,
  editingId,
  snapPt,
  onSelect,
  onEndpointDown,
  onBendDown,
  onBendReset,
  onLabelCommit,
}: {
  geo: LineGeo[];
  zoom: number;
  readOnly?: boolean;
  selectedId: string | null;
  editingId: string | null;
  snapPt: Pt | null;
  onSelect: (id: string) => void;
  onEndpointDown: (id: string, which: "a" | "b", e: React.PointerEvent) => void;
  onBendDown: (id: string, e: React.PointerEvent) => void;
  onBendReset: (id: string) => void;
  onLabelCommit: (id: string, label: string) => void;
}) {
  return (
    <>
      {snapPt && (
        <div className="pointer-events-none absolute left-0 top-0 z-[8] h-4 w-4 rounded-full border-2 border-primary" style={{ transform: `translate(${snapPt.x}px, ${snapPt.y}px) translate(-50%, -50%) scale(${1 / zoom})` }} />
      )}
      {geo.map(({ l, a, b, handle }) => {
        const sel = l.id === selectedId && !readOnly;
        const editing = l.id === editingId && !readOnly;
        return (
          <div key={l.id}>
            {sel && (
              <>
                <Handle pt={a} zoom={zoom} onPointerDown={(e) => onEndpointDown(l.id, "a", e)} />
                <Handle pt={b} zoom={zoom} onPointerDown={(e) => onEndpointDown(l.id, "b", e)} />
                {!editing && <Handle pt={handle} zoom={zoom} bend onPointerDown={(e) => onBendDown(l.id, e)} onDoubleClick={() => onBendReset(l.id)} />}
              </>
            )}
            {(editing || l.label) && (
              <div
                className="absolute left-0 top-0 z-[6]"
                style={{ transform: `translate(${handle.x}px, ${handle.y}px) translate(-50%, -50%) scale(${1 / zoom})` }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {editing ? (
                  <input
                    autoFocus
                    defaultValue={l.label ?? ""}
                    placeholder="Label"
                    onBlur={(e) => onLabelCommit(l.id, e.target.value.trim())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") onLabelCommit(l.id, l.label ?? "");
                    }}
                    className="w-28 rounded-md border-2 border-primary bg-white px-1.5 py-0.5 text-center text-[11px] font-bold text-slate-700 outline-none"
                  />
                ) : readOnly ? (
                  <span className="whitespace-nowrap rounded-md border-2 border-slate-100 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">{l.label}</span>
                ) : (
                  <button onClick={() => onSelect(l.id)} className="whitespace-nowrap rounded-md border-2 border-slate-100 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">{l.label}</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// Arrow curves — rendered behind elements so a line tucks under its originating card.
function ConnectionLines({
  lines,
  temp,
  readOnly,
  selectedId,
  onSelect,
}: {
  lines: ConnLine[];
  temp: { from: Element | null; end: Pt; target: Element | null } | null;
  readOnly?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Preview starts at the source CENTRE; if hovering a valid target it clings to that element's
  // edge (toward the source), otherwise it follows the cursor.
  const tempStart = temp?.from ? { x: temp.from.x + temp.from.w / 2, y: temp.from.y + temp.from.h / 2 } : null;
  const tempEnd = temp ? (temp.target && tempStart ? edgePoint(temp.target, tempStart.x, tempStart.y) : temp.end) : null;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={WORLD_W} height={WORLD_H}>
      <defs>
        {/* context-stroke makes each arrowhead match its line colour; start head reverses. */}
        <marker id="conn-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" /></marker>
        <marker id="conn-arrow-start" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" /></marker>
      </defs>
      {lines.map(({ c, d }) => {
        const sel = c.id === selectedId;
        const color = c.color ?? CONN_DEFAULT;
        const arrowEnd = c.arrowEnd ?? true;
        return (
          <g
            key={c.id}
            style={{ pointerEvents: readOnly ? "none" : "stroke", cursor: readOnly ? "default" : "pointer" }}
            onPointerDown={readOnly ? undefined : (e) => { e.stopPropagation(); onSelect(c.id); }}
          >
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={(c.weight ?? 2) + (sel ? 1 : 0)}
              strokeDasharray={c.dashed ? "6 5" : undefined}
              markerStart={c.arrowStart ? "url(#conn-arrow-start)" : undefined}
              markerEnd={arrowEnd ? "url(#conn-arrow)" : undefined}
            />
          </g>
        );
      })}
      {tempStart && tempEnd && (
        <path d={connPath(tempStart, tempEnd, null)} fill="none" stroke="#6e24ff" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#conn-arrow)" />
      )}
    </svg>
  );
}

// Interactive overlay (above elements): endpoint handles for reassigning, and the in-place label.
function ConnectionOverlay({
  lines,
  zoom,
  readOnly,
  selectedId,
  editingId,
  onSelect,
  onEndpointDown,
  onBendDown,
  onBendReset,
  onLabelCommit,
}: {
  lines: ConnLine[];
  zoom: number;
  readOnly?: boolean;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string) => void;
  onEndpointDown: (id: string, which: "from" | "to", e: React.PointerEvent) => void;
  onBendDown: (id: string, e: React.PointerEvent) => void;
  onBendReset: (id: string) => void;
  onLabelCommit: (id: string, label: string) => void;
}) {
  return (
    <>
      {lines.map(({ c, p1, p2, handle }) => {
        const sel = c.id === selectedId && !readOnly;
        const editing = c.id === editingId && !readOnly;
        return (
          <div key={c.id}>
            {sel && (
              <>
                <Handle pt={p1} zoom={zoom} onPointerDown={(e) => onEndpointDown(c.id, "from", e)} />
                <Handle pt={p2} zoom={zoom} onPointerDown={(e) => onEndpointDown(c.id, "to", e)} />
                {/* Bend handle — drag to curve, double-click to reset straight. */}
                {!editing && <Handle pt={handle} zoom={zoom} bend onPointerDown={(e) => onBendDown(c.id, e)} onDoubleClick={() => onBendReset(c.id)} />}
              </>
            )}
            {(editing || c.label) && (
              <div
                className="absolute left-0 top-0 z-[6]"
                style={{ transform: `translate(${handle.x}px, ${handle.y}px) translate(-50%, -50%) scale(${1 / zoom})` }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {editing ? (
                  <input
                    autoFocus
                    defaultValue={c.label ?? ""}
                    placeholder="Label"
                    onBlur={(e) => onLabelCommit(c.id, e.target.value.trim())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") onLabelCommit(c.id, c.label ?? "");
                    }}
                    className="w-28 rounded-md border-2 border-primary bg-white px-1.5 py-0.5 text-center text-[11px] font-bold text-slate-700 outline-none"
                  />
                ) : readOnly ? (
                  <span className="whitespace-nowrap rounded-md border-2 border-slate-100 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">{c.label}</span>
                ) : (
                  <button onClick={() => onSelect(c.id)} className="whitespace-nowrap rounded-md border-2 border-slate-100 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">{c.label}</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Handle({ pt, zoom, bend, onPointerDown, onDoubleClick }: { pt: Pt; zoom: number; bend?: boolean; onPointerDown: (e: React.PointerEvent) => void; onDoubleClick?: () => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`absolute left-0 top-0 z-[7] cursor-grab rounded-full border-2 shadow active:cursor-grabbing ${bend ? "h-3 w-3 border-primary bg-primary/30" : "h-3.5 w-3.5 border-primary bg-white"}`}
      style={{ transform: `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%) scale(${1 / zoom})` }}
    />
  );
}

// Asks whether a dropped/pasted URL with a preview image should become an image or a link card,
// with an option to remember the answer.
// Asks whether an embeddable provider URL should be a link card (with a live preview) or a bare
// embed, with an option to remember.
function EmbedChoiceModal({ embed, onPick, onClose }: { embed: string; onPick: (kind: "link" | "embed", remember: boolean) => void; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  return (
    <Modal open onClose={onClose} title="Link or embed?">
      <iframe src={embed} title="preview" className="h-40 w-full rounded-lg border-2 border-slate-100" style={{ border: 0 }} sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => onPick("link", remember)}>
          <Icon.LinkIcon className="text-base" /> Link + preview
        </Button>
        <Button variant="ghost" className="flex-1 border-2 border-slate-200" onClick={() => onPick("embed", remember)}>
          <Icon.EmbedIcon className="text-base" /> Embed
        </Button>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-2 border-slate-300 accent-primary" />
        Remember my choice
      </label>
    </Modal>
  );
}

function UrlChoiceModal({ preview, onPick, onClose }: { preview: Unfurl; onPick: (kind: "image" | "link", remember: boolean) => void; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  return (
    <Modal open onClose={onClose} title="Add as image or link?">
      {preview.imageUrl && (
        <img src={preview.imageUrl} alt="" className="max-h-40 w-full rounded-lg border-2 border-slate-100 object-cover" />
      )}
      {preview.title && <p className="truncate text-xs font-bold text-slate-600">{preview.title}</p>}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => onPick("image", remember)}>
          <Icon.ImageIcon className="text-base" /> Image
        </Button>
        <Button variant="ghost" className="flex-1 border-2 border-slate-200" onClick={() => onPick("link", remember)}>
          <Icon.LinkIcon className="text-base" /> Link
        </Button>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-2 border-slate-300 accent-primary" />
        Remember my choice
      </label>
    </Modal>
  );
}

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Human site name from a URL: the registrable label, capitalised. uk.pinterest.com → "Pinterest",
// example.co.uk → "Example". Falls back to the host.
const TWO_LEVEL_TLD = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
// Visible text of an HTML clipboard payload (note text often lives only here, not in text/plain).
function htmlVisibleText(html: string): string {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, iframe").forEach((n) => n.remove());
    return (doc.body?.textContent ?? "").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  } catch {
    return "";
  }
}

// All droppable items in a clipboard text/html payload, in document order (Milanote multi-select).
function parseClipboardHtmlAll(html: string): { kind: "iframe" | "img" | "link"; value: string }[] {
  if (!html) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [];
  }
  const out: { kind: "iframe" | "img" | "link"; value: string }[] = [];
  doc.querySelectorAll("iframe[src], img[src], a[href]").forEach((node) => {
    const el = node as HTMLElement;
    if (el.tagName === "IFRAME") {
      const v = el.getAttribute("src");
      if (v && /^https?:/i.test(v)) out.push({ kind: "iframe", value: v });
    } else if (el.tagName === "IMG") {
      const v = el.getAttribute("src");
      if (v && /^https?:/i.test(v)) out.push({ kind: "img", value: v });
    } else if (el.tagName === "A") {
      if (el.querySelector("img, iframe")) return; // wrapper around media already captured
      const v = el.getAttribute("href");
      if (v && /^https?:/i.test(v)) out.push({ kind: "link", value: v });
    }
  });
  return out;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function siteName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    let idx = parts.length - 2;
    if (parts.length > 2 && TWO_LEVEL_TLD.has(parts[parts.length - 2]!)) idx = parts.length - 3;
    const name = parts[idx] ?? host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return linkHost(url);
  }
}

// Load an image's natural dimensions (falls back to 4:3 on error).
function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
    img.onerror = () => resolve({ w: 4, h: 3 });
    img.src = url;
  });
}

// An http(s) URL whose path ends in an image extension → render directly as an image element.
function isImageUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (
      /^https?:$/.test(url.protocol) &&
      /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

// Editable caption beneath an image (uncontrolled contentEditable; sanitised HTML persisted to
// Yjs). stopPropagation so editing doesn't drag the card; "Add a caption" placeholder when empty.
// On focus it registers as the active editor + signals caption-editing so the rail shows the
// note-style text-formatting tools.
function CaptionField({ html, editing, readOnly, onText, onRegister, onFocusCaption }: { html: string; editing: boolean; readOnly?: boolean; onText: (html: string) => void; onRegister: (e: ActiveEditor) => void; onFocusCaption: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Editable only on a writable board AND once the card is in edit mode (the second click).
  const active = editing && !readOnly;
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d || document.activeElement === d) return;
    const clean = sanitizeHtml(html);
    if (d.innerHTML !== clean) d.innerHTML = clean;
  });
  // Focus the caption when the card enters edit mode (second click), mirroring a note.
  useEffect(() => {
    if (active && ref.current && document.activeElement !== ref.current) ref.current.focus();
  }, [active]);
  return (
    <div
      ref={ref}
      contentEditable={active}
      suppressContentEditableWarning
      data-empty-placeholder={readOnly ? "" : "Add a caption"}
      className="note-editable border-t-2 border-slate-100 p-2 text-xs text-slate-700 outline-none"
      // While editing keep the caret from dragging the card; otherwise let the pointer bubble so the
      // first click selects and the second enters edit mode.
      onPointerDown={active ? (e: React.PointerEvent) => e.stopPropagation() : undefined}
      onClick={(e) => {
        // A click on a link inside the caption opens it instead of selecting/editing the card.
        const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href");
        if (href) {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, "_blank", "noopener,noreferrer");
        }
      }}
      onFocus={() => {
        onRegister({ el: ref.current!, commit: () => onText(sanitizeHtml(ref.current!.innerHTML)) });
        onFocusCaption();
      }}
      onInput={() => onText(sanitizeHtml(ref.current!.innerHTML))}
    />
  );
}

// Checklist body: optional title + checkable, editable items. Enter adds an item below; Backspace
// on an empty item removes it. Every change patches the whole items array into the Yjs element.
type Todo = Extract<Element, { type: "todo" }>;
function TodoBody({ el, editing, readOnly, onChange }: { el: Todo; editing: boolean; readOnly?: boolean; onChange: (patch: { title?: string; items?: TodoItem[] }) => void }) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Interactive only on a writable board AND once the card is in edit mode (the second click).
  const active = editing && !readOnly;

  useEffect(() => {
    if (focusId && inputs.current[focusId]) {
      inputs.current[focusId]!.focus();
      setFocusId(null);
    }
  }, [focusId, el.items]);

  // Entering edit mode (the second click) focuses the title, mirroring how a note focuses on its
  // second click. Until then the body is non-interactive so the first click only selects the card.
  useEffect(() => {
    if (active && document.activeElement !== titleRef.current) titleRef.current?.focus();
  }, [active]);

  const setItems = (items: TodoItem[]) => onChange({ items });
  const toggle = (id: string) => setItems(el.items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const setText = (id: string, text: string) => setItems(el.items.map((it) => (it.id === id ? { ...it, text } : it)));
  const addAfter = (idx: number) => {
    const nid = crypto.randomUUID();
    const items = [...el.items];
    items.splice(idx + 1, 0, { id: nid, text: "", done: false });
    setItems(items);
    setFocusId(nid);
  };
  const removeAt = (idx: number) => {
    if (el.items.length <= 1) return;
    const prev = el.items[idx - 1]?.id ?? el.items[idx + 1]?.id ?? null;
    setItems(el.items.filter((_, i) => i !== idx));
    if (prev) setFocusId(prev);
  };
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    // While not editing the body is non-interactive (pointer-events-none) so a click falls through
    // to the card: the first click selects, the second enters edit mode (then this turns back on).
    <div className={`flex w-full flex-col gap-1 p-2 ${active ? "" : "pointer-events-none"}`}>
      <input
        ref={titleRef}
        value={el.title ?? ""}
        onChange={(e) => onChange({ title: e.target.value })}
        onPointerDown={stop}
        readOnly={!active}
        placeholder={readOnly ? "" : "To-do"}
        className="bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400"
      />
      <div className="grid gap-0.5">
        {el.items.map((it, idx) => (
          <div key={it.id} className="flex items-center gap-2">
            <button
              onPointerDown={stop}
              onClick={() => active && toggle(it.id)}
              disabled={!active}
              aria-label={it.done ? "Mark not done" : "Mark done"}
              className={`grid h-4 w-4 shrink-0 place-items-center rounded border-2 ${it.done ? "border-primary bg-primary text-white" : "border-slate-300"}`}
            >
              {it.done && <Icon.CheckIcon className="text-[10px]" />}
            </button>
            <input
              ref={(node) => (inputs.current[it.id] = node)}
              value={it.text}
              onChange={(e) => setText(it.id, e.target.value)}
              onPointerDown={stop}
              readOnly={!active}
              onKeyDown={(e) => {
                if (!active) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAfter(idx);
                } else if (e.key === "Backspace" && it.text === "") {
                  e.preventDefault();
                  removeAt(idx);
                }
              }}
              placeholder={readOnly ? "" : "Item"}
              className={`flex-1 bg-transparent text-xs outline-none placeholder:text-slate-300 ${it.done ? "text-slate-400 line-through" : "text-slate-700"}`}
            />
          </div>
        ))}
      </div>
      {active && (
        <button onPointerDown={stop} onClick={() => addAfter(el.items.length - 1)} className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-primary">
          <Icon.PlusIcon className="text-xs" /> Add item
        </button>
      )}
    </div>
  );
}

function ElementCard({
  el,
  selected,
  editing,
  imgUrl,
  onSelect,
  onToggleSelect,
  onEdit,
  onMove,
  onResize,
  onText,
  onRegister,
  onOpen,
  onCaption,
  onCaptionFocus,
  onTodo,
  onStartLink,
  onSize,
  freshlyCreated,
  onConsumeFresh,
  embedded,
  onEmbeddedDragStart,
  onColumnTitle,
  onToggleCollapse,
  colDropIndex,
  renderColumnChild,
  readOnly,
  shrink,
  dragging,
  zoom,
  toWorld,
  onDragMove,
  onDragRelease,
}: {
  el: Element;
  selected: boolean;
  editing: boolean;
  imgUrl?: string;
  onSelect: () => void;
  onToggleSelect?: () => void;
  onEdit: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onText: (t: string) => void;
  onRegister: (e: ActiveEditor | null) => void;
  onOpen?: () => void;
  onCaption?: (html: string) => void;
  onCaptionFocus?: () => void;
  onTodo?: (patch: { title?: string; items?: TodoItem[] }) => void;
  onStartLink?: (e: React.PointerEvent) => void;
  onSize?: (id: string, h: number) => void;
  freshlyCreated?: boolean;
  onConsumeFresh?: () => void;
  embedded?: boolean;
  onEmbeddedDragStart?: (e: React.PointerEvent) => void;
  onColumnTitle?: (t: string) => void;
  onToggleCollapse?: () => void;
  colDropIndex?: number;
  renderColumnChild?: (childId: string) => React.ReactNode;
  readOnly?: boolean;
  shrink: boolean;
  dragging: boolean;
  zoom: number;
  toWorld: (cx: number, cy: number) => { x: number; y: number };
  onDragMove: (x: number, y: number) => void;
  onDragRelease: (x: number, y: number) => void;
}) {
  // Grab offset in WORLD coords so dragging works under any pan/zoom.
  const grab = useRef<{ x: number; y: number } | null>(null);
  const size = useRef<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const justSelected = useRef(false);
  const dragged = useRef(false);
  const isText = el.type === "note" || el.type === "text";
  // Element types with an inline editable text zone — these enter edit mode on the second click
  // (first click just selects), same as a note. Images only when their caption is shown.
  const editsText = isText || el.type === "todo" || (el.type === "image" && !!el.showCaption);

  // Report rendered height so connection endpoints anchor to the real card edge (auto-height cards).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!node || !onSize) return;
    const report = () => onSize(el.id, node.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el.id, onSize]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // don't let the canvas deselect / pan
    // Cmd/Ctrl-click toggles multi-selection (no drag, no edit).
    if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
      onToggleSelect();
      return;
    }
    // A freshly-dropped element is already selected; treat the first press as a fresh select so it
    // drags rather than entering edit mode.
    justSelected.current = !selected || !!freshlyCreated;
    dragged.current = false;
    if (!selected) onSelect();
    if (embedded) {
      // Inside a column: dragging reparents/reorders (handled by the parent), not free movement.
      if (!editing && !readOnly) onEmbeddedDragStart?.(e);
      return;
    }
    if (!editing && !readOnly) {
      const w = toWorld(e.clientX, e.clientY);
      grab.current = { x: w.x - el.x, y: w.y - el.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!grab.current) return;
    dragged.current = true;
    const w = toWorld(e.clientX, e.clientY);
    onMove(Math.round(w.x - grab.current.x), Math.round(w.y - grab.current.y));
    onDragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (grab.current && dragged.current) onDragRelease(e.clientX, e.clientY);
    grab.current = null;
    if (freshlyCreated) onConsumeFresh?.(); // subsequent clicks edit normally
  };
  // First click selects; a second click (already selected, no drag) enters edit mode.
  // (⌘/Ctrl-click toggles multi-selection — handled in onPointerDown; Alt-click opens.)
  const onClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) return; // multi-select handled on pointer down
    if (e.altKey && onOpen) {
      onOpen();
      return;
    }
    if (editsText && !readOnly && !justSelected.current && !editing && !dragged.current)
      onEdit();
  };
  // Non-text elements (e.g. links) open on double-click.
  const onDoubleClick = () => {
    if (!isText && !dragged.current) onOpen?.();
  };

  const startResize = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    dragged.current = true;
    size.current = { x: e.clientX, y: e.clientY, w: el.w, h: el.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  // Links are content-height (toggling preview/caption resizes the card), so resize is width-only.
  const autoSize = embedded || el.type === "link" || el.type === "image" || el.type === "todo" || el.type === "column"; // content-height
  const lockAspect = el.type === "image"; // resize keeps the image's aspect ratio
  const onResizeMove = (e: React.PointerEvent) => {
    if (!size.current) return;
    const w = Math.max(80, Math.round(size.current.w + (e.clientX - size.current.x) / zoom));
    if (lockAspect) {
      const aspect = size.current.w / size.current.h || 1;
      onResize(w, Math.max(40, Math.round(w / aspect)));
    } else if (autoSize) {
      onResize(w, el.h);
    } else {
      onResize(w, Math.max(60, Math.round(size.current.h + (e.clientY - size.current.y) / zoom)));
    }
  };
  const endResize = () => (size.current = null);

  const s = el.style ?? {};
  // lineHeight is unitless so it scales with fontSize (otherwise large text overlaps).
  const textStyle: CSSProperties = {
    color: s.color ?? "#1f2937",
    fontWeight: s.fontWeight ?? "normal",
    fontSize: s.fontSize ?? 14,
    lineHeight: 1.35,
    textAlign: s.align ?? "left",
  };

  return (
    <div
      ref={rootRef}
      data-selected-element={selected ? "true" : undefined}
      data-column-id={el.type === "column" ? el.id : undefined}
      data-col-child={embedded ? el.id : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      // Square corners, constant 2px border (colour swaps on select so there's no layout shift).
      // While dragging: bring to front + go slightly transparent; shrink when over the Delete tool.
      className={`${embedded ? "relative mb-2 w-full" : "absolute"} border-2 bg-white shadow-sm ${selected ? "border-primary ring-4 ring-primary/20" : "border-slate-200"} ${editing ? "cursor-text" : "cursor-default"} ${dragging ? "opacity-80 shadow-xl" : ""}`}
      style={{
        left: embedded ? undefined : el.x,
        top: embedded ? undefined : el.y,
        width: embedded ? undefined : el.w,
        height: autoSize ? "auto" : el.h,
        background: isText || el.type === "todo" ? (s.fill ?? "#ffffff") : "#fff",
        zIndex: dragging ? 1000 : undefined,
        transform: shrink ? "scale(0.4)" : undefined,
        transformOrigin: "center",
        transition: "transform 0.12s ease",
      }}
    >
      {isText ? (
        <div className="relative flex h-full w-full flex-col overflow-hidden">
          {s.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: s.strip }}
            />
          )}
          <div className="min-h-0 flex-1">
            <EditableNote
              id={el.id}
              html={el.type === "note" || el.type === "text" ? el.text : ""}
              editing={editing}
              style={textStyle}
              onText={onText}
              onRegister={onRegister}
            />
          </div>
          {/* Fade overflowing text out at the bottom (in the note's own colour) when not editing. */}
          {!editing && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
              style={{ background: `linear-gradient(to bottom, transparent, ${s.fill ?? "#ffffff"})` }}
            />
          )}
        </div>
      ) : el.type === "image" ? (
        <div className="flex w-full flex-col overflow-hidden bg-white">
          {el.style?.strip && <div className="h-2.5 w-full shrink-0" style={{ background: el.style.strip }} />}
          {/* Embedded (in a column): height follows the column width via aspect ratio. Free: fixed h. */}
          {imgUrl ? (
            <img src={imgUrl} alt={el.alt ?? ""} className="w-full object-cover" style={embedded ? { aspectRatio: `${el.w} / ${el.h}` } : { height: el.h }} draggable={false} />
          ) : (
            <div className="grid place-items-center text-slate-400" style={embedded ? { aspectRatio: `${el.w} / ${el.h}` } : { height: el.h }}>
              image…
            </div>
          )}
          {el.showCaption && <CaptionField html={el.caption ?? ""} editing={editing} readOnly={readOnly} onText={(h) => onCaption?.(h)} onRegister={onRegister} onFocusCaption={() => onCaptionFocus?.()} />}
        </div>
      ) : el.type === "link" ? (
        <div
          className="flex w-full flex-col overflow-hidden"
          style={{ background: el.style?.fill ?? "#ffffff" }}
        >
          {el.style?.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: el.style.strip }}
            />
          )}
          {el.embedSrc ? (
            <div className="relative w-full" style={{ height: embedHeightFor(el.embedSrc, el.w) }}>
              <iframe
                src={el.embedSrc}
                title="embed"
                className="h-full w-full"
                style={{ border: 0, pointerEvents: selected && !readOnly && !freshlyCreated ? "auto" : "none" }}
                sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
                allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
              />
              {!(selected && !readOnly && !freshlyCreated) && <div className="absolute inset-0" />}
            </div>
          ) : (
            el.image && !el.hideImage && (
              <img
                src={el.image}
                alt=""
                className="w-full object-cover"
                style={{ height: Math.round(el.w * 0.52) }}
                draggable={false}
              />
            )
          )}
          <div className="shrink-0 p-2">
            {/* Heading is a real link; stopPropagation so clicking it opens (not drag/select). */}
            <a
              href={el.url}
              target="_blank"
              rel="noopener noreferrer"
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-block truncate text-xs font-bold text-primary underline"
            >
              {el.title || el.url}
            </a>
            {el.description && !el.hideCaption && (
              <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                {el.description}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
              {faviconUrl(el.url) && <img src={faviconUrl(el.url)!} alt="" width={12} height={12} className="shrink-0 rounded-sm" draggable={false} />}
              <span className="truncate">{linkHost(el.url)}</span>
            </div>
          </div>
        </div>
      ) : el.type === "todo" ? (
        <div className="flex w-full flex-col overflow-hidden">
          {s.strip && <div className="h-2.5 w-full shrink-0" style={{ background: s.strip }} />}
          <TodoBody el={el} editing={editing} readOnly={readOnly} onChange={(p) => onTodo?.(p)} />
        </div>
      ) : el.type === "board" ? (
        <div className="flex h-full w-full flex-col overflow-hidden">
          {s.strip && <div className="h-2.5 w-full shrink-0" style={{ background: s.strip }} />}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
            <Icon.BoardIcon className="text-3xl text-primary" />
            <span className="line-clamp-2 text-xs font-bold text-slate-700">{el.title || "Board"}</span>
            <span className="text-[10px] font-bold text-slate-400">Double-click to open</span>
          </div>
        </div>
      ) : el.type === "embed" ? (
        <div className="relative flex h-full w-full flex-col overflow-hidden">
          {s.strip && <div className="h-2.5 w-full shrink-0" style={{ background: s.strip }} />}
          <iframe
            src={el.src}
            title="embed"
            className="min-h-0 w-full flex-1"
            style={{ border: 0, pointerEvents: selected && !readOnly && !freshlyCreated ? "auto" : "none" }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
          />
          {/* Swallow pointer events unless interactive, so the card can be dragged/selected
              (including right after it's dropped). */}
          {!(selected && !readOnly && !freshlyCreated) && <div className="absolute inset-0" />}
        </div>
      ) : el.type === "column" ? (
        <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: s.fill ?? "#ffffff" }}>
          {s.strip && <div className="h-2.5 w-full shrink-0" style={{ background: s.strip }} />}
          {/* Header: collapse toggle, inline title, card count. */}
          <div className="flex items-center gap-1 px-2 pt-2">
            {onToggleCollapse && (
              <button onPointerDown={(e) => e.stopPropagation()} onClick={onToggleCollapse} className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100">
                <Icon.ChevronDown className={`text-base transition-transform ${el.collapsed ? "-rotate-90" : ""}`} />
              </button>
            )}
            {/* Two-stage: a plain title until the column is selected, then an editable input. */}
            {selected && !readOnly ? (
              <input
                value={el.title ?? ""}
                onChange={(e) => onColumnTitle?.(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Column"
                className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
              />
            ) : (
              <span className={`min-w-0 flex-1 truncate text-sm font-bold ${el.title ? "text-slate-700" : "text-slate-400"}`}>{el.title || "Column"}</span>
            )}
          </div>
          <div className="px-2 pb-1 pl-8 text-[11px] font-bold text-slate-400">{el.children.length} {el.children.length === 1 ? "card" : "cards"}</div>
          {!el.collapsed && (
            <div className="flex flex-col px-2 pb-2">
              {el.children.map((cid, i) => (
                <div key={cid}>
                  {colDropIndex === i && <div className="my-0.5 h-0.5 rounded bg-primary" />}
                  {renderColumnChild?.(cid)}
                </div>
              ))}
              {colDropIndex === el.children.length && <div className="my-0.5 h-0.5 rounded bg-primary" />}
              {el.children.length === 0 && <div className="rounded-lg border-2 border-dashed border-slate-200 py-6 text-center text-[11px] text-slate-400">Drag cards here</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="grid h-full place-items-center text-slate-400">
          {el.type}
        </div>
      )}

      {selected && onStartLink && !readOnly && !embedded && (
        // Connect ball: drag onto another element to wire an arrow between them.
        <button
          onPointerDown={onStartLink}
          aria-label="Connect"
          title="Drag to connect"
          className="absolute -right-2.5 -top-2.5 z-10 h-4 w-4 cursor-crosshair rounded-full border-2 border-white bg-primary shadow"
        />
      )}

      {!readOnly && !embedded && (
      <div
        onPointerDown={startResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
        style={{
          background: `linear-gradient(135deg, transparent 50%, ${selected ? "#6e24ff" : "#cbd5e1"} 50%)`,
        }}
      />
      )}
    </div>
  );
}
