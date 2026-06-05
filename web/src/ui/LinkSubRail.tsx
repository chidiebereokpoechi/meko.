import { useEffect, useRef, useState } from "react";
import type { Element } from "../types.ts";
import { Icon } from "./kit/index.ts";
import { Popover, RailBtn, StripPicker } from "./NoteSubRail.tsx";

type Link = Extract<Element, { type: "link" }>;

// Contextual rail for a selected link: toggle preview image, toggle caption, change colour
// (background + top strip, same as a note). Reuses the shared rail primitives.
export function LinkSubRail({
  el,
  deleteRef,
  deleteActive,
  onDone,
  onPatch,
  onStrip,
  onDelete,
}: {
  el: Link;
  deleteRef?: React.Ref<HTMLDivElement>;
  deleteActive?: boolean;
  onDone: () => void;
  onPatch: (p: Partial<Link>) => void;
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
          label="Top strip"
          active={colorOpen}
          icon={
            <span className="flex h-5 w-5 flex-col overflow-hidden rounded-md ring-2 ring-inset ring-slate-300 bg-white">
              <span className="h-1.5 shrink-0" style={{ background: el.style?.strip ?? "#cbd5e1" }} />
            </span>
          }
          onClick={() => setColorOpen((o) => !o)}
        />
      </div>

      {el.image && <RailBtn label="Preview" active={!el.hideImage} icon={<Icon.ImageIcon />} onClick={() => onPatch({ hideImage: !el.hideImage })} />}
      {el.description && <RailBtn label="Caption" active={!el.hideCaption} icon={<Icon.AlignIcon />} onClick={() => onPatch({ hideCaption: !el.hideCaption })} />}

      <span className="flex-1" />
      <div ref={deleteRef} className="flex w-full justify-center">
        <RailBtn label="Delete" icon={<Icon.TrashIcon />} dangerActive={deleteActive} onClick={onDelete} />
      </div>

      {colorOpen && (
        <Popover top={colorRef.current?.offsetTop ?? 0}>
          <div className="mb-2 text-xs font-bold text-slate-400">Top strip</div>
          <StripPicker value={el.style?.strip} onChange={onStrip} />
        </Popover>
      )}
    </nav>
  );
}
