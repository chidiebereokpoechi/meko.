import { useEffect, useRef, useState } from "react";
import type { Element } from "../types.ts";
import { Icon } from "./kit/index.ts";
import { Popover, RailBtn, RailShell, StripPicker } from "./NoteSubRail.tsx";

type Img = Extract<Element, { type: "image" }>;

// Contextual rail for a selected image: top-strip colour + toggle an editable caption beneath it.
export function ImageSubRail({
  el,
  deleteRef,
  deleteActive,
  onDone,
  onPatch,
  onStrip,
  onDelete,
}: {
  el: Img;
  deleteRef?: React.Ref<HTMLDivElement>;
  deleteActive?: boolean;
  onDone: () => void;
  onPatch: (p: Partial<Img>) => void;
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
            <div className="mb-2 text-xs font-bold text-slate-400">Color</div>
            <StripPicker value={el.style?.strip} onChange={onStrip} />
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
            <span className="flex h-5 w-5 flex-col overflow-hidden rounded-md bg-white ring-2 ring-inset ring-slate-300">
              <span className="h-1.5 shrink-0" style={{ background: el.style?.strip ?? "#cbd5e1" }} />
            </span>
          }
          onClick={() => setColorOpen((o) => !o)}
        />
      </div>

      <RailBtn label="Caption" active={!!el.showCaption} icon={<Icon.AlignIcon />} onClick={() => onPatch({ showCaption: !el.showCaption })} />
    </RailShell>
  );
}
