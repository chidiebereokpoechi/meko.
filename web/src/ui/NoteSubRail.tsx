import { useEffect, useRef, useState, type ReactNode } from "react";
import { HexColorPicker } from "react-colorful";
import type { Element } from "../types.ts";
import { ColorPicker, Icon, Tooltip } from "./kit/index.ts";
import { PALETTE } from "./kit/ColorPicker.tsx";

// Block (paragraph) styles applied via execCommand formatBlock.
const BLOCKS: {
  label: string;
  tag: string;
  shortcut?: string;
  className: string;
}[] = [
  {
    label: "Large heading",
    tag: "H1",
    shortcut: "⌘⇧1",
    className: "text-xl font-bold",
  },
  {
    label: "Normal heading",
    tag: "H2",
    shortcut: "⌘⇧2",
    className: "text-base font-bold",
  },
  { label: "Normal text", tag: "P", className: "text-xs" },
  {
    label: "Code block",
    tag: "PRE",
    shortcut: "⌘>",
    className: "font-mono text-xs",
  },
  {
    label: "Quote block",
    tag: "BLOCKQUOTE",
    shortcut: '⌘"',
    className: "text-xs italic",
  },
];

// Contextual note rail (Milanote). Selecting a note shows Color (background) only; while the caret
// is active it shows Text style + inline formatting — the same single rail, no second toolbar.
export function NoteSubRail({
  el,
  editing,
  deleteRef,
  deleteActive,
  onDone,
  onBack,
  onExec,
  onFill,
  onStrip,
  onDelete,
}: {
  el: Element;
  editing: boolean;
  deleteRef?: React.Ref<HTMLDivElement>;
  deleteActive?: boolean;
  onDone: () => void;
  // Editing → "Back" returns to the element's selection rail; selection → "Done" exits to the
  // main tool rail.
  onBack: () => void;
  onExec: (command: string, value?: string) => void;
  onFill: (hex: string) => void;
  onStrip: (hex: string | null) => void;
  onDelete: () => void;
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [, setSel] = useState(0);

  // Close an open pane when clicking outside it, the rail, and the actioned note.
  useEffect(() => {
    if (!colorOpen && !styleOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-note-pane]") || t.closest("[data-note-rail]") || t.closest("[data-selected-element]")) return;
      setColorOpen(false);
      setStyleOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [colorOpen, styleOpen]);

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
    <nav data-note-rail className="relative flex w-20 shrink-0 flex-col items-center gap-1 border-r-2 border-slate-100 bg-white py-3">
      <RailBtn label={editing ? "Back" : "Done"} icon={<Icon.ArrowLeftIcon />} onClick={editing ? onBack : onDone} />

      {editing ? (
        <>
          <div ref={styleRef} className="flex w-full justify-center">
            <RailBtn
              label="Text style"
              active={styleOpen}
              icon={
                <span className="font-serif text-base font-bold leading-none">
                  T<span className="text-[0.7em]">t</span>
                </span>
              }
              onClick={() => setStyleOpen((o) => !o)}
            />
          </div>
          <RailBtn
            hideCaption
            label="Bold"
            shortcut="⌘B"
            active={on("bold")}
            icon={<span className="font-black">B</span>}
            onClick={() => onExec("bold")}
          />
          <RailBtn
            hideCaption
            label="Italic"
            shortcut="⌘I"
            active={on("italic")}
            icon={<span className="font-serif italic">I</span>}
            onClick={() => onExec("italic")}
          />
          <RailBtn
            hideCaption
            label="Strikethrough"
            active={on("strikeThrough")}
            icon={<span className="font-bold line-through">S</span>}
            onClick={() => onExec("strikeThrough")}
          />
          <RailBtn
            hideCaption
            label="Underline"
            shortcut="⌘U"
            active={on("underline")}
            icon={<span className="font-bold underline">U</span>}
            onClick={() => onExec("underline")}
          />
          <RailBtn
            hideCaption
            label="Bulleted list"
            active={on("insertUnorderedList")}
            icon={<Icon.BulletListIcon />}
            onClick={() => onExec("insertUnorderedList")}
          />
          <RailBtn
            hideCaption
            label="Numbered list"
            active={on("insertOrderedList")}
            icon={<Icon.NumberListIcon />}
            onClick={() => onExec("insertOrderedList")}
          />
          <RailBtn
            hideCaption
            label="Align"
            icon={<Icon.AlignIcon />}
            onClick={() =>
              onExec(
                on("justifyCenter")
                  ? "justifyRight"
                  : on("justifyRight")
                    ? "justifyLeft"
                    : "justifyCenter",
              )
            }
          />
        </>
      ) : (
        <div ref={colorRef} className="flex w-full justify-center">
          <RailBtn
            label="Color"
            active={colorOpen}
            icon={
              <span className="flex h-5 w-5 flex-col overflow-hidden rounded-md ring-2 ring-inset ring-slate-300">
                {el.style?.strip && <span className="h-1.5 shrink-0" style={{ background: el.style.strip }} />}
                <span className="flex-1" style={{ background: el.style?.fill ?? "#ffffff" }} />
              </span>
            }
            onClick={() => setColorOpen((o) => !o)}
          />
        </div>
      )}

      <span className="flex-1" />
      <div ref={deleteRef} className="flex w-full justify-center">
        <RailBtn label="Delete" icon={<Icon.TrashIcon />} dangerActive={deleteActive} onClick={onDelete} />
      </div>

      {colorOpen && !editing && (
        <Popover top={colorRef.current?.offsetTop ?? 0}>
          <ColorTabs fill={el.style?.fill} strip={el.style?.strip} onFill={onFill} onStrip={onStrip} />
        </Popover>
      )}

      {styleOpen && editing && (
        <Popover top={styleRef.current?.offsetTop ?? 0}>
          <StyleBlocks onExec={onExec} />
          <div className="my-4 border-t-2 border-slate-100" />
          <Section label="Color">
            <ATextColors current={cmdColor("foreColor")} onPick={(c) => onExec("foreColor", c)} />
          </Section>
          <div className="my-4 border-t-2 border-slate-100" />
          <Section label="Highlight">
            <ColorPicker value={cmdColor("backColor") ?? cmdColor("hiliteColor")} onChange={(c) => onExec("backColor", c)} />
          </Section>
        </Popover>
      )}
    </nav>
  );
}

// `label` is always used for the hover tooltip; the visible caption under the icon is optional
// (omitted for standard inline text tools like Bold/Italic, shown for Done/Text style/Color/Delete).
export const RailBtn = ({
  label,
  shortcut,
  icon,
  active,
  dangerActive,
  hideCaption,
  onClick,
}: {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  active?: boolean;
  dangerActive?: boolean;
  hideCaption?: boolean;
  onClick: () => void;
}) => (
  <Tooltip label={label} shortcut={shortcut}>
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="group flex w-full flex-col items-center gap-1 py-1.5"
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg transition-all ${dangerActive ? "scale-110 bg-red-500 text-white" : active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700"}`}
      >
        {icon}
      </span>
      {!hideCaption && (
        <span className="text-[10px] font-bold text-slate-400">{label}</span>
      )}
    </button>
  </Tooltip>
);

// Popover panel anchored beside the rail (slate-50, 2px border). Closes via the tool toggle or
// deselecting the note — no explicit close button.
export function Popover({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div
      data-note-pane
      className="absolute left-full z-50 ml-2 max-h-[80vh] w-72 overflow-auto rounded-lg border-2 border-slate-200 bg-slate-50 p-5 shadow-lg"
      style={{ top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

// Text colour swatches shown as a coloured letter "A" (Milanote text-style pattern).
const TEXT_COLORS = [
  "#1f2937",
  "#475569",
  "#94a3b8",
  "#dc2626",
  "#e8924a",
  "#16a34a",
  "#2563eb",
  "#6e24ff",
  "#d7658b",
];
function ATextColors({ current, onPick }: { current?: string; onPick: (c: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {TEXT_COLORS.map((c) => {
        const active = current?.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            onClick={() => onPick(c)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 bg-white ${active ? "border-primary ring-2 ring-primary/30" : "border-slate-200 hover:border-primary/40"}`}
          >
            <span className="font-black" style={{ color: c }}>
              A
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Read the selection's current colour for a command (e.g. foreColor) and normalise it to hex so
// it can be matched against the swatches; "" / transparent → undefined.
function cmdColor(cmd: string): string | undefined {
  try {
    return toHex(String(document.queryCommandValue(cmd)));
  } catch {
    return undefined;
  }
}
function toHex(v: string): string | undefined {
  const s = v.trim();
  if (s.startsWith("#")) return s.toLowerCase();
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return undefined;
  const h = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`;
}

const Section = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-3">
    <div className="text-xs font-bold text-slate-400">{label}</div>
    {children}
  </div>
);

function StyleBlocks({
  onExec,
}: {
  onExec: (command: string, value?: string) => void;
}) {
  let current = "";
  try {
    current = document
      .queryCommandValue("formatBlock")
      .toString()
      .toLowerCase();
  } catch {
    /* unsupported */
  }
  const isActive = (tag: string) => {
    const t = tag.toLowerCase();
    return (
      t === current || (t === "p" && (current === "" || current === "div"))
    );
  };
  return (
    <div className="flex flex-col">
      {BLOCKS.map((b) => {
        const active = isActive(b.tag);
        return (
          <button
            key={b.tag}
            onClick={() => onExec("formatBlock", b.tag)}
            className={`flex items-center justify-between rounded-lg px-3 py-2 ${active ? "bg-slate-200/60" : "hover:bg-slate-100"}`}
          >
            <span className={`text-slate-700 ${b.className}`}>{b.label}</span>
            {active ? (
              <span className="font-bold text-slate-700">✓</span>
            ) : b.shortcut ? (
              <span className="text-xs text-slate-300">{b.shortcut}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

const TabBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className={`flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-xs font-bold ${active ? "bg-slate-100 text-slate-700" : "text-slate-400 hover:text-slate-600"}`}>
    {children}
  </button>
);

// Background / Top-strip tabbed picker (note selected, not editing).
export function ColorTabs({ fill, strip, onFill, onStrip }: { fill?: string; strip?: string; onFill: (c: string) => void; onStrip: (c: string | null) => void }) {
  const [tab, setTab] = useState<"bg" | "strip">("bg");
  return (
    <>
      <div className="mb-3 flex gap-2">
        <TabBtn active={tab === "bg"} onClick={() => setTab("bg")}>Background</TabBtn>
        <TabBtn active={tab === "strip"} onClick={() => setTab("strip")}>Top strip</TabBtn>
      </div>
      {tab === "bg" ? <ColorPicker value={fill} onChange={onFill} /> : <StripPicker value={strip} onChange={onStrip} />}
    </>
  );
}

// Top-strip swatches: a "none" card (diagonal slash) + the note palette as little cards with a
// coloured strip, plus a custom-colour toggle. Mirrors the Milanote top-strip picker.
export function StripPicker({ value, onChange }: { value?: string; onChange: (c: string | null) => void }) {
  const [custom, setCustom] = useState(false);
  if (custom) {
    return (
      <div className="flex w-full flex-col items-center gap-4">
        <HexColorPicker color={value ?? "#6E24FF"} onChange={(v) => onChange(v.toUpperCase())} style={{ width: "100%" }} />
        <button onClick={() => setCustom(false)} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary-dark">
          Choose from presets
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-2">
        <StripCard color={null} selected={!value} onClick={() => onChange(null)} />
        {PALETTE.map((c) => (
          <StripCard key={c} color={c} selected={value?.toLowerCase() === c.toLowerCase()} onClick={() => onChange(c)} />
        ))}
      </div>
      <button onClick={() => setCustom(true)} className="flex w-full items-center gap-2 rounded-lg border-2 border-slate-100 px-3 py-2 text-xs font-bold text-slate-500">
        <span className="h-5 w-5 rounded-full" style={{ background: "conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)" }} />
        Use custom color
      </button>
    </div>
  );
}

function StripCard({ color, selected, onClick }: { color: string | null; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`overflow-hidden rounded-md border-2 bg-white ${selected ? "border-primary ring-2 ring-primary/30" : "border-slate-200"}`}>
      <div className="h-2.5" style={{ background: color ?? "linear-gradient(to top right, transparent 46%, #ef4444 46%, #ef4444 54%, transparent 54%)" }} />
      <div className="h-5" />
    </button>
  );
}
