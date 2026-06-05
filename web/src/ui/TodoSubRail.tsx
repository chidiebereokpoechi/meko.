import { useEffect, useRef, useState } from "react";
import type { Element } from "../types.ts";
import { Icon } from "./kit/index.ts";
import { ColorTabs, Popover, RailBtn } from "./NoteSubRail.tsx";

type Todo = Extract<Element, { type: "todo" }>;

// Contextual rail for a selected to-do: background fill + top-strip colour (same palette as a
// note), plus delete. Items are edited inline on the card itself.
export function TodoSubRail({
  el,
  deleteRef,
  deleteActive,
  onDone,
  onFill,
  onStrip,
  onDelete,
}: {
  el: Todo;
  deleteRef?: React.Ref<HTMLDivElement>;
  deleteActive?: boolean;
  onDone: () => void;
  onFill: (hex: string) => void;
  onStrip: (hex: string | null) => void;
  onDelete: () => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colorOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-note-pane]") || t.closest("[data-note-rail]") || t.closest("[data-selected-element]")) return;
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
          icon={
            <span className="flex h-5 w-5 flex-col overflow-hidden rounded-md ring-2 ring-inset ring-slate-300" style={{ background: el.style?.fill ?? "#ffffff" }}>
              <span className="h-1.5 shrink-0" style={{ background: el.style?.strip ?? "#cbd5e1" }} />
            </span>
          }
          onClick={() => setColorOpen((o) => !o)}
        />
      </div>

      <span className="flex-1" />
      <div ref={deleteRef} className="flex w-full justify-center">
        <RailBtn label="Delete" icon={<Icon.TrashIcon />} dangerActive={deleteActive} onClick={onDelete} />
      </div>

      {colorOpen && (
        <Popover top={colorRef.current?.offsetTop ?? 0}>
          <ColorTabs fill={el.style?.fill} strip={el.style?.strip} onFill={onFill} onStrip={onStrip} />
        </Popover>
      )}
    </nav>
  );
}
