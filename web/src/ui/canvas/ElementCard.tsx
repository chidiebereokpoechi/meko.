import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Element, TodoItem } from "../../types.ts";
import { embedAspect, embedHeightFor, faviconUrl } from "../../lib/embed.ts";
import { sanitizeHtml } from "../../lib/sanitize.ts";
import { Icon } from "../kit/index.ts";
import { EditableNote, type ActiveEditor } from "../EditableNote.tsx";
import { linkHost } from "./url.ts";

// Editable caption beneath an image (uncontrolled contentEditable; sanitised HTML persisted to
// Yjs). stopPropagation so editing doesn't drag the card; "Add a caption" placeholder when empty.
// On focus it registers as the active editor + signals caption-editing so the rail shows the
// note-style text-formatting tools.
function CaptionField({
  html,
  selected,
  readOnly,
  onText,
  onRegister,
  onFocusCaption,
}: {
  html: string;
  selected: boolean;
  readOnly?: boolean;
  onText: (html: string) => void;
  onRegister: (e: ActiveEditor) => void;
  onFocusCaption: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Editable while the card is selected on a writable board — but NOT auto-focused: the user must
  // click the caption to edit it. That keeps a plain select-then-Delete from typing into the
  // caption instead of removing the image.
  const active = selected && !readOnly;
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d || document.activeElement === d) return;
    const clean = sanitizeHtml(html);
    if (d.innerHTML !== clean) d.innerHTML = clean;
  });
  return (
    <div
      ref={ref}
      contentEditable={active}
      suppressContentEditableWarning
      data-empty-placeholder={readOnly ? "" : "Add a caption"}
      className="note-editable border-t-2 border-line-strong p-2 text-xs text-slate-700 outline-none"
      // While editing keep the caret from dragging the card; otherwise let the pointer bubble so the
      // first click selects and the second enters edit mode.
      onPointerDown={
        active ? (e: React.PointerEvent) => e.stopPropagation() : undefined
      }
      onClick={(e) => {
        // A click on a link inside the caption opens it instead of selecting/editing the card.
        const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href");
        if (href) {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, "_blank", "noopener,noreferrer");
        }
      }}
      onFocus={() => {
        onRegister({
          el: ref.current!,
          commit: () => onText(sanitizeHtml(ref.current!.innerHTML)),
        });
        onFocusCaption();
      }}
      onInput={() => onText(sanitizeHtml(ref.current!.innerHTML))}
    />
  );
}

