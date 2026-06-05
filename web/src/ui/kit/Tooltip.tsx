import { useState, type ReactNode } from "react";

// Dark Milanote-style tooltip on hover, with an optional keyboard-shortcut hint. CSS-only
// positioning (to the right of the trigger) — no popper dependency.
export function Tooltip({ label, shortcut, side = "right", children }: { label: string; shortcut?: string; side?: "right" | "top"; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const pos = side === "right" ? "left-full top-1/2 ml-2 -translate-y-1/2" : "bottom-full left-1/2 mb-2 -translate-x-1/2";
  return (
    <span className="relative inline-flex" onPointerEnter={() => setShow(true)} onPointerLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className={`pointer-events-none absolute z-50 flex items-center gap-2 whitespace-nowrap rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white shadow-lg ${pos}`}>
          {label}
          {shortcut && <span className="text-slate-400">{shortcut}</span>}
        </span>
      )}
    </span>
  );
}
