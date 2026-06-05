import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BoardConnection, type ConnStatus, type Peer } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import { unfurlLink } from "../lib/links.ts";
import type { Element } from "../types.ts";
import { Badge, Icon, toast } from "./kit/index.ts";
import { ToolRail, type Tool } from "./layout/ToolRail.tsx";
import { NoteSubRail } from "./NoteSubRail.tsx";
import { LinkSubRail } from "./LinkSubRail.tsx";
import { ImageSubRail } from "./ImageSubRail.tsx";
import { CommonSubRail } from "./CommonSubRail.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { NameModal } from "./NameModal.tsx";
import { EditableNote, type ActiveEditor } from "./EditableNote.tsx";
import { sanitizeHtml } from "../lib/sanitize.ts";

const WORLD_W = 4000;
const WORLD_H = 3000;

export interface BoardControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  exportPng: () => void;
}

export function Canvas({
  boardId,
  onControls,
}: {
  boardId: string;
  onControls: (c: BoardControls | null) => void;
}) {
  const connRef = useRef<BoardConnection | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null); // the transformed "world"
  const viewportRef = useRef<HTMLDivElement>(null); // the clipping viewport
  const deleteRef = useRef<HTMLDivElement>(null);
  const dropCoords = useRef<{ x: number; y: number } | null>(null);
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overDelete, setOverDelete] = useState(false);
  const [linkModal, setLinkModal] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  // Marquee selection rectangle in screen coords while dragging empty canvas.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeRef = useRef<{ x0: number; y0: number } | null>(null);
  const spaceRef = useRef(false); // space held → drag pans instead of marquees
  const [captionEditing, setCaptionEditing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [showComments, setShowComments] = useState(false);
  const showCommentsRef = useRef(false);
  const [commentSignal, setCommentSignal] = useState(0);
  const [unreadComments, setUnreadComments] = useState(false);

  useEffect(() => {
    const c = new BoardConnection(boardId);
    connRef.current = c;
    c.onStatus = setStatus;
    c.onPresence = setPeers;
    c.onComment = () => {
      setCommentSignal((s) => s + 1);
      if (!showCommentsRef.current) setUnreadComments(true);
    };
    const bump = () => setTick((t) => t + 1);
    c.elements.observe(bump);

    // Surface undo/redo state to the top bar.
    const mgr = c.undoMgr;
    const pushControls = () =>
      onControls({
        undo: () => c.undo(),
        redo: () => c.redo(),
        canUndo: mgr.canUndo(),
        canRedo: mgr.canRedo(),
        exportPng: () => onExport(),
      });
    mgr.on("stack-item-added", pushControls);
    mgr.on("stack-item-popped", pushControls);
    pushControls();

    void c.connect();
    return () => {
      mgr.off("stack-item-added", pushControls);
      mgr.off("stack-item-popped", pushControls);
      c.elements.unobserve(bump);
      c.destroy();
      connRef.current = null;
      onControls(null);
    };
  }, [boardId]);

  const elements: Element[] = connRef.current
    ? Array.from(connRef.current.elements.values())
    : [];
  // Single-element ops/rails use selectedId (only when exactly one is selected); marquee can
  // select many.
  const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const selectId = (id: string) => setSelectedIds([id]);

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
  const remove = (id: string) => {
    connRef.current?.elements.delete(id);
    setSelectedIds((ids) => ids.filter((x) => x !== id));
    setEditingId((s) => (s === id ? null : s));
  };
  const removeMany = (ids: string[]) => {
    ids.forEach((id) => connRef.current?.elements.delete(id));
    setSelectedIds([]);
    setEditingId(null);
  };
  const deselect = () => {
    setSelectedIds([]);
    setEditingId(null);
    setCaptionEditing(false);
  };

  const overDeleteZone = (x: number, y: number) => {
    const r = deleteRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const handleDragMove = (id: string, x: number, y: number) => {
    setDraggingId(id);
    setOverDelete(overDeleteZone(x, y));
  };
  // Drop over the Delete tool removes the element; otherwise just end the drag.
  const handleDragRelease = (id: string, x: number, y: number) => {
    if (overDeleteZone(x, y)) remove(id);
    setDraggingId(null);
    setOverDelete(false);
  };

  // Backspace/Delete removes the selected element — unless a text field is focused (editing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, editingId]);

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
    if (spaceRef.current || e.button === 1) {
      panRef.current = { cx: e.clientX, cy: e.clientY, px: view.x, py: view.y };
    } else {
      marqueeRef.current = { x0: e.clientX, y0: e.clientY };
      setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onViewportPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    connRef.current?.sendCursor(w.x, w.y);
    const p = panRef.current;
    if (p) {
      setViewClamped((v) => ({ ...v, x: p.px + e.clientX - p.cx, y: p.py + e.clientY - p.cy }));
      return;
    }
    const m = marqueeRef.current;
    if (m) setMarquee({ x0: m.x0, y0: m.y0, x1: e.clientX, y1: e.clientY });
  };
  const onViewportPointerUp = () => {
    panRef.current = null;
    const m = marqueeRef.current;
    marqueeRef.current = null;
    if (!m) return;
    if (!marquee) return;
    const moved = Math.abs(marquee.x1 - marquee.x0) + Math.abs(marquee.y1 - marquee.y0) > 4;
    if (!moved) {
      deselect(); // a click on empty canvas
    } else {
      // Select elements intersecting the marquee (world coords).
      const a = toWorld(Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1));
      const b = toWorld(Math.max(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1));
      const hits = elements.filter((el) => el.x < b.x && el.x + el.w > a.x && el.y < b.y && el.y + el.h > a.y).map((el) => el.id);
      setSelectedIds(hits);
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
    selectId(id);
    setEditingId(null);
  };

  const pickImageAt = (x: number, y: number) => {
    dropCoords.current = { x, y };
    fileRef.current?.click();
  };

  // Open the link dialog at a drop point; createLink unfurls then drops the preview card.
  const createLink = async (url: string, coords?: { x: number; y: number }) => {
    const c = connRef.current;
    const at = coords ?? linkModal ?? viewportCentre();
    if (!c) return;
    try {
      const u = await unfurlLink(boardId, url);
      const id = crypto.randomUUID();
      c.elements.set(id, {
        id,
        type: "link",
        x: at.x,
        y: at.y,
        w: 260,
        h: u.imageUrl ? 230 : 96,
        url: u.url || url,
        title: u.title ?? undefined,
        description: u.description ?? undefined,
        image: u.imageUrl ?? undefined,
      });
      selectId(id);
    } catch {
      toast("Couldn't load that link", "error");
    }
  };

  const addImageFile = async (file: File, x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    setBusy(true);
    try {
      const { mediaId, displayUrl } = await uploadImage(boardId, file);
      setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
      const { w, h } = await loadImageSize(displayUrl);
      const id = crypto.randomUUID();
      const width = 280;
      c.elements.set(id, { id, type: "image", x, y, w: width, h: Math.max(40, Math.round((width * h) / w)), src: displayUrl, mediaId, alt: file.name });
      selectId(id);
      toast("Image added", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  };

  // Image element from an external URL (no upload) — used for image URLs dropped/pasted in.
  const createImageUrl = async (src: string, x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const { w, h } = await loadImageSize(src);
    const width = 280;
    const id = crypto.randomUUID();
    c.elements.set(id, { id, type: "image", x, y, w: width, h: Math.max(40, Math.round((width * h) / w)), src });
    selectId(id);
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
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
    const { x, y } = toWorld(e.clientX, e.clientY);

    const tool = e.dataTransfer.getData("application/x-meko-tool");

    if (tool) {
      if (tool === "note") createNote(x, y);
      else if (tool === "image") pickImageAt(x, y);
      else if (tool === "link") setLinkModal({ x, y });
      return;
    }

    const images = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (images.length) {
      images.forEach((f, i) => void addImageFile(f, x + i * 24, y + i * 24));
      return;
    }

    const uri = (
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain")
    ).trim();
    if (!uri) return;
    const first = uri.split(/\s+/)[0]!;
    if (isImageUrl(first)) createImageUrl(first, x, y);
    else if (/^https?:\/\//i.test(first)) void createLink(first, { x, y });
    else createNote(x, y, uri.slice(0, 10000));
  };

  // Paste anywhere on the board: an image from the clipboard uploads; an image URL becomes an
  // image; another URL becomes a link; other text becomes a note. Skipped while editing a note so
  // normal text paste works.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
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
      const { x, y } = viewportCentre();
      const file = Array.from(dt.items)
        .find((it) => it.kind === "file" && it.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void addImageFile(file, x, y);
        return;
      }
      const text = dt.getData("text").trim();
      if (!text) return;
      const first = text.split(/\s+/)[0]!;
      if (isImageUrl(first)) createImageUrl(first, x, y);
      else if (/^https?:\/\//i.test(first)) void createLink(first, { x, y });
      else createNote(x, y, text.slice(0, 10000));
      e.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editingId]);

  const createTools: Tool[] = [
    {
      key: "note",
      label: "Note",
      icon: <Icon.NoteIcon />,
      dragKey: "note",
      onPlace: () => createNote(viewportCentre().x, viewportCentre().y),
    },
    {
      key: "image",
      label: "Image",
      icon: <Icon.ImageIcon />,
      dragKey: "image",
      onPlace: () => pickImageAt(viewportCentre().x, viewportCentre().y),
      disabled: busy,
    },
    {
      key: "link",
      label: "Link",
      icon: <Icon.LinkIcon />,
      dragKey: "link",
      onPlace: () => setLinkModal(viewportCentre()),
    },
  ];

  const isNoteSelected =
    selected && (selected.type === "note" || selected.type === "text");
  const isLinkSelected = selected && selected.type === "link";
  const isImageSelected = selected && selected.type === "image";
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

  return (
    <div className="flex flex-1 overflow-hidden">
      {isMulti ? (
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
        onClose={() => setLinkModal(null)}
        onSubmit={createLink}
      />

      <div
        ref={viewportRef}
        className="relative flex-1 touch-none overflow-hidden bg-slate-50"
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
            className="absolute left-0 top-0 origin-top-left bg-[radial-gradient(circle,#d8dde6_1px,transparent_1px)] [background-size:24px_24px]"
            style={{ width: WORLD_W, height: WORLD_H, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          >
            {elements.map((el) => (
              <ElementCard
                key={el.id}
                el={el}
                selected={selectedIds.includes(el.id)}
                editing={el.id === editingId}
                imgUrl={
                  el.type === "image"
                    ? (el.mediaId && mediaUrls[el.mediaId]) || el.src
                    : undefined
                }
                onSelect={() => selectId(el.id)}
                onEdit={() => setEditingId(el.id)}
                onMove={(x, y) => moveElement(el.id, x, y)}
                onResize={(w, h) => patch(el.id, { w, h })}
                onText={(text) => patch(el.id, { text } as Partial<Element>)}
                onRegister={(e) => (editorRef.current = e)}
                onOpen={
                  el.type === "link"
                    ? () => window.open(el.url, "_blank", "noopener,noreferrer")
                    : undefined
                }
                onCaption={el.type === "image" ? (h) => patch(el.id, { caption: h } as Partial<Element>) : undefined}
                onCaptionFocus={() => {
                  selectId(el.id);
                  setCaptionEditing(true);
                }}
                shrink={draggingId === el.id && overDelete}
                dragging={draggingId === el.id}
                zoom={view.zoom}
                toWorld={toWorld}
                onDragMove={(x, y) => handleDragMove(el.id, x, y)}
                onDragRelease={(x, y) => handleDragRelease(el.id, x, y)}
              />
            ))}
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

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
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
function CaptionField({ html, onText, onRegister, onFocusCaption }: { html: string; onText: (html: string) => void; onRegister: (e: ActiveEditor) => void; onFocusCaption: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
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
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-empty-placeholder="Add a caption"
      className="note-editable border-t-2 border-slate-100 p-2 text-xs text-slate-700 outline-none"
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={() => {
        onRegister({ el: ref.current!, commit: () => onText(sanitizeHtml(ref.current!.innerHTML)) });
        onFocusCaption();
      }}
      onInput={() => onText(sanitizeHtml(ref.current!.innerHTML))}
    />
  );
}

function ElementCard({
  el,
  selected,
  editing,
  imgUrl,
  onSelect,
  onEdit,
  onMove,
  onResize,
  onText,
  onRegister,
  onOpen,
  onCaption,
  onCaptionFocus,
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
  onEdit: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onText: (t: string) => void;
  onRegister: (e: ActiveEditor | null) => void;
  onOpen?: () => void;
  onCaption?: (html: string) => void;
  onCaptionFocus?: () => void;
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

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // don't let the canvas deselect / pan
    justSelected.current = !selected;
    dragged.current = false;
    if (!selected) onSelect();
    if (!editing) {
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
  };
  // First click selects; a second click (already selected, no drag) enters edit mode.
  // Modifier-click (⌘/Ctrl/Alt) opens link elements.
  const onClick = (e: React.MouseEvent) => {
    if ((e.metaKey || e.ctrlKey || e.altKey) && onOpen) {
      onOpen();
      return;
    }
    if (isText && !justSelected.current && !editing && !dragged.current)
      onEdit();
  };
  // Non-text elements (e.g. links) open on double-click.
  const onDoubleClick = () => {
    if (!isText && !dragged.current) onOpen?.();
  };

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragged.current = true;
    size.current = { x: e.clientX, y: e.clientY, w: el.w, h: el.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  // Links are content-height (toggling preview/caption resizes the card), so resize is width-only.
  const autoSize = el.type === "link" || el.type === "image"; // content-height (image + caption)
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
      data-selected-element={selected ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      // Square corners, constant 2px border (colour swaps on select so there's no layout shift).
      // While dragging: bring to front + go slightly transparent; shrink when over the Delete tool.
      className={`absolute border-2 bg-white shadow-sm ${selected ? "border-primary ring-4 ring-primary/20" : "border-slate-200"} ${editing ? "cursor-text" : "cursor-default"} ${dragging ? "opacity-80 shadow-xl" : ""}`}
      style={{
        left: el.x,
        top: el.y,
        width: el.w,
        height: autoSize ? "auto" : el.h,
        background: isText ? (s.fill ?? "#ffffff") : "#fff",
        zIndex: dragging ? 1000 : undefined,
        transform: shrink ? "scale(0.4)" : undefined,
        transformOrigin: "center",
        transition: "transform 0.12s ease",
      }}
    >
      {isText ? (
        <div className="flex h-full w-full flex-col overflow-hidden">
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
        </div>
      ) : el.type === "image" ? (
        <div className="flex w-full flex-col overflow-hidden bg-white">
          {el.style?.strip && <div className="h-2.5 w-full shrink-0" style={{ background: el.style.strip }} />}
          {imgUrl ? (
            <img src={imgUrl} alt={el.alt ?? ""} className="w-full object-cover" style={{ height: el.h }} draggable={false} />
          ) : (
            <div className="grid place-items-center text-slate-400" style={{ height: el.h }}>
              image…
            </div>
          )}
          {el.showCaption && <CaptionField html={el.caption ?? ""} onText={(h) => onCaption?.(h)} onRegister={onRegister} onFocusCaption={() => onCaptionFocus?.()} />}
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
          {el.image && !el.hideImage && (
            <img
              src={el.image}
              alt=""
              className="w-full object-cover"
              style={{ height: Math.round(el.w * 0.52) }}
              draggable={false}
            />
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
            <div className="mt-1 truncate text-[10px] text-slate-400">
              {linkHost(el.url)}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid h-full place-items-center text-slate-400">
          {el.type}
        </div>
      )}

      <div
        onPointerDown={startResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
        style={{
          background: `linear-gradient(135deg, transparent 50%, ${selected ? "#6e24ff" : "#cbd5e1"} 50%)`,
        }}
      />
    </div>
  );
}
