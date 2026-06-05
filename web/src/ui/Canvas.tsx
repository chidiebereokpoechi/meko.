import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BoardConnection, type ConnStatus } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import { unfurlLink } from "../lib/links.ts";
import type { Element } from "../types.ts";
import { Badge, Icon, toast } from "./kit/index.ts";
import { ToolRail, type Tool } from "./layout/ToolRail.tsx";
import { NoteSubRail } from "./NoteSubRail.tsx";
import { LinkSubRail } from "./LinkSubRail.tsx";
import { ImageSubRail } from "./ImageSubRail.tsx";
import { NameModal } from "./NameModal.tsx";
import { EditableNote, type ActiveEditor } from "./EditableNote.tsx";
import { sanitizeHtml } from "../lib/sanitize.ts";

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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLDivElement>(null);
  const dropCoords = useRef<{ x: number; y: number } | null>(null);
  const editorRef = useRef<ActiveEditor | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overDelete, setOverDelete] = useState(false);
  const [linkModal, setLinkModal] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const [captionEditing, setCaptionEditing] = useState(false);

  useEffect(() => {
    const c = new BoardConnection(boardId);
    connRef.current = c;
    c.onStatus = setStatus;
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
  const selected = elements.find((e) => e.id === selectedId) ?? null;

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
  const remove = (id: string) => {
    connRef.current?.elements.delete(id);
    setSelectedId((s) => (s === id ? null : s));
    setEditingId((s) => (s === id ? null : s));
  };
  const deselect = () => {
    setSelectedId(null);
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
      if (selectedId) {
        e.preventDefault();
        remove(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingId]);

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

  const viewportCentre = () => {
    const s = scrollRef.current;
    return s
      ? {
          x: s.scrollLeft + s.clientWidth / 2 - 110,
          y: s.scrollTop + s.clientHeight / 2 - 60,
        }
      : { x: 200, y: 200 };
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
    setSelectedId(id);
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
      setSelectedId(id);
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
      setSelectedId(id);
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
    setSelectedId(id);
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
    const rect = surfaceRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 200;
    const y = rect ? e.clientY - rect.top : 200;

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

  return (
    <div className="flex flex-1 overflow-hidden">
      {isNoteSelected ? (
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
          onDelete={selectedId ? () => remove(selectedId) : undefined}
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

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute right-4 top-4 z-10">
          <Badge tone={status === "online" ? "green" : "slate"}>{status}</Badge>
        </div>
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 m-2 rounded-xl border-2 border-dashed border-primary bg-primary/5" />
        )}
        <div
          ref={scrollRef}
          className="h-full w-full overflow-auto bg-[radial-gradient(circle,#d8dde6_1px,transparent_1px)] [background-size:24px_24px]"
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
            ref={surfaceRef}
            className="relative h-[3000px] w-[4000px]"
            onPointerDown={deselect}
          >
            {elements.map((el) => (
              <ElementCard
                key={el.id}
                el={el}
                selected={el.id === selectedId}
                editing={el.id === editingId}
                imgUrl={
                  el.type === "image"
                    ? (el.mediaId && mediaUrls[el.mediaId]) || el.src
                    : undefined
                }
                onSelect={() => setSelectedId(el.id)}
                onEdit={() => setEditingId(el.id)}
                onMove={(x, y) => patch(el.id, { x, y })}
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
                  setSelectedId(el.id);
                  setCaptionEditing(true);
                }}
                shrink={draggingId === el.id && overDelete}
                onDragMove={(x, y) => handleDragMove(el.id, x, y)}
                onDragRelease={(x, y) => handleDragRelease(el.id, x, y)}
              />
            ))}
          </div>
        </div>
      </div>
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
  onDragMove: (x: number, y: number) => void;
  onDragRelease: (x: number, y: number) => void;
}) {
  const move = useRef<{ dx: number; dy: number } | null>(null);
  const size = useRef<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const justSelected = useRef(false);
  const dragged = useRef(false);
  // While dragging we render the card position:fixed at screen coords so it escapes the canvas's
  // overflow clip and overlays the rail. ox/oy keep the cursor at its grab point on the card.
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);
  const isText = el.type === "note" || el.type === "text";

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // don't let the canvas deselect
    justSelected.current = !selected;
    dragged.current = false;
    if (!selected) onSelect();
    if (!editing) {
      move.current = { dx: e.clientX - el.x, dy: e.clientY - el.y };
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setDrag({
        x: e.clientX,
        y: e.clientY,
        ox: e.clientX - r.left,
        oy: e.clientY - r.top,
      });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!move.current) return;
    dragged.current = true;
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    onMove(
      Math.round(e.clientX - move.current.dx),
      Math.round(e.clientY - move.current.dy),
    );
    onDragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (move.current && dragged.current) onDragRelease(e.clientX, e.clientY);
    move.current = null;
    setDrag(null);
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
    const w = Math.max(80, Math.round(size.current.w + e.clientX - size.current.x));
    if (lockAspect) {
      const aspect = size.current.w / size.current.h || 1;
      onResize(w, Math.max(40, Math.round(w / aspect)));
    } else if (autoSize) {
      onResize(w, el.h);
    } else {
      onResize(w, Math.max(60, Math.round(size.current.h + e.clientY - size.current.y)));
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
      className={`absolute border-2 bg-white shadow-sm ${selected ? "border-primary ring-4 ring-primary/20" : "border-slate-200"} ${editing ? "cursor-text" : "cursor-default"} ${drag ? "opacity-80 shadow-xl" : ""}`}
      style={{
        // position:fixed (drag) overrides the `absolute` class, escaping the canvas overflow clip
        // so the card floats over the rail/top bar.
        position: drag ? "fixed" : undefined,
        left: drag ? drag.x - drag.ox : el.x,
        top: drag ? drag.y - drag.oy : el.y,
        width: el.w,
        height: autoSize ? "auto" : el.h,
        background: isText ? (s.fill ?? "#ffffff") : "#fff",
        zIndex: drag ? 2000 : undefined,
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
