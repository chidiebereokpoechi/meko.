import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BoardConnection, type ConnStatus } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import type { Element } from "../types.ts";
import { Badge, Icon, toast } from "./kit/index.ts";
import { ToolRail, type Tool } from "./layout/ToolRail.tsx";
import { NoteSubRail } from "./NoteSubRail.tsx";
import { EditableNote, type ActiveEditor } from "./EditableNote.tsx";

export interface BoardControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  exportPng: () => void;
}

export function Canvas({ boardId, onControls }: { boardId: string; onControls: (c: BoardControls | null) => void }) {
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

  useEffect(() => {
    const c = new BoardConnection(boardId);
    connRef.current = c;
    c.onStatus = setStatus;
    const bump = () => setTick((t) => t + 1);
    c.elements.observe(bump);

    // Surface undo/redo state to the top bar.
    const mgr = c.undoMgr;
    const pushControls = () => onControls({ undo: () => c.undo(), redo: () => c.redo(), canUndo: mgr.canUndo(), canRedo: mgr.canRedo(), exportPng: () => onExport() });
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

  const elements: Element[] = connRef.current ? Array.from(connRef.current.elements.values()) : [];
  const selected = elements.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    for (const el of elements) {
      if (el.type === "image" && el.mediaId && !mediaUrls[el.mediaId]) {
        const id = el.mediaId;
        void resolveMedia(id).then((url) => url && setMediaUrls((m) => ({ ...m, [id]: url })));
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
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
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
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
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
        if (ed.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const viewportCentre = () => {
    const s = scrollRef.current;
    return s ? { x: s.scrollLeft + s.clientWidth / 2 - 110, y: s.scrollTop + s.clientHeight / 2 - 60 } : { x: 200, y: 200 };
  };

  const createNote = (x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, { id, type: "note", x, y, w: 220, h: 120, text: "", style: { fill: "#ffffff" } });
    setSelectedId(id);
    setEditingId(null);
  };

  const pickImageAt = (x: number, y: number) => {
    dropCoords.current = { x, y };
    fileRef.current?.click();
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const c = connRef.current;
    if (!file || !c) return;
    const at = dropCoords.current ?? viewportCentre();
    setBusy(true);
    try {
      const { mediaId, displayUrl } = await uploadImage(boardId, file);
      setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
      const id = crypto.randomUUID();
      c.elements.set(id, { id, type: "image", x: at.x, y: at.y, w: 240, h: 180, src: displayUrl, mediaId, alt: file.name });
      toast("Image added", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
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

  const onDrop = (e: React.DragEvent) => {
    const tool = e.dataTransfer.getData("application/x-meko-tool");
    if (!tool) return;
    e.preventDefault();
    const rect = surfaceRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 200;
    const y = rect ? e.clientY - rect.top : 200;
    if (tool === "note") createNote(x, y);
    else if (tool === "image") pickImageAt(x, y);
  };

  const createTools: Tool[] = [
    { key: "note", label: "Note", icon: <Icon.NoteIcon />, dragKey: "note", onPlace: () => createNote(viewportCentre().x, viewportCentre().y) },
    { key: "image", label: "Image", icon: <Icon.ImageIcon />, dragKey: "image", onPlace: () => pickImageAt(viewportCentre().x, viewportCentre().y), disabled: busy },
  ];

  const isNoteSelected = selected && (selected.type === "note" || selected.type === "text");

  return (
    <div className="flex flex-1 overflow-hidden">
      {isNoteSelected ? (
        <NoteSubRail
          el={selected}
          editing={editingId === selected.id}
          deleteRef={deleteRef}
          deleteActive={overDelete}
          onDone={deselect}
          onExec={exec}
          onFill={(hex) => patch(selected.id, { style: { ...selected.style, fill: hex } } as Partial<Element>)}
          onStrip={(hex) => {
            const style = { ...selected.style };
            if (hex) style.strip = hex;
            else delete style.strip;
            patch(selected.id, { style } as Partial<Element>);
          }}
          onDelete={() => selectedId && remove(selectedId)}
        />
      ) : (
        <ToolRail tools={createTools} deleteRef={deleteRef} deleteActive={overDelete} onDelete={selectedId ? () => remove(selectedId) : undefined} />
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute right-4 top-4 z-10">
          <Badge tone={status === "online" ? "green" : "slate"}>{status}</Badge>
        </div>
        <div ref={scrollRef} className="h-full w-full overflow-auto bg-[radial-gradient(circle,#d8dde6_1px,transparent_1px)] [background-size:24px_24px]" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <div ref={surfaceRef} className="relative h-[3000px] w-[4000px]" onPointerDown={deselect}>
            {elements.map((el) => (
              <ElementCard
                key={el.id}
                el={el}
                selected={el.id === selectedId}
                editing={el.id === editingId}
                imgUrl={el.type === "image" ? (el.mediaId && mediaUrls[el.mediaId]) || el.src : undefined}
                onSelect={() => setSelectedId(el.id)}
                onEdit={() => setEditingId(el.id)}
                onMove={(x, y) => patch(el.id, { x, y })}
                onResize={(w, h) => patch(el.id, { w, h })}
                onText={(text) => patch(el.id, { text } as Partial<Element>)}
                onRegister={(e) => (editorRef.current = e)}
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
  shrink: boolean;
  onDragMove: (x: number, y: number) => void;
  onDragRelease: (x: number, y: number) => void;
}) {
  const move = useRef<{ dx: number; dy: number } | null>(null);
  const size = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const justSelected = useRef(false);
  const dragged = useRef(false);
  // While dragging we render the card position:fixed at screen coords so it escapes the canvas's
  // overflow clip and overlays the rail. ox/oy keep the cursor at its grab point on the card.
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const isText = el.type === "note" || el.type === "text";

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // don't let the canvas deselect
    justSelected.current = !selected;
    dragged.current = false;
    if (!selected) onSelect();
    if (!editing) {
      move.current = { dx: e.clientX - el.x, dy: e.clientY - el.y };
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setDrag({ x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!move.current) return;
    dragged.current = true;
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    onMove(Math.round(e.clientX - move.current.dx), Math.round(e.clientY - move.current.dy));
    onDragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (move.current && dragged.current) onDragRelease(e.clientX, e.clientY);
    move.current = null;
    setDrag(null);
  };
  // First click selects; a second click (already selected, no drag) enters edit mode.
  const onClick = () => {
    if (isText && !justSelected.current && !editing && !dragged.current) onEdit();
  };

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragged.current = true;
    size.current = { x: e.clientX, y: e.clientY, w: el.w, h: el.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!size.current) return;
    onResize(Math.max(120, Math.round(size.current.w + e.clientX - size.current.x)), Math.max(60, Math.round(size.current.h + e.clientY - size.current.y)));
  };
  const endResize = () => (size.current = null);

  const s = el.style ?? {};
  // lineHeight is unitless so it scales with fontSize (otherwise large text overlaps).
  const textStyle: CSSProperties = { color: s.color ?? "#1f2937", fontWeight: s.fontWeight ?? "normal", fontSize: s.fontSize ?? 14, lineHeight: 1.35, textAlign: s.align ?? "left" };

  return (
    <div
      data-selected-element={selected ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
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
        height: el.h,
        background: isText ? s.fill ?? "#ffffff" : "#fff",
        zIndex: drag ? 2000 : undefined,
        transform: shrink ? "scale(0.4)" : undefined,
        transformOrigin: "center",
        transition: "transform 0.12s ease",
      }}
    >
      {isText ? (
        <div className="flex h-full w-full flex-col overflow-hidden">
          {s.strip && <div className="h-2.5 w-full shrink-0" style={{ background: s.strip }} />}
          <div className="min-h-0 flex-1">
            <EditableNote id={el.id} html={el.type === "note" || el.type === "text" ? el.text : ""} editing={editing} style={textStyle} onText={onText} onRegister={onRegister} />
          </div>
        </div>
      ) : el.type === "image" ? (
        imgUrl ? (
          <img src={imgUrl} alt={el.alt ?? ""} className="h-full w-full rounded object-contain" draggable={false} />
        ) : (
          <div className="grid h-full place-items-center text-slate-400">image…</div>
        )
      ) : (
        <div className="grid h-full place-items-center text-slate-400">{el.type}</div>
      )}

      <div onPointerDown={startResize} onPointerMove={onResizeMove} onPointerUp={endResize} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" style={{ background: "linear-gradient(135deg, transparent 50%, #94a3b8 50%)" }} />
    </div>
  );
}
