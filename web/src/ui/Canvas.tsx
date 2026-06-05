import { useEffect, useRef, useState } from "react";
import { BoardConnection, type ConnStatus } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import type { Element, ElementStyle } from "../types.ts";
import { Badge, Icon, toast } from "./kit/index.ts";
import { ToolRail, type Tool } from "./layout/ToolRail.tsx";

const TEXT_COLORS = ["#1f2937", "#6e24ff", "#dc2626", "#2563eb", "#16a34a"];
const FILL_COLORS = ["#ffffff", "#fff7cc", "#ffd9d9", "#d9ecff", "#d9ffe3"];
const cycle = (arr: string[], cur: string | undefined) => arr[(arr.indexOf(cur ?? arr[0]!) + 1) % arr.length]!;

export function Canvas({ boardId }: { boardId: string }) {
  const connRef = useRef<BoardConnection | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dropCoords = useRef<{ x: number; y: number } | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const patchStyle = (id: string, s: Partial<ElementStyle>) => {
    const cur = connRef.current?.elements.get(id);
    if (cur) patch(id, { style: { ...cur.style, ...s } } as Partial<Element>);
  };
  const remove = (id: string) => {
    connRef.current?.elements.delete(id);
    setSelectedId((s) => (s === id ? null : s));
  };

  // Centre of the current viewport, in canvas coordinates.
  const viewportCentre = () => {
    const s = scrollRef.current;
    return s ? { x: s.scrollLeft + s.clientWidth / 2 - 90, y: s.scrollTop + s.clientHeight / 2 - 60 } : { x: 200, y: 200 };
  };

  const createNote = (x: number, y: number) => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, { id, type: "note", x, y, w: 220, h: 120, text: "", style: { fill: "#ffffff" } });
    setSelectedId(id);
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

  // Default rail (create tools) vs contextual note sub-rail when a note is selected.
  const createTools: Tool[] = [
    { key: "note", label: "Note", icon: <Icon.NoteIcon />, dragKey: "note", onPlace: () => createNote(viewportCentre().x, viewportCentre().y) },
    { key: "image", label: "Image", icon: <Icon.ImageIcon />, dragKey: "image", onPlace: () => pickImageAt(viewportCentre().x, viewportCentre().y), disabled: busy },
    { key: "export", label: "Export", icon: <Icon.ExportIcon />, onClick: onExport, disabled: busy },
  ];

  const noteTools: Tool[] = selected
    ? [
        { key: "back", label: "Done", icon: <Icon.ArrowLeftIcon />, onClick: () => setSelectedId(null) },
        { key: "bold", label: "Bold", shortcut: "⌘B", icon: <span className="font-black">B</span>, active: selected.style?.fontWeight === "bold", onClick: () => patchStyle(selected.id, { fontWeight: selected.style?.fontWeight === "bold" ? "normal" : "bold" }) },
        { key: "smaller", label: "Smaller", icon: <span className="text-xs font-bold">A−</span>, onClick: () => patchStyle(selected.id, { fontSize: Math.max(8, (selected.style?.fontSize ?? 14) - 2) }) },
        { key: "bigger", label: "Bigger", icon: <span className="text-base font-bold">A+</span>, onClick: () => patchStyle(selected.id, { fontSize: Math.min(96, (selected.style?.fontSize ?? 14) + 2) }) },
        { key: "align", label: "Align", icon: <Icon.AlignIcon />, onClick: () => patchStyle(selected.id, { align: selected.style?.align === "left" || !selected.style?.align ? "center" : selected.style?.align === "center" ? "right" : "left" }) },
        { key: "color", label: "Text colour", icon: <span style={{ color: selected.style?.color ?? "#1f2937" }} className="font-black">A</span>, onClick: () => patchStyle(selected.id, { color: cycle(TEXT_COLORS, selected.style?.color) }) },
        { key: "fill", label: "Fill", icon: <Icon.PaintIcon />, onClick: () => patchStyle(selected.id, { fill: cycle(FILL_COLORS, selected.style?.fill) }) },
      ]
    : [];

  const isNoteSelected = selected?.type === "note" || selected?.type === "text";

  return (
    <div className="flex flex-1 overflow-hidden">
      {isNoteSelected ? (
        <ToolRail tools={noteTools} bottom={[{ key: "delete", label: "Delete", icon: <Icon.TrashIcon />, onClick: () => selected && remove(selected.id) }]} />
      ) : (
        <ToolRail tools={createTools} />
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute right-4 top-4 z-10">
          <Badge tone={status === "online" ? "green" : "slate"}>{status}</Badge>
        </div>
        <div
          ref={scrollRef}
          className="h-full w-full overflow-auto bg-[radial-gradient(circle,#d8dde6_1px,transparent_1px)] [background-size:24px_24px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <div ref={surfaceRef} className="relative h-[3000px] w-[4000px]" onPointerDown={() => setSelectedId(null)}>
            {elements.map((el) => (
              <ElementCard
                key={el.id}
                el={el}
                selected={el.id === selectedId}
                imgUrl={el.type === "image" ? (el.mediaId && mediaUrls[el.mediaId]) || el.src : undefined}
                onSelect={() => setSelectedId(el.id)}
                onMove={(x, y) => patch(el.id, { x, y })}
                onResize={(w, h) => patch(el.id, { w, h })}
                onText={(text) => patch(el.id, { text } as Partial<Element>)}
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
  imgUrl,
  onSelect,
  onMove,
  onResize,
  onText,
}: {
  el: Element;
  selected: boolean;
  imgUrl?: string;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onText: (t: string) => void;
}) {
  const move = useRef<{ dx: number; dy: number } | null>(null);
  const size = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const isText = el.type === "note" || el.type === "text";

  const startMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    move.current = { dx: e.clientX - el.x, dy: e.clientY - el.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMovePointer = (e: React.PointerEvent) => {
    if (move.current) onMove(Math.round(e.clientX - move.current.dx), Math.round(e.clientY - move.current.dy));
  };
  const endMove = () => (move.current = null);

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    size.current = { x: e.clientX, y: e.clientY, w: el.w, h: el.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizePointer = (e: React.PointerEvent) => {
    if (!size.current) return;
    onResize(Math.max(120, Math.round(size.current.w + e.clientX - size.current.x)), Math.max(60, Math.round(size.current.h + e.clientY - size.current.y)));
  };
  const endResize = () => (size.current = null);

  const s = el.style ?? {};
  return (
    <div
      // Drag the card body (the padding/border) to move; the textarea stops propagation so typing
      // doesn't move the card.
      onPointerDown={startMove}
      onPointerMove={onMovePointer}
      onPointerUp={endMove}
      className={`absolute rounded-lg border bg-white p-1 shadow-md ${selected ? "border-primary ring-2 ring-primary/30" : "border-slate-200"}`}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, background: isText ? s.fill ?? "#ffffff" : "#fff" }}
    >
      {isText ? (
        <textarea
          className="h-full w-full resize-none bg-transparent p-2 outline-none"
          style={{ color: s.color ?? "#1f2937", fontWeight: s.fontWeight ?? "normal", fontSize: s.fontSize ?? 14, textAlign: s.align ?? "left" }}
          value={el.text}
          placeholder="›"
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          onChange={(e) => onText(e.target.value)}
        />
      ) : el.type === "image" ? (
        imgUrl ? (
          <img src={imgUrl} alt={el.alt ?? ""} className="h-full w-full rounded object-contain" draggable={false} />
        ) : (
          <div className="grid h-full place-items-center text-slate-400">image…</div>
        )
      ) : (
        <div className="grid h-full place-items-center text-slate-400">{el.type}</div>
      )}

      {/* Resize handle */}
      <div
        onPointerDown={startResize}
        onPointerMove={onResizePointer}
        onPointerUp={endResize}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        style={{ background: "linear-gradient(135deg, transparent 50%, #94a3b8 50%)" }}
      />
    </div>
  );
}