// Checklist body: optional title + checkable, editable items. Enter adds an item below; Backspace
// on an empty item removes it. Every change patches the whole items array into the Yjs element.
type Todo = Extract<Element, { type: "todo" }>;
function TodoBody({
  el,
  editing,
  readOnly,
  onChange,
}: {
  el: Todo;
  editing: boolean;
  readOnly?: boolean;
  onChange: (patch: { title?: string; items?: TodoItem[] }) => void;
}) {
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<string | null>(null);
  // Interactive only on a writable board AND once the card is in edit mode (the second click).
  const active = editing && !readOnly;

  useEffect(() => {
    if (focusId && inputs.current[focusId]) {
      inputs.current[focusId]!.focus();
      setFocusId(null);
    }
  }, [focusId, el.items]);

  // Entering edit mode (the second click) focuses the title, mirroring how a note focuses on its
  // second click. Until then the body is non-interactive so the first click only selects the card.
  useEffect(() => {
    if (active && document.activeElement !== titleRef.current)
      titleRef.current?.focus();
  }, [active]);

  const setItems = (items: TodoItem[]) => onChange({ items });
  const toggle = (id: string) =>
    setItems(
      el.items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)),
    );
  const setText = (id: string, text: string) =>
    setItems(el.items.map((it) => (it.id === id ? { ...it, text } : it)));
  const addAfter = (idx: number) => {
    const nid = crypto.randomUUID();
    const items = [...el.items];
    items.splice(idx + 1, 0, { id: nid, text: "", done: false });
    setItems(items);
    setFocusId(nid);
  };
  const removeAt = (idx: number) => {
    if (el.items.length <= 1) return;
    const prev = el.items[idx - 1]?.id ?? el.items[idx + 1]?.id ?? null;
    setItems(el.items.filter((_, i) => i !== idx));
    if (prev) setFocusId(prev);
  };
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  // Drag an item by its grip to reorder within the to-do — live, as the cursor moves.
  const listRef = useRef<HTMLDivElement>(null);
  const itemsLatest = useRef(el.items);
  itemsLatest.current = el.items;
  const startItemDrag = (id: string, e: React.PointerEvent) => {
    if (!active) return;
    e.stopPropagation();
    setDragItem(id);
    const move = (ev: PointerEvent) => {
      const rows = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>("[data-todo-item]") ??
          [],
      );
      let target = rows.length - 1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          target = i;
          break;
        }
      }
      const items = itemsLatest.current;
      const from = items.findIndex((it) => it.id === id);
      if (from < 0 || from === target) return;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved!);
      setItems(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragItem(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    // While not editing the body is non-interactive (pointer-events-none) so a click falls through
    // to the card: the first click selects, the second enters edit mode (then this turns back on).
    <div
      className={`flex w-full flex-col gap-2 p-2 ${active ? "" : "pointer-events-none"}`}
    >
      <input
        ref={titleRef}
        value={el.title ?? ""}
        onChange={(e) => onChange({ title: e.target.value })}
        onPointerDown={stop}
        readOnly={!active}
        placeholder={readOnly ? "" : "To-do"}
        className="bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400"
      />
      <div ref={listRef} className="grid gap-1.5">
        {el.items.map((it, idx) => (
          <div
            key={it.id}
            data-todo-item={it.id}
            className={`group/item flex items-center gap-2 ${dragItem === it.id ? "opacity-50" : ""}`}
          >
            <button
              onPointerDown={stop}
              onClick={() => active && toggle(it.id)}
              disabled={!active}
              aria-label={it.done ? "Mark not done" : "Mark done"}
              className={`grid h-4 w-4 shrink-0 place-items-center rounded border-2 ${it.done ? "border-primary bg-primary text-white" : "border-line-strong"}`}
            >
              {it.done && <Icon.CheckIcon className="text-[10px]" />}
            </button>
            <input
              ref={(node) => (inputs.current[it.id] = node)}
              value={it.text}
              onChange={(e) => setText(it.id, e.target.value)}
              onPointerDown={stop}
              readOnly={!active}
              onKeyDown={(e) => {
                if (!active) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  addAfter(idx);
                } else if (e.key === "Backspace" && it.text === "") {
                  e.preventDefault();
                  removeAt(idx);
                }
              }}
              placeholder={readOnly ? "" : "Item"}
              className={`flex-1 bg-transparent text-xs outline-none placeholder:text-slate-300 ${it.done ? "text-slate-400 line-through" : "text-slate-700"}`}
            />
            {active && (
              <button
                onPointerDown={(e) => startItemDrag(it.id, e)}
                aria-label="Reorder"
                title="Drag to reorder"
                className="shrink-0 cursor-grab text-slate-300 opacity-0 hover:text-slate-500 group-hover/item:opacity-100 active:cursor-grabbing"
              >
                <Icon.GripIcon className="text-sm" />
              </button>
            )}
          </div>
        ))}
      </div>
      {active && (
        <button
          onPointerDown={stop}
          onClick={() => addAfter(el.items.length - 1)}
          className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-primary"
        >
          <Icon.PlusIcon className="text-xs" /> Add item
        </button>
      )}
    </div>
  );
}

