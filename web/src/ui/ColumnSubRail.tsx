import { useEffect, useRef, useState } from "react";
import type { Element } from "../types.ts";
import { Icon } from "./kit/index.ts";
import { ColorTabs, Popover, RailBtn, RailShell } from "./NoteSubRail.tsx";

type Col = Extract<Element, { type: "column" }>;

// Contextual rail for a selected column: background fill + top-strip colour, collapse toggle, delete.
export function ColumnSubRail({
  el,
  deleteRef,
  deleteActive,
  onDone,
  onToggleCollapse,
  onFill,
  onStrip,
  onDelete,
}: {
  el: Col;
  deleteRef?: React.Ref<HTMLDivElement>;
  deleteActive?: boolean;
  onDone: () => void;
  onToggleCollapse: () => void;
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
    <RailShell
      deleteRef={deleteRef}
      deleteActive={deleteActive}
      onDelete={onDelete}
      panels={
        colorOpen && (
          <Popover top={colorRef.current?.offsetTop ?? 0}>
            <ColorTabs fill={el.style?.fill} strip={el.style?.strip} onFill={onFill} onStrip={onStrip} />
          </Popover>
        )
      }
    >
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

      <RailBtn label={el.collapsed ? "Expand" : "Collapse"} active={!!el.collapsed} icon={<Icon.ChevronDown className={el.collapsed ? "-rotate-90" : ""} />} onClick={onToggleCollapse} />
    </RailShell>
  );
}
