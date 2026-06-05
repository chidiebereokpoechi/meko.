import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Element } from "../types.ts";
import { ColorPicker, Icon, Tooltip } from "./kit/index.ts";

// Block (paragraph) styles applied via execCommand formatBlock.
const BLOCKS: { label: string; tag: string; shortcut?: string; className: string }[] = [
  { label: "Large heading", tag: "H1", shortcut: "⌘⇧1", className: "text-xl font-bold" },
  { label: "Normal heading", tag: "H2", shortcut: "⌘⇧2", className: "text-base font-bold" },
  { label: "Normal text", tag: "P", className: "text-xs" },
  { label: "Code block", tag: "PRE", shortcut: "⌘>", className: "font-mono text-xs" },
  { label: "Quote block", tag: "BLOCKQUOTE", shortcut: '⌘"', className: "text-xs italic" },
];

// Contextual note rail (Milanote). Selecting a note shows Color (background) only; while the caret
// is active it shows Text style + inline formatting — the same single rail, no second toolbar.
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
  const [styleOpen, setStyleOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [, setSel] = useState(0);

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

      {editing ? (
        <>
          <div ref={styleRef} className="flex w-full justify-center">
            <RailBtn label="Text style" active={styleOpen} icon={<span className="font-serif text-base font-bold leading-none">T<span className="text-[0.7em]">t</span></span>} onClick={() => setStyleOpen((o) => !o)} />
          </div>
          <RailBtn label="Bold" shortcut="⌘B" active={on("bold")} icon={<span className="font-black">B</span>} onClick={() => onExec("bold")} />
          <RailBtn label="Italic" shortcut="⌘I" active={on("italic")} icon={<span className="font-serif italic">I</span>} onClick={() => onExec("italic")} />
          <RailBtn label="Strikethrough" active={on("strikeThrough")} icon={<span className="font-bold line-through">S</span>} onClick={() => onExec("strikeThrough")} />
          <RailBtn label="Underline" shortcut="⌘U" active={on("underline")} icon={<span className="font-bold underline">U</span>} onClick={() => onExec("underline")} />
          <RailBtn label="Bulleted list" active={on("insertUnorderedList")} icon={<Icon.BulletListIcon />} onClick={() => onExec("insertUnorderedList")} />
          <RailBtn label="Numbered list" active={on("insertOrderedList")} icon={<Icon.NumberListIcon />} onClick={() => onExec("insertOrderedList")} />
          <RailBtn label="Align" icon={<Icon.AlignIcon />} onClick={() => onExec(on("justifyCenter") ? "justifyRight" : on("justifyRight") ? "justifyLeft" : "justifyCenter")} />
        </>
      ) : (
        <div ref={colorRef} className="flex w-full justify-center">
          <RailBtn label="Color" active={colorOpen} icon={<span className="block h-5 w-5 rounded-md ring-1 ring-inset ring-slate-300" style={{ background: el.style?.fill ?? "#ffffff" }} />} onClick={() => setColorOpen((o) => !o)} />
        </div>
      )}

      <span className="flex-1" />
      <RailBtn label="Delete" icon={<Icon.TrashIcon />} onClick={onDelete} />

      {colorOpen && !editing && (
        <Popover top={colorRef.current?.offsetTop ?? 0}>
          <Section label="Background">
            <ColorPicker value={el.style?.fill} onChange={onFill} />
          </Section>
        </Popover>
      )}

      {styleOpen && editing && (
        <Popover top={styleRef.current?.offsetTop ?? 0}>
          <StyleBlocks onExec={onExec} />
          <div className="my-4 border-t-2 border-slate-100" />
          <Section label="Color">
            <ATextColors onPick={(c) => onExec("foreColor", c)} />
          </Section>
          <div className="my-4 border-t-2 border-slate-100" />
          <Section label="Highlight">
            <ColorPicker onChange={(c) => onExec("hiliteColor", c)} />
          </Section>
        </Popover>
      )}
    </nav>
  );
}

const RailBtn = ({ label, shortcut, icon, active, onClick }: { label: string; shortcut?: string; icon: ReactNode; active?: boolean; onClick: () => void }) => (
  <Tooltip label={label} shortcut={shortcut}>
    <button onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="group flex w-full flex-col items-center gap-1 py-1.5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition-colors ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700"}`}>{icon}</span>
      <span className="text-[10px] font-bold text-slate-400">{label}</span>
    </button>
  </Tooltip>
);

// Popover panel anchored beside the rail (slate-50, 2px border). Closes via the tool toggle or
// deselecting the note — no explicit close button.
function Popover({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div className="absolute left-full z-50 ml-2 max-h-[80vh] w-72 overflow-auto rounded-lg border-2 border-slate-200 bg-slate-50 p-5 shadow-lg" style={{ top }} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

// Text colour swatches shown as a coloured letter "A" (Milanote text-style pattern).
const TEXT_COLORS = ["#1f2937", "#475569", "#94a3b8", "#dc2626", "#e8924a", "#16a34a", "#2563eb", "#6e24ff", "#d7658b"];
function ATextColors({ onPick }: { onPick: (c: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {TEXT_COLORS.map((c) => (
        <button key={c} onClick={() => onPick(c)} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-200 bg-white hover:border-primary/40">
          <span className="font-black" style={{ color: c }}>A</span>
        </button>
      ))}
    </div>
  );
}

const Section = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-3">
    <div className="text-xs font-bold text-slate-400">{label}</div>
    {children}
  </div>
);

function StyleBlocks({ onExec }: { onExec: (command: string, value?: string) => void }) {
  let current = "";
  try {
    current = document.queryCommandValue("formatBlock").toString().toLowerCase();
  } catch {
    /* unsupported */
  }
  const isActive = (tag: string) => {
    const t = tag.toLowerCase();
    return t === current || (t === "p" && (current === "" || current === "div"));
  };
  return (
    <div className="flex flex-col">
      {BLOCKS.map((b) => {
        const active = isActive(b.tag);
        return (
          <button key={b.tag} onClick={() => onExec("formatBlock", b.tag)} className={`flex items-center justify-between rounded-lg px-3 py-2 ${active ? "bg-slate-200/60" : "hover:bg-slate-100"}`}>
            <span className={`text-slate-700 ${b.className}`}>{b.label}</span>
            {active ? <span className="font-bold text-slate-700">✓</span> : b.shortcut ? <span className="text-xs text-slate-300">{b.shortcut}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
