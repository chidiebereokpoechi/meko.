import { useEffect, useRef, type CSSProperties } from "react";
import { sanitizeHtml } from "../lib/sanitize.ts";

export interface ActiveEditor {
  el: HTMLElement;
  commit: () => void;
}

// Rich-text note body. Uncontrolled contentEditable so the caret survives keystrokes; we only
// write sanitised HTML out to Yjs (never re-set innerHTML while focused). Remote edits are applied
// to the DOM only when this editor isn't focused. `editing` gates contentEditable so the first
// click selects the note and a second click enters edit mode.
export function EditableNote({
  id,
  html,
  editing,
  style,
  onText,
  onRegister,
}: {
  id: string;
  html: string;
  editing: boolean;
  style: CSSProperties;
  onText: (html: string) => void;
  onRegister: (e: ActiveEditor | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed content on mount / when switching to a different note.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Apply remote changes only when we're not the one editing (avoids caret jumps).
  useEffect(() => {
    const d = ref.current;
    if (!d || document.activeElement === d) return;
    const clean = sanitizeHtml(html);
    if (d.innerHTML !== clean) d.innerHTML = clean;
  });

  // Focus the text when entering edit mode.
  useEffect(() => {
    if (editing && ref.current && document.activeElement !== ref.current)
      ref.current.focus();
  }, [editing]);

  return (
    <div
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      data-empty-placeholder="Start typing..."
      className="note-editable h-full w-full overflow-auto p-4 outline-none"
      style={style}
      onFocus={() =>
        onRegister({
          el: ref.current!,
          commit: () => onText(sanitizeHtml(ref.current!.innerHTML)),
        })
      }
      onInput={() => onText(sanitizeHtml(ref.current!.innerHTML))}
    />
  );
}
