import { useEffect, useRef, useState } from "react";
import { BoardConnection, type ConnStatus } from "../lib/board.ts";
import type { Element } from "../types.ts";

export function Canvas({ boardId }: { boardId: string }) {
  const connRef = useRef<BoardConnection | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<ConnStatus>("connecting");

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

  const remove = (id: string) => connRef.current?.elements.delete(id);

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <button className="btn" onClick={addNote}>
          + Note
        </button>
        <span className={`rounded-lg px-2 py-1 font-bold ${status === "online" ? "bg-green-100 text-green-600" : "bg-slate-100 text-slate-400"}`}>
          {status}
        </span>
      </div>

      {/* Canvas surface */}
      <div className="h-full w-full overflow-auto bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:24px_24px]">
        <div className="relative h-[3000px] w-[4000px]">
          {elements.map((el) => (
            <NoteCard key={el.id} el={el} onMove={(x, y) => patch(el.id, { x, y })} onText={(text) => patch(el.id, { text } as Partial<Element>)} onDelete={() => remove(el.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NoteCard({ el, onMove, onText, onDelete }: { el: Element; onMove: (x: number, y: number) => void; onText: (t: string) => void; onDelete: () => void }) {
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

  const text = el.type === "note" || el.type === "text" ? el.text : "";
  const fill = el.style?.fill ?? "#fff7cc";

  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-lg shadow-lg"
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, background: fill }}
    >
      {/* Drag handle */}
      <div
        className="group flex h-6 cursor-move items-center justify-end bg-black/5 px-1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <button className="hidden px-1 font-bold text-slate-500 group-hover:block" onClick={onDelete} title="Delete">
          ×
        </button>
      </div>
      <textarea
        className="flex-1 resize-none bg-transparent p-2 text-xs text-slate-700 outline-none"
        value={text}
        placeholder="Type…"
        onChange={(e) => onText(e.target.value)}
      />
    </div>
  );
}
