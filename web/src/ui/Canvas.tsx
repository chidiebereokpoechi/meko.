import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BoardConnection, type ConnStatus } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import type { Element } from "../types.ts";
import { Badge, Icon, toast } from "./kit/index.ts";
import { ToolRail, type Tool } from "./layout/ToolRail.tsx";
import { NoteSubRail } from "./NoteSubRail.tsx";
import { EditableNote, type ActiveEditor } from "./EditableNote.tsx";

export function Canvas({ boardId }: { boardId: string }) {
  const connRef = useRef<BoardConnection | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dropCoords = useRef<{ x: number; y: number } | null>(null);
  const editorRef = useRef<ActiveEditor | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const c = new BoardConnection(boardId);
    connRef.current = c;
    c.onStatus = setStatus;
    const bump = () => setTick((t) => t + 1);
    c.elements.observe(bump);
    void c.connect();
    return () => {
      c.elements.unobserve(bump);
      c.destroy();
      connRef.current = null;
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

  // Run a rich-text command on the focused note editor, then persist its sanitised HTML.
  const exec = (command: string, value?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.el.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    ed.commit();
  };

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
    { key: "export", label: "Export", icon: <Icon.ExportIcon />, onClick: onExport, disabled: busy },
  ];

  const isNoteSelected = selected && (selected.type === "note" || selected.type === "text");

  return (
    <div className="flex flex-1 overflow-hidden">
      {isNoteSelected ? (
        <NoteSubRail el={selected} onDone={deselect} onExec={exec} onFill={(hex) => patch(selected.id, { style: { ...selected.style, fill: hex } } as Partial<Element>)} onDelete={() => remove(selected.id)} />
      ) : (
        <ToolRail tools={createTools} />
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
}) {
  const move = useRef<{ dx: number; dy: number } | null>(null);
  const size = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const justSelected = useRef(false);
  const dragged = useRef(false);
  const isText = el.type === "note" || el.type === "text";

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // don't let the canvas deselect
    justSelected.current = !selected;
    dragged.current = false;
    if (!selected) onSelect();
    if (!editing) {
      move.current = { dx: e.clientX - el.x, dy: e.clientY - el.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!move.current) return;
    dragged.current = true;
    onMove(Math.round(e.clientX - move.current.dx), Math.round(e.clientY - move.current.dy));
  };
  const onPointerUp = () => (move.current = null);
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
  const textStyle: CSSProperties = { color: s.color ?? "#1f2937", fontWeight: s.fontWeight ?? "normal", fontSize: s.fontSize ?? 14, textAlign: s.align ?? "left" };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      className={`absolute rounded-lg border bg-white shadow-md ${selected ? "border-primary ring-2 ring-primary/30" : "border-slate-200"} ${editing ? "cursor-text" : "cursor-default"}`}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, background: isText ? s.fill ?? "#ffffff" : "#fff" }}
    >
      {isText ? (
        <EditableNote id={el.id} html={el.type === "note" || el.type === "text" ? el.text : ""} editing={editing} style={textStyle} onText={onText} onRegister={onRegister} />
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