export function ElementCard({
  el,
  selected,
  editing,
  imgUrl,
  onSelect,
  onToggleSelect,
  onContextMenu,
  onEdit,
  onMove,
  onResize,
  onText,
  onRegister,
  onOpen,
  onCaption,
  onCaptionFocus,
  onTodo,
  onStartLink,
  onSize,
  freshlyCreated,
  onConsumeFresh,
  embedded,
  onEmbeddedDragStart,
  onColumnTitle,
  onToggleCollapse,
  colDropIndex,
  renderColumnChild,
  readOnly,
  shrink,
  dragging,
  anyDragging,
  zoom,
  toWorld,
  onDragMove,
  onDragRelease,
  onDragCancel,
}: {
  el: Element;
  selected: boolean;
  editing: boolean;
  imgUrl?: string;
  onSelect: () => void;
  onToggleSelect?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onText: (t: string) => void;
  onRegister: (e: ActiveEditor | null) => void;
  onOpen?: () => void;
  onCaption?: (html: string) => void;
  onCaptionFocus?: () => void;
  onTodo?: (patch: { title?: string; items?: TodoItem[] }) => void;
  onStartLink?: (e: React.PointerEvent) => void;
  onSize?: (id: string, h: number) => void;
  freshlyCreated?: boolean;
  onConsumeFresh?: () => void;
  embedded?: boolean;
  onEmbeddedDragStart?: (e: React.PointerEvent) => void;
  onColumnTitle?: (t: string) => void;
  onToggleCollapse?: () => void;
  colDropIndex?: number;
  renderColumnChild?: (childId: string) => React.ReactNode;
  readOnly?: boolean;
  shrink: boolean;
  dragging: boolean;
  anyDragging?: boolean;
  zoom: number;
  toWorld: (cx: number, cy: number) => { x: number; y: number };
  onDragMove: (x: number, y: number) => void;
  onDragRelease: (x: number, y: number) => void;
  onDragCancel?: () => void;
}) {
  // Grab offset in WORLD coords so dragging works under any pan/zoom.
  const grab = useRef<{ x: number; y: number } | null>(null);
  // Where the card sat when a free drag began + the Escape handler that reverts to it.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const escDrag = useRef<(() => void) | null>(null);
  const size = useRef<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const justSelected = useRef(false);
  const dragged = useRef(false);
  const isText = el.type === "note" || el.type === "text";
  // Element types with an inline editable text zone — these enter edit mode on the second click
  // (first click just selects), same as a note. Images are NOT here: clicking an image only selects
  // it (so Delete removes it); its caption is edited by clicking the caption directly.
  const editsText = isText || el.type === "todo" || el.type === "column";
  const hasEmbed =
    el.type === "embed" || (el.type === "link" && !!el.embedSrc);
  // Click to select, click again to "activate" (editing) — both text editing and making an embed
  // interactive go through editingId.
  const activatable = editsText || hasEmbed;
  // A live (interactive) embed: only once explicitly activated (editingId), never merely selected.
  // Reason: a live cross-origin iframe (e.g. Spotify) grabs keyboard focus, which would swallow
  // Backspace/Delete and Escape. Keeping a selected-but-not-activated embed inert keeps it deletable.
  // Also off during any drag, so the iframe can't swallow the pointerup and strand the drag.
  const embedLive = editing && !readOnly && !anyDragging;

  // Report rendered height so connection endpoints anchor to the real card edge (auto-height cards).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!node || !onSize) return;
    const report = () => onSize(el.id, node.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el.id, onSize]);

  // Track whether the note's text overflows its (fixed-height) card, to show the bottom fade.
  const noteWrapRef = useRef<HTMLDivElement>(null);
  const [noteOverflowing, setNoteOverflowing] = useState(false);
  const noteText = el.type === "note" || el.type === "text" ? el.text : "";
  useEffect(() => {
    const ed = noteWrapRef.current?.firstElementChild as HTMLElement | null;
    if (!ed) return;
    const check = () =>
      setNoteOverflowing(ed.scrollHeight - ed.clientHeight > 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(ed);
    return () => ro.disconnect();
  }, [noteText, el.h, editing]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Pressing a card pulls keyboard focus back out of any activated embed iframe — otherwise focus
    // stays trapped in the cross-origin iframe and window key handlers (Backspace/Delete) go dead.
    if (document.activeElement instanceof HTMLIFrameElement)
      document.activeElement.blur();
    e.stopPropagation(); // don't let the canvas deselect / pan
    // Cmd/Ctrl-click toggles multi-selection (no drag, no edit).
    if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
      onToggleSelect();
      return;
    }
    // A freshly-dropped element is already selected; treat the first press as a fresh select so it
    // drags rather than entering edit mode.
    justSelected.current = !selected || !!freshlyCreated;
    dragged.current = false;
    if (!selected) onSelect();
    if (embedded) {
      // Inside a column: dragging reparents/reorders (handled by the parent), not free movement.
      if (!editing && !readOnly) onEmbeddedDragStart?.(e);
      return;
    }
    if (!editing && !readOnly && !el.locked) {
      const w = toWorld(e.clientX, e.clientY);
      grab.current = { x: w.x - el.x, y: w.y - el.y };
      dragStart.current = { x: el.x, y: el.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      // Esc mid-drag: snap the card back to where it started and abandon the drag.
      const onEsc = (ke: KeyboardEvent) => {
        if (ke.key !== "Escape" || !grab.current || !dragStart.current) return;
        ke.preventDefault();
        onMove(dragStart.current.x, dragStart.current.y);
        grab.current = null;
        dragged.current = false;
        escDrag.current?.();
        onDragCancel?.();
      };
      escDrag.current = () => {
        window.removeEventListener("keydown", onEsc, true);
        escDrag.current = null;
      };
      window.addEventListener("keydown", onEsc, true);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!grab.current) return;
    dragged.current = true;
    const w = toWorld(e.clientX, e.clientY);
    onMove(Math.round(w.x - grab.current.x), Math.round(w.y - grab.current.y));
    onDragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    escDrag.current?.();
    if (grab.current && dragged.current) onDragRelease(e.clientX, e.clientY);
    grab.current = null;
    if (freshlyCreated) onConsumeFresh?.(); // subsequent clicks edit normally
  };
  // First click selects; a second click (already selected, no drag) enters edit mode.
  // (⌘/Ctrl-click toggles multi-selection — handled in onPointerDown; Alt-click opens.)
  const onClick = (e: React.MouseEvent) => {
    // A column child must not bubble its click to the parent column card — otherwise the column
    // would treat it as its own second click and drop into title-edit (which also blocks Backspace).
    if (embedded) e.stopPropagation();
    if (e.metaKey || e.ctrlKey) return; // multi-select handled on pointer down
    if (e.altKey && onOpen) {
      onOpen();
      return;
    }
    // Top-level cards enter edit on the second click. Column children do NOT — single click only
    // selects them (so Backspace deletes); they edit/activate on double-click instead (below).
    if (
      activatable &&
      !embedded &&
      !readOnly &&
      !justSelected.current &&
      !editing &&
      !dragged.current
    )
      onEdit();
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (embedded) e.stopPropagation(); // don't double-click the parent column too
    if (dragged.current) return;
    // A column child edits/activates on double-click (text editing, or making an embed interactive).
    if (embedded && activatable && !readOnly) {
      onEdit();
      return;
    }
    // Non-text, non-embed cards (e.g. plain links) open on double-click.
    if (!isText && !hasEmbed) onOpen?.();
  };

  const startResize = (e: React.PointerEvent) => {
    if (readOnly || el.locked) return;
    e.stopPropagation();
    dragged.current = true;
    size.current = { x: e.clientX, y: e.clientY, w: el.w, h: el.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  // Links are content-height (toggling preview/caption resizes the card), so resize is width-only.
  const autoSize =
    embedded ||
    el.type === "link" ||
    el.type === "image" ||
    el.type === "todo" ||
    el.type === "column"; // content-height
  const lockAspect = el.type === "image"; // resize keeps the image's aspect ratio
  const onResizeMove = (e: React.PointerEvent) => {
    if (!size.current) return;
    const w = Math.max(
      80,
      Math.round(size.current.w + (e.clientX - size.current.x) / zoom),
    );
    if (lockAspect) {
      const aspect = size.current.w / size.current.h || 1;
      onResize(w, Math.max(40, Math.round(w / aspect)));
    } else if (autoSize) {
      onResize(w, el.h);
    } else {
      onResize(
        w,
        Math.max(
          60,
          Math.round(size.current.h + (e.clientY - size.current.y) / zoom),
        ),
      );
    }
  };
  const endResize = () => (size.current = null);

  const s = el.style ?? {};
  // lineHeight is unitless so it scales with fontSize (otherwise large text overlaps).
  const textStyle: CSSProperties = {
    color: s.color ?? "#0f172a",
    fontWeight: s.fontWeight ?? "normal",
    fontSize: s.fontSize ?? 14,
    lineHeight: 1.35,
    textAlign: s.align ?? "left",
  };

  return (
    <div
      ref={rootRef}
      data-selected-element={selected ? "true" : undefined}
      data-column-id={el.type === "column" ? el.id : undefined}
      data-col-child={embedded ? el.id : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      // Square corners; colour swaps on select so there's no layout shift. Top-level cards get a 2px
      // border; cards nested inside a column get a lighter 1px border.
      // While dragging: bring to front + go slightly transparent; shrink when over the Delete tool.
      className={`${embedded ? "relative w-full border" : "absolute border-2"} bg-white shadow-sm ${selected ? "border-primary ring-4 ring-primary/20" : "border-line"} ${editing ? "cursor-text" : "cursor-default"} ${dragging ? "opacity-80 shadow-xl" : ""}`}
      style={{
        left: embedded ? undefined : el.x,
        top: embedded ? undefined : el.y,
        width: embedded ? undefined : el.w,
        height: autoSize ? "auto" : el.h,
        background:
          isText || el.type === "todo" ? (s.fill ?? "#ffffff") : "#fff",
        zIndex: dragging ? 1000 : undefined,
        transform: shrink ? "scale(0.4)" : undefined,
        transformOrigin: "center",
        transition: "transform 0.12s ease",
      }}
    >
      {isText ? (
        <div className="relative flex h-full w-full flex-col overflow-hidden">
          {s.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: s.strip }}
            />
          )}
          <div ref={noteWrapRef} className="min-h-0 flex-1">
            <EditableNote
              id={el.id}
              html={el.type === "note" || el.type === "text" ? el.text : ""}
              editing={editing}
              style={textStyle}
              onText={onText}
              onRegister={onRegister}
            />
          </div>
          {/* Fade overflowing text out at the bottom (note's own colour) — only when truncated. */}
          {!editing && noteOverflowing && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
              style={{
                background: `linear-gradient(to bottom, transparent, ${s.fill ?? "#ffffff"})`,
              }}
            />
          )}
        </div>
      ) : el.type === "image" ? (
        <div className="flex w-full flex-col overflow-hidden bg-white">
          {el.style?.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: el.style.strip }}
            />
          )}
          {/* Embedded (in a column): height follows the column width via aspect ratio. Free: fixed h. */}
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={el.alt ?? ""}
              className="w-full object-cover"
              style={
                embedded
                  ? { aspectRatio: `${el.w} / ${el.h}` }
                  : { height: el.h }
              }
              draggable={false}
            />
          ) : (
            <div
              className="grid place-items-center text-slate-400"
              style={
                embedded
                  ? { aspectRatio: `${el.w} / ${el.h}` }
                  : { height: el.h }
              }
            >
              image…
            </div>
          )}
          {el.showCaption && (
            <CaptionField
              html={el.caption ?? ""}
              selected={selected}
              readOnly={readOnly}
              onText={(h) => onCaption?.(h)}
              onRegister={onRegister}
              onFocusCaption={() => onCaptionFocus?.()}
            />
          )}
        </div>
      ) : el.type === "link" ? (
        <div
          className="flex w-full flex-col overflow-hidden"
          style={{ background: el.style?.fill ?? "#ffffff" }}
        >
          {el.style?.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: el.style.strip }}
            />
          )}
          {el.embedSrc ? (
            <div
              className="relative w-full"
              // Scale to the card/column width via aspect-ratio (so a video fills the width); Spotify
              // and other fixed-height players keep a constant height instead.
              style={
                embedAspect(el.embedSrc)
                  ? { aspectRatio: String(embedAspect(el.embedSrc)) }
                  : { height: embedHeightFor(el.embedSrc, el.w) }
              }
              // Interacting with the live embed must not start a card drag: once the pointer enters
              // the cross-origin iframe the card never sees pointerup, so the drag would get stuck.
              onPointerDown={embedLive ? (e) => e.stopPropagation() : undefined}
            >
              <iframe
                src={el.embedSrc}
                title="embed"
                className="h-full w-full"
                style={{
                  border: 0,
                  pointerEvents:
                    embedLive ? "auto" : "none",
                }}
                sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
                allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
              />
              {!(embedLive) && (
                <div className="absolute inset-0" />
              )}
            </div>
          ) : (
            el.image &&
            !el.hideImage && (
              <img
                src={el.image}
                alt=""
                className="w-full object-cover"
                style={{ height: Math.round(el.w * 0.52) }}
                draggable={false}
              />
            )
          )}
          <div className="shrink-0 p-2">
            {/* Heading is a real link; stopPropagation so clicking it opens (not drag/select). */}
            <a
              href={el.url}
              target="_blank"
              rel="noopener noreferrer"
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-block truncate text-xs font-bold text-primary underline"
            >
              {el.title || el.url}
            </a>
            {el.description && !el.hideCaption && (
              <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                {el.description}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
              {faviconUrl(el.url) && (
                <img
                  src={faviconUrl(el.url)!}
                  alt=""
                  width={12}
                  height={12}
                  className="shrink-0 rounded-sm"
                  draggable={false}
                />
              )}
              <span className="truncate">{linkHost(el.url)}</span>
            </div>
          </div>
        </div>
      ) : el.type === "todo" ? (
        <div className="flex w-full flex-col overflow-hidden">
          {s.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: s.strip }}
            />
          )}
          <TodoBody
            el={el}
            editing={editing}
            readOnly={readOnly}
            onChange={(p) => onTodo?.(p)}
          />
        </div>
      ) : el.type === "board" ? (
        <div className="flex h-full w-full flex-col overflow-hidden">
          {s.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: s.strip }}
            />
          )}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-4 text-center">
            <Icon.BoardIcon className="text-3xl text-primary" />
            <span className="line-clamp-2 text-xs font-bold text-slate-700">
              {el.title || "Board"}
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              Double-click to open
            </span>
          </div>
        </div>
      ) : el.type === "embed" ? (
        <div
          className="relative flex h-full w-full flex-col overflow-hidden"
          // Interacting with the live embed must not start a card drag (see link embed above).
          onPointerDown={
            embedLive
              ? (e) => e.stopPropagation()
              : undefined
          }
        >
          {s.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: s.strip }}
            />
          )}
          <iframe
            src={el.src}
            title="embed"
            className="min-h-0 w-full flex-1"
            style={{
              border: 0,
              pointerEvents:
                embedLive ? "auto" : "none",
            }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
          />
          {/* Swallow pointer events unless interactive, so the card can be dragged/selected
              (including right after it's dropped). */}
          {!(embedLive) && (
            <div className="absolute inset-0" />
          )}
        </div>
      ) : el.type === "column" ? (
        <div
          className="flex w-full flex-col overflow-hidden"
          style={{ background: s.fill ?? "#ffffff" }}
        >
          {s.strip && (
            <div
              className="h-2.5 w-full shrink-0"
              style={{ background: s.strip }}
            />
          )}
          {/* Header: collapse toggle, inline title, card count. */}
          <div className="flex items-center gap-1 px-2 pt-2">
            {onToggleCollapse && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onToggleCollapse}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100"
              >
                <Icon.ChevronDown
                  className={`text-base transition-transform ${el.collapsed ? "-rotate-90" : ""}`}
                />
              </button>
            )}
            {/* Two-stage: a plain title until the column is in edit mode (the second click). */}
            {editing && !readOnly ? (
              <input
                autoFocus
                value={el.title ?? ""}
                onChange={(e) => onColumnTitle?.(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Column"
                className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
              />
            ) : (
              <span
                className={`min-w-0 flex-1 truncate text-sm font-bold ${el.title ? "text-slate-700" : "text-slate-400"}`}
              >
                {el.title || "Column"}
              </span>
            )}
          </div>
          <div
            className={`px-2 pl-8 text-[11px] font-bold text-slate-400 ${el.collapsed ? "pb-2" : "pb-1"}`}
          >
            {el.children.length} {el.children.length === 1 ? "card" : "cards"}
          </div>
          {!el.collapsed && (
            <div className="flex flex-col gap-2 p-2 pt-1">
              {el.children.map((cid, i) => (
                <div key={cid}>
                  {colDropIndex === i && (
                    <div className="my-0.5 h-0.5 rounded bg-primary" />
                  )}
                  {renderColumnChild?.(cid)}
                </div>
              ))}
              {colDropIndex === el.children.length && (
                <div className="my-0.5 h-0.5 rounded bg-primary" />
              )}
              {el.children.length === 0 && (
                <div className="rounded-lg border-2 border-dashed border-line py-6 text-center text-[11px] text-slate-400">
                  Drag cards here
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid h-full place-items-center text-slate-400">
          {el.type}
        </div>
      )}

      {selected && onStartLink && !readOnly && !embedded && (
        // Connect ball: drag onto another element to wire an arrow between them.
        <button
          onPointerDown={onStartLink}
          aria-label="Connect"
          title="Drag to connect"
          className="absolute -right-2.5 -top-2.5 z-10 h-4 w-4 cursor-crosshair rounded-full border-2 border-white bg-primary shadow"
        />
      )}

      {!readOnly && !embedded && !el.locked && (
        <div
          onPointerDown={startResize}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
          style={{
            background: `linear-gradient(135deg, transparent 50%, ${selected ? "#6e24ff" : "#cbd5e1"} 50%)`,
          }}
        />
      )}
    </div>
  );
}
