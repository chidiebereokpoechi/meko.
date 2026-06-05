import { useEffect, useRef, useState } from "react";
import { BoardConnection, type ConnStatus } from "../lib/board.ts";
import { uploadImage, resolveMedia } from "../lib/media.ts";
import { requestExport } from "../lib/exports.ts";
import type { Element } from "../types.ts";

export function Canvas({ boardId }: { boardId: string }) {
  const connRef = useRef<BoardConnection | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [busy, setBusy] = useState<string | null>(null);
  // Fresh presigned display URLs keyed by mediaId (the URL on the element expires).
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

  // Resolve display URLs for any image element whose mediaId we haven't fetched yet.
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
    const note: Element = { id, type: "note", x: 80 + Math.random() * 240, y: 80 + Math.random() * 160, w: 180, h: 120, text: "", style: { fill: "#fff7cc" } };
    c.elements.set(id, note);
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const c = connRef.current;
    if (!file || !c) return;
    setBusy("Uploading…");
    try {
      const { mediaId, displayUrl } = await uploadImage(boardId, file);
      setMediaUrls((m) => ({ ...m, [mediaId]: displayUrl }));
      const id = crypto.randomUUID();
      const el: Element = { id, type: "image", x: 120, y: 120, w: 240, h: 180, src: displayUrl, mediaId, alt: file.name };
      c.elements.set(id, el);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const onExport = async () => {
    setBusy("Exporting…");
    try {
      const url = await requestExport(boardId, "png");
      window.open(url, "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = (id: string) => connRef.current?.elements.delete(id);

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <button className="btn" onClick={addNote}>
          + Note
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          + Image
        </button>
        <button className="btn-ghost bg-white shadow" onClick={onExport}>
          Export PNG
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
        {busy && <span className="rounded-lg bg-white px-2 py-1 font-bold text-primary shadow">{busy}</span>}
        <span className={`rounded-lg px-2 py-1 font-bold ${status === "online" ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400"}`}>
          {status}
        </span>
      </div>

      {/* Canvas surface */}
      <div className="h-full w-full overflow-auto bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]">
        <div className="relative h-[3000px] w-[4000px]">
          {elements.map((el) => (
            <ElementCard
              key={el.id}
              el={el}
              imgUrl={el.type === "image" ? (el.mediaId && mediaUrls[el.mediaId]) || el.src : undefined}
              onMove={(x, y) => patch(el.id, { x, y })}
              onText={(text) => patch(el.id, { text } as Partial<Element>)}
              onDelete={() => remove(el.id)}
            />
          ))}
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
    if (!drag.current) return;
    onMove(Math.round(e.clientX - drag.current.dx), Math.round(e.clientY - drag.current.dy));
  };
  const onPointerUp = () => (drag.current = null);

  const isText = el.type === "note" || el.type === "text";
  const fill = isText ? (el.style?.fill ?? "#fff7cc") : "#fff";

  return (
    <div className="absolute flex flex-col overflow-hidden rounded-lg shadow-lg" style={{ left: el.x, top: el.y, width: el.w, height: el.h, background: fill }}>
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
