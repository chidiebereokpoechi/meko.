import { useEffect, useRef, useState } from "react";
import { BoardConnection, type ConnStatus } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import type { Element } from "../types.ts";
import { Badge, Icon, toast } from "./kit/index.ts";
import { ToolRail, type Tool } from "./layout/ToolRail.tsx";

export function Canvas({ boardId }: { boardId: string }) {
  const connRef = useRef<BoardConnection | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [busy, setBusy] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});

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

  // Re-resolve fresh display URLs for image elements (the URL on the element expires).
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

  const addNote = () => {
    const c = connRef.current;
    if (!c) return;
    const id = crypto.randomUUID();
    c.elements.set(id, { id, type: "note", x: 120 + Math.random() * 240, y: 120 + Math.random() * 160, w: 180, h: 120, text: "", style: { fill: "#fff7cc" } });
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const c = connRef.current;
    if (!file || !c) return;
    setBusy(true);
    try {
      const { mediaId, displayUrl } = await uploadImage(boardId, file);
      setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
      const id = crypto.randomUUID();
      c.elements.set(id, { id, type: "image", x: 160, y: 160, w: 240, h: 180, src: displayUrl, mediaId, alt: file.name });
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
      const url = await requestExport(boardId, "png");
      window.open(url, "_blank");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const tools: Tool[] = [
    { key: "note", label: "Note", icon: <Icon.NoteIcon />, onClick: addNote, active: true },
    { key: "image", label: "Image", icon: <Icon.ImageIcon />, onClick: () => fileRef.current?.click(), disabled: busy },
    { key: "export", label: "Export", icon: <Icon.ExportIcon />, onClick: onExport, disabled: busy },
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      <ToolRail tools={tools} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />

      <div className="relative flex-1 overflow-hidden">
        <div className="absolute right-4 top-4 z-10">
          <Badge tone={status === "online" ? "green" : "slate"}>{status}</Badge>
        </div>
        <div className="h-full w-full overflow-auto bg-[radial-gradient(circle,#d8dde6_1px,transparent_1px)] [background-size:24px_24px]">
          <div className="relative h-[3000px] w-[4000px]">
            {elements.map((el) => (
              <ElementCard
                key={el.id}
                el={el}
                imgUrl={el.type === "image" ? (el.mediaId && mediaUrls[el.mediaId]) || el.src : undefined}
                onMove={(x, y) => patch(el.id, { x, y })}
                onText={(text) => patch(el.id, { text } as Partial<Element>)}
                onDelete={() => connRef.current?.elements.delete(el.id)}
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
  imgUrl,
  onMove,
  onText,
  onDelete,
}: {
  el: Element;
  imgUrl?: string;
  onMove: (x: number, y: number) => void;
  onText: (t: string) => void;
  onDelete: () => void;
}) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - el.x, dy: e.clientY - el.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) onMove(Math.round(e.clientX - drag.current.dx), Math.round(e.clientY - drag.current.dy));
  };
  const onPointerUp = () => (drag.current = null);

  const isText = el.type === "note" || el.type === "text";
  return (
    <div className="absolute flex flex-col overflow-hidden rounded-xl shadow-lg" style={{ left: el.x, top: el.y, width: el.w, height: el.h, background: isText ? el.style?.fill ?? "#fff7cc" : "#fff" }}>
      <div className="group flex h-6 shrink-0 cursor-move items-center justify-end bg-black/5 px-1" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <button className="hidden px-1 font-bold text-slate-500 group-hover:block" onClick={onDelete} title="Delete">
          ×
        </button>
      </div>
      {isText ? (
        <textarea className="flex-1 resize-none bg-transparent p-2 text-xs text-slate-700 outline-none" value={el.text} placeholder="Type…" onChange={(e) => onText(e.target.value)} />
      ) : el.type === "image" ? (
        imgUrl ? (
          <img src={imgUrl} alt={el.alt ?? ""} className="h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="grid flex-1 place-items-center text-slate-400">image…</div>
        )
      ) : (
        <div className="grid flex-1 place-items-center text-slate-400">{el.type}</div>
      )}
    </div>
  );
}
