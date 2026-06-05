import { useEffect, useRef, useState } from "react";
import type { Connection } from "../types.ts";
import { ColorPicker, Icon } from "./kit/index.ts";
import { Popover, RailBtn } from "./NoteSubRail.tsx";

// Line colours — a dedicated dark-leaning palette (not the note top-strip set).
const LINE_COLORS = ["#475569", "#0f172a", "#6e24ff", "#2563eb", "#0d9488", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#db2777"];

// Contextual rail for a selected connection (Milanote-style): colour, toggle Start/End arrowheads,
// label, dashed, line weight, delete.
export function ConnectionSubRail({
  conn,
  onDone,
  onColor,
  onToggleStart,
  onToggleEnd,
  onLabel,
  onToggleDashed,
  onCycleWeight,
  onDelete,
}: {
  conn: Connection;
  onDone: () => void;
  onColor: (hex: string) => void;
  onToggleStart: () => void;
  onToggleEnd: () => void;
  onLabel: () => void;
  onToggleDashed: () => void;
  onCycleWeight: () => void;
  onDelete: () => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colorOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-note-pane]") || t.closest("[data-note-rail]")) return;
      setColorOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [colorOpen]);

  return (
    <nav data-note-rail className="relative flex w-20 shrink-0 flex-col items-center gap-1 border-r-2 border-slate-100 bg-white py-3">
      <RailBtn label="Done" icon={<Icon.ArrowLeftIcon />} onClick={onDone} />

      <div ref={colorRef} className="flex w-full justify-center">
        <RailBtn
          label="Color"
          active={colorOpen}
          icon={<span className="block h-5 w-5 rounded-md ring-2 ring-inset ring-black/10" style={{ background: conn.color ?? "#475569" }} />}
          onClick={() => setColorOpen((o) => !o)}
        />
      </div>

      <RailBtn label="Start" active={!!conn.arrowStart} icon={<Icon.ArrowLeftIcon />} onClick={onToggleStart} />
      <RailBtn label="End" active={conn.arrowEnd ?? true} icon={<Icon.ArrowRightIcon />} onClick={onToggleEnd} />
      <RailBtn label="Label" active={!!conn.label} icon={<Icon.AlignIcon />} onClick={onLabel} />
      <RailBtn label="Dashed" active={!!conn.dashed} icon={<Icon.DashIcon />} onClick={onToggleDashed} />
      <RailBtn label="Weight" icon={<Icon.WeightIcon />} onClick={onCycleWeight} />

      <span className="flex-1" />
      <RailBtn label="Delete" icon={<Icon.TrashIcon />} onClick={onDelete} />

      {colorOpen && (
        <Popover top={colorRef.current?.offsetTop ?? 0}>
          <div className="mb-2 text-xs font-bold text-slate-400">Line colour</div>
          <ColorPicker value={conn.color ?? "#475569"} palette={LINE_COLORS} onChange={onColor} />
        </Popover>
      )}
    </nav>
  );
}
