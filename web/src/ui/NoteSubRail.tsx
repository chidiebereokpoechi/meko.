import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Element } from "../types.ts";
import { Icon, Tooltip } from "./kit/index.ts";

const FILLS = ["#ffffff", "#cbd5e1", "#7fd8c8", "#86c08a", "#c0867e", "#f0c45a", "#e8924a", "#e25c5c", "#e86fb0", "#a86fe2", "#5aa8f0", "#3b6fe8", "#b08968", "#6b7280", "#3d5360", "#5c4a42"];
const TEXTS = ["#1f2937", "#6e24ff", "#dc2626", "#2563eb", "#16a34a", "#8a6d52", "#7b93b5", "#94a3b8"];

// Contextual note rail (Milanote). Formatting commands act on the live text selection in the
// focused note; this is the same rail whether the note is just selected or the cursor is active —
// no second toolbar. `exec` runs an execCommand on the active editor.
export function NoteSubRail({
  el,
  editing,
  onDone,
  onExec,
  onFill,
  onDelete,
}: {
  el: Element;
  editing: boolean;
  onDone: () => void;
  onExec: (command: string, value?: string) => void;
  onFill: (hex: string) => void;
  onDelete: () => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const [, setSel] = useState(0);

  // Refresh active states (bold/italic/…) as the selection changes.
  useEffect(() => {
    const h = () => setSel((n) => n + 1);
    document.addEventListener("selectionchange", h);
    return () => document.removeEventListener("selectionchange", h);
  }, []);
  const on = (cmd: string) => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };

  return (
    <nav className="relative flex w-20 shrink-0 flex-col items-center gap-1 border-r-2 border-slate-100 bg-white py-3">
      <RailBtn label="Done" icon={<Icon.ArrowLeftIcon />} onClick={onDone} />
      <div ref={colorRef} className="w-full">
        <RailBtn label="Color" active={colorOpen} icon={<span className="h-5 w-5 rounded-md ring-1 ring-inset ring-slate-300" style={{ background: el.style?.fill ?? "#ffffff" }} />} onClick={() => setColorOpen((o) => !o)} />
      </div>

      {/* Text formatting only applies while the caret is in the note (edit mode). */}
      {editing && (
        <>
          <RailBtn label="Bold" shortcut="⌘B" active={on("bold")} icon={<span className="font-black">B</span>} onClick={() => onExec("bold")} />
          <RailBtn label="Italic" shortcut="⌘I" active={on("italic")} icon={<span className="font-serif italic">I</span>} onClick={() => onExec("italic")} />
          <RailBtn label="Strikethrough" active={on("strikeThrough")} icon={<span className="font-bold line-through">S</span>} onClick={() => onExec("strikeThrough")} />
          <RailBtn label="Underline" shortcut="⌘U" active={on("underline")} icon={<span className="font-bold underline">U</span>} onClick={() => onExec("underline")} />
          <RailBtn label="Bulleted list" active={on("insertUnorderedList")} icon={<Icon.BulletListIcon />} onClick={() => onExec("insertUnorderedList")} />
          <RailBtn label="Numbered list" active={on("insertOrderedList")} icon={<Icon.NumberListIcon />} onClick={() => onExec("insertOrderedList")} />
          <RailBtn label="Align" icon={<Icon.AlignIcon />} onClick={() => onExec(on("justifyCenter") ? "justifyRight" : on("justifyRight") ? "justifyLeft" : "justifyCenter")} />
        </>
      )}

      <span className="flex-1" />
      <RailBtn label="Delete" icon={<Icon.TrashIcon />} onClick={onDelete} />

      {colorOpen && (
        <ColorPopover top={colorRef.current?.offsetTop ?? 0} fill={el.style?.fill} showText={editing} onFill={onFill} onColor={(c) => onExec("foreColor", c)} />
      )}
    </nav>
  );
}

const RailBtn = ({ label, shortcut, icon, active, onClick }: { label: string; shortcut?: string; icon: ReactNode; active?: boolean; onClick: () => void }) => (
  <Tooltip label={label} shortcut={shortcut}>
    <button
      // Keep focus in the note so execCommand applies to its selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="group flex w-full flex-col items-center gap-1 py-1.5"
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl text-lg transition-colors ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700"}`}>{icon}</span>
      <span className="text-[10px] font-bold text-slate-400">{label}</span>
    </button>
  </Tooltip>
);

function ColorPopover({ top, fill, showText, onFill, onColor }: { top: number; fill?: string; showText: boolean; onFill: (c: string) => void; onColor: (c: string) => void }) {
  const [tab, setTab] = useState<"bg" | "text">("bg");
  const active = showText ? tab : "bg";
  return (
    <div className="absolute left-full z-50 ml-2 w-64 rounded-2xl border-2 border-slate-100 bg-white p-4 shadow-xl" style={{ top }} onMouseDown={(e) => e.preventDefault()}>
      {showText && (
        <div className="mb-3 flex gap-2">
          <TabBtn active={active === "bg"} onClick={() => setTab("bg")}>Background</TabBtn>
          <TabBtn active={active === "text"} onClick={() => setTab("text")}>Text</TabBtn>
        </div>
      )}
      {active === "bg" ? (
        <Grid colors={FILLS} selected={fill ?? "#ffffff"} onPick={onFill} />
      ) : (
        <Grid colors={TEXTS} onPick={onColor} letter />
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

function Grid({ colors, selected, onPick, letter }: { colors: string[]; selected?: string; onPick: (c: string) => void; letter?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {colors.map((c) => (
        <button key={c} onClick={() => onPick(c)} className={`grid h-9 w-9 place-items-center rounded-lg border ${selected?.toLowerCase() === c.toLowerCase() ? "ring-2 ring-primary ring-offset-1" : "border-slate-200"}`} style={{ background: letter ? "#f1f5f9" : c }}>
          {letter && <span className="font-black" style={{ color: c }}>A</span>}
        </button>
      ))}
    </div>
  );
}
