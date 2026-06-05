import { useRef, useState, type ReactNode } from "react";
import type { Element, ElementStyle } from "../types.ts";
import { Icon, Tooltip } from "./kit/index.ts";

// Background swatches (hex only — transparent/non-hex would fail the element schema). Top row are
// the bright Milanote-style fills; bottom row are muted darks.
const FILLS = ["#ffffff", "#cbd5e1", "#7fd8c8", "#86c08a", "#c0867e", "#f0c45a", "#e8924a", "#e25c5c", "#e86fb0", "#a86fe2", "#5aa8f0", "#3b6fe8", "#b08968", "#6b7280", "#3d5360", "#5c4a42"];
const TEXTS = ["#1f2937", "#6e24ff", "#dc2626", "#2563eb", "#16a34a", "#8a6d52", "#7b93b5", "#94a3b8"];

// Contextual note formatting rail (Milanote pattern). The Color tool opens a popover panel.
export function NoteSubRail({
  el,
  onDone,
  onPatchStyle,
  onDelete,
}: {
  el: Element;
  onDone: () => void;
  onPatchStyle: (s: Partial<ElementStyle>) => void;
  onDelete: () => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const s = el.style ?? {};

  const cycleAlign = () => onPatchStyle({ align: !s.align || s.align === "left" ? "center" : s.align === "center" ? "right" : "left" });

  return (
    <nav className="relative flex w-20 shrink-0 flex-col items-center gap-1 border-r-2 border-slate-100 bg-white py-3">
      <RailButton label="Done" icon={<Icon.ArrowLeftIcon />} onClick={onDone} />
      <RailButton label="Bold" shortcut="⌘B" active={s.fontWeight === "bold"} icon={<span className="font-black">B</span>} onClick={() => onPatchStyle({ fontWeight: s.fontWeight === "bold" ? "normal" : "bold" })} />
      <RailButton label="Smaller" icon={<span className="text-xs font-bold">A−</span>} onClick={() => onPatchStyle({ fontSize: Math.max(8, (s.fontSize ?? 14) - 2) })} />
      <RailButton label="Bigger" icon={<span className="text-base font-bold">A+</span>} onClick={() => onPatchStyle({ fontSize: Math.min(96, (s.fontSize ?? 14) + 2) })} />
      <RailButton label="Align" icon={<Icon.AlignIcon />} onClick={cycleAlign} />
      <div ref={colorRef} className="w-full">
        <RailButton
          label="Color"
          active={colorOpen}
          icon={<span className="h-4 w-4 rounded border border-slate-300" style={{ background: s.fill ?? "#ffffff" }} />}
          onClick={() => setColorOpen((o) => !o)}
        />
      </div>

      <span className="flex-1" />
      <RailButton label="Delete" icon={<Icon.TrashIcon />} onClick={onDelete} />

      {colorOpen && (
        <ColorPopover
          top={colorRef.current?.offsetTop ?? 0}
          fill={s.fill}
          color={s.color}
          onFill={(c) => onPatchStyle({ fill: c })}
          onColor={(c) => onPatchStyle({ color: c })}
        />
      )}
    </nav>
  );
}

const RailButton = ({ label, shortcut, icon, active, onClick }: { label: string; shortcut?: string; icon: ReactNode; active?: boolean; onClick: () => void }) => (
  <Tooltip label={label} shortcut={shortcut}>
    <button onClick={onClick} className="group flex w-full flex-col items-center gap-1 py-1.5">
      <span className={`grid h-9 w-9 place-items-center rounded-xl text-lg transition-colors ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700"}`}>{icon}</span>
      <span className="text-[10px] font-bold text-slate-400">{label}</span>
    </button>
  </Tooltip>
);

function ColorPopover({ top, fill, color, onFill, onColor }: { top: number; fill?: string; color?: string; onFill: (c: string) => void; onColor: (c: string) => void }) {
  const [tab, setTab] = useState<"bg" | "text">("bg");
  return (
    <div className="absolute left-full z-50 ml-2 w-64 rounded-2xl border-2 border-slate-100 bg-white p-4 shadow-xl" style={{ top }}>
      <div className="mb-3 flex gap-2">
        <TabBtn active={tab === "bg"} onClick={() => setTab("bg")}>Background</TabBtn>
        <TabBtn active={tab === "text"} onClick={() => setTab("text")}>Text</TabBtn>
      </div>
      {tab === "bg" ? (
        <Grid colors={FILLS} selected={fill ?? "#ffffff"} onPick={onFill} />
      ) : (
        <Grid colors={TEXTS} selected={color ?? "#1f2937"} onPick={onColor} letter />
      )}
      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border-2 border-slate-100 px-3 py-2 text-xs font-bold text-slate-500">
        <span className="h-5 w-5 rounded-full" style={{ background: "conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)" }} />
        Custom color…
        <input type="color" className="sr-only" onChange={(e) => (tab === "bg" ? onFill(e.target.value) : onColor(e.target.value))} />
      </label>
    </div>
  );
}

const TabBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className={`flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-xs font-bold ${active ? "bg-slate-100 text-slate-700" : "text-slate-400 hover:text-slate-600"}`}>
    {children}
  </button>
);

function Grid({ colors, selected, onPick, letter }: { colors: string[]; selected: string; onPick: (c: string) => void; letter?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className={`grid h-9 w-9 place-items-center rounded-lg border ${selected.toLowerCase() === c.toLowerCase() ? "ring-2 ring-primary ring-offset-1" : "border-slate-200"}`}
          style={{ background: letter ? "#f1f5f9" : c }}
        >
          {letter && <span className="font-black" style={{ color: c }}>A</span>}
        </button>
      ))}
    </div>
  );
}
