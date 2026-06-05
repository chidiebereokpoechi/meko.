import type { ReactNode } from "react";
import { Tooltip } from "../kit/index.ts";

export interface Tool {
  key: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  // Action tool: fires on single click (e.g. Export, Back, formatting toggles).
  onClick?: () => void;
  // Placeable tool: double-click drops it at the canvas centre; also draggable onto the canvas.
  // `dragKey` is written to the drag payload so the canvas knows what to create on drop.
  onPlace?: () => void;
  dragKey?: string;
}

// Milanote-style vertical rail. Placeable tools are created by double-click or drag (not a single
// click), matching Milanote. The active tool's square is filled primary.
export function ToolRail({ tools, bottom = [] }: { tools: Tool[]; bottom?: Tool[] }) {
  return (
    <nav className="flex w-20 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3">
      {tools.map((t) => (
        <ToolButton key={t.key} tool={t} />
      ))}
      <span className="flex-1" />
      {bottom.map((t) => (
        <ToolButton key={t.key} tool={t} />
      ))}
    </nav>
  );
}

function ToolButton({ tool }: { tool: Tool }) {
  const placeable = !!tool.dragKey || !!tool.onPlace;
  return (
    <Tooltip label={tool.label} shortcut={tool.shortcut}>
      <button
        onClick={tool.onClick}
        onDoubleClick={tool.onPlace}
        disabled={tool.disabled}
        draggable={placeable && !tool.disabled}
        onDragStart={(e) => tool.dragKey && e.dataTransfer.setData("application/x-meko-tool", tool.dragKey)}
        title=""
        className="group flex w-full flex-col items-center gap-1 py-1.5 disabled:opacity-40"
      >
        <span
          className={[
            "grid h-9 w-9 place-items-center rounded-xl text-lg transition-colors",
            placeable ? "cursor-grab active:cursor-grabbing" : "",
            tool.active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700",
          ].join(" ")}
        >
          {tool.icon}
        </span>
        <span className="text-[10px] font-bold text-slate-400">{tool.label}</span>
      </button>
    </Tooltip>
  );
}
