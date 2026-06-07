import type { ReactNode, Ref } from "react";
import { RailBtn, RailShell } from "../NoteSubRail.tsx";

export interface Tool {
  key: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  // Action tool: fires on single click (e.g. Export, Back, formatting toggles).
  onClick?: () => void;
  // Placeable tool: double-click drops it at the canvas centre.
  onPlace?: () => void;
  // Press-and-drag to spawn the element under the cursor and place it on release.
  onStartPlace?: (e: React.PointerEvent) => void;
  // Highlight the Delete tool while an element is dragged over it.
  deleteActive?: boolean;
}

// Milanote-style vertical rail. Placeable tools are created by double-click or drag (not a single
// click), matching Milanote. The active tool's square is filled primary. A Delete tool is always
// pinned to the bottom — it deletes the selection and is the drop target for drag-to-delete.
export function ToolRail({
  tools,
  deleteRef,
  deleteActive,
  onDelete,
}: {
  tools: Tool[];
  deleteRef?: Ref<HTMLDivElement>;
  deleteActive?: boolean;
  onDelete?: () => void;
}) {
  return (
    <RailShell deleteRef={deleteRef} deleteActive={deleteActive} onDelete={onDelete} deleteDisabled={!onDelete}>
      {tools.map((t) => (
        <RailBtn
          key={t.key}
          label={t.label}
          shortcut={t.shortcut}
          icon={t.icon}
          active={t.active}
          dangerActive={t.deleteActive}
          disabled={t.disabled}
          onClick={t.onClick}
          onPlace={t.onPlace}
          onStartPlace={t.onStartPlace}
        />
      ))}
    </RailShell>
  );
}
