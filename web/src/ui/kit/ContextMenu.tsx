import { useEffect, useRef } from "react";

export type MenuItem =
  | "separator"
  | { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; onClick: () => void };

// Right-click menu: fixed at the cursor, flips to stay on-screen, dismiss on outside click / Esc /
// scroll. Items are a flat list with optional "separator" dividers.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);

  // Keep the menu within the viewport.
  const flipX = x > window.innerWidth - 240;
  const flipY = y > window.innerHeight - items.length * 36;

  return (
    <div
      ref={ref}
      className="fixed z-[200] w-56 rounded-lg border-2 border-line-subtle bg-white p-1 shadow-xl"
      style={{ left: flipX ? undefined : x, right: flipX ? window.innerWidth - x : undefined, top: flipY ? undefined : y, bottom: flipY ? window.innerHeight - y : undefined }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={i} className="my-1 border-t-2 border-line-subtle" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              it.onClick();
              onClose();
            }}
            className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-1.5 text-left text-xs font-bold disabled:opacity-40 ${it.danger ? "text-red-500 data-[focus]:bg-red-50 hover:bg-red-50" : "text-slate-600 hover:bg-primary/10 hover:text-primary-dark"}`}
          >
            {it.label}
            {it.shortcut && <span className="text-[10px] font-normal text-slate-400">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
