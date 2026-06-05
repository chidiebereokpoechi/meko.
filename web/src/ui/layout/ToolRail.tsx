import type { ReactNode } from "react";

export interface Tool {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

// Milanote-style vertical rail: each tool is an icon-in-rounded-square + label. The active tool's
// square is filled primary. `bottom` tools (e.g. Trash) pin to the foot.
export function ToolRail({ tools, bottom = [] }: { tools: Tool[]; bottom?: Tool[] }) {
  return (
    <nav className="flex w-20 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3">
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
  return (
    <button
      onClick={tool.onClick}
      disabled={tool.disabled}
      title={tool.label}
      className="group flex w-full flex-col items-center gap-1 py-1.5 disabled:opacity-40"
    >
      <span
        className={[
          "grid h-9 w-9 place-items-center rounded-xl text-lg transition-colors",
          tool.active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700",
        ].join(" ")}
      >
        {tool.icon}
      </span>
      <span className="text-[10px] font-bold text-slate-400">{tool.label}</span>
    </button>
  );
}
