import type { ReactNode, Ref } from "react";
import { Icon, Tooltip } from "../kit/index.ts";

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
    <nav className="flex w-20 shrink-0 flex-col items-center gap-1 border-r-2 border-slate-100 bg-white py-3">
      {tools.map((t) => (
        <ToolButton key={t.key} tool={t} />
      ))}
      <span className="flex-1" />
      <div ref={deleteRef} className="flex w-full justify-center">
        <ToolButton tool={{ key: "delete", label: "Delete", icon: <Icon.TrashIcon />, onClick: onDelete, disabled: !onDelete, deleteActive }} />
      </div>
    </nav>
  );
}

function ToolButton({ tool }: { tool: Tool }) {
  const placeable = !!tool.onStartPlace || !!tool.onPlace;
  return (
    <Tooltip label={tool.label} shortcut={tool.shortcut}>
      <button
        onClick={tool.onClick}
        onDoubleClick={tool.onPlace}
        disabled={tool.disabled}
        // Press-and-drag to place the element under the cursor (no HTML5 drag / drop zone).
        onPointerDown={tool.onStartPlace && !tool.disabled ? (e) => { e.preventDefault(); tool.onStartPlace!(e); } : undefined}
        title=""
        className="group flex w-full flex-col items-center gap-1 py-1.5 disabled:opacity-40"
      >
        <span
          className={[
            "grid h-9 w-9 place-items-center rounded-xl text-lg transition-all",
            placeable ? "cursor-grab active:cursor-grabbing" : "",
            tool.deleteActive
              ? "scale-110 bg-red-500 text-white"
              : tool.active
                ? "bg-primary text-white"
                : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700",
          ].join(" ")}
        >
          {tool.icon}
        </span>
        <span className="text-[10px] font-bold text-slate-400">{tool.label}</span>
      </button>
    </Tooltip>
  );
}
