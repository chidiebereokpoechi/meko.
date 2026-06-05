import { useEffect, useRef, useState } from "react";
import type { Element } from "../types.ts";
import { Icon } from "./kit/index.ts";
import { ColorTabs, Popover, RailBtn, StripPicker } from "./NoteSubRail.tsx";

// Common-settings rail for a multi-selection: shows only settings every selected element supports,
// applied to all. Every element has a top strip, so Color always shows (strip); Background fill
// only when ALL support it (notes/text); Caption when all are image/link; Preview when all links.
export function CommonSubRail({
  els,
  deleteRef,
  deleteActive,
  onDone,
  onFillAll,
  onStripAll,
  onToggleCaption,
  onTogglePreview,
  onDelete,
}: {
  els: Element[];
  deleteRef?: React.Ref<HTMLDivElement>;
  deleteActive?: boolean;
  onDone: () => void;
  onFillAll: (hex: string) => void;
  onStripAll: (hex: string | null) => void;
  onToggleCaption: () => void;
  onTogglePreview: () => void;
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

  const allFill = els.every((e) => e.type === "note" || e.type === "text");
  const canCaption = els.every((e) => e.type === "image" || e.type === "link");
  const canPreview = els.every((e) => e.type === "link");
  const captionVisible = (e: Element) => (e.type === "image" ? !!e.showCaption : e.type === "link" ? !e.hideCaption : false);
  const captionActive = canCaption && els.every(captionVisible);
  const previewActive = canPreview && els.every((e) => e.type === "link" && !e.hideImage);

  return (
    <nav data-note-rail className="relative flex w-20 shrink-0 flex-col items-center gap-1 border-r-2 border-slate-100 bg-white py-3">
      <RailBtn label="Done" icon={<Icon.ArrowLeftIcon />} onClick={onDone} />

      <div ref={colorRef} className="flex w-full justify-center">
        <RailBtn
          label="Color"
          active={colorOpen}
          icon={<span className="block h-5 w-5 rounded-md bg-slate-200 ring-2 ring-inset ring-slate-300" />}
          onClick={() => setColorOpen((o) => !o)}
        />
      </div>

      {canCaption && <RailBtn label="Caption" active={captionActive} icon={<Icon.AlignIcon />} onClick={onToggleCaption} />}
      {canPreview && <RailBtn label="Preview" active={previewActive} icon={<Icon.ImageIcon />} onClick={onTogglePreview} />}

      <span className="flex-1" />
      <div ref={deleteRef} className="flex w-full justify-center">
        <RailBtn label="Delete" icon={<Icon.TrashIcon />} dangerActive={deleteActive} onClick={onDelete} />
      </div>

      {colorOpen && (
        <Popover top={colorRef.current?.offsetTop ?? 0}>
          {allFill ? (
            <ColorTabs onFill={onFillAll} onStrip={onStripAll} />
          ) : (
            <>
              <div className="mb-2 text-xs font-bold text-slate-400">Color</div>
              <StripPicker onChange={onStripAll} />
            </>
          )}
        </Popover>
      )}
    </nav>
  );
}
