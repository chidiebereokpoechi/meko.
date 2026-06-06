import type { RefObject } from "react";
import type { Connection, Element, LineShape } from "../../types.ts";
import { Icon } from "../kit/index.ts";
import { ToolRail, type Tool } from "../layout/ToolRail.tsx";
import { type ActiveEditor } from "../EditableNote.tsx";
import { NoteSubRail } from "../NoteSubRail.tsx";
import { LinkSubRail } from "../LinkSubRail.tsx";
import { ImageSubRail } from "../ImageSubRail.tsx";
import { CommonSubRail } from "../CommonSubRail.tsx";
import { TodoSubRail } from "../TodoSubRail.tsx";
import { BoardSubRail } from "../BoardSubRail.tsx";
import { ConnectionSubRail } from "../ConnectionSubRail.tsx";
import { EmbedSubRail } from "../EmbedSubRail.tsx";
import { ColumnSubRail } from "../ColumnSubRail.tsx";

type Patch = (id: string, p: Record<string, unknown>) => void;

// Picks the left-hand rail for the current selection: a read-only badge, an edge (connection/line)
// rail, the multi-select common rail, the per-type element rail, or the default create-tool rail.
export type SelectionRailProps = {
  readOnly: boolean;
  selected: Element | null;
  connections: Connection[];
  lines: LineShape[];
  selectedConn: string | null;
  selectedLine: string | null;
  selectedId: string | null;
  selectedIds: string[];
  selectedEls: Element[];
  editingId: string | null;
  captionEditing: boolean;
  deleteRef: RefObject<HTMLDivElement>;
  overDelete: boolean;
  createTools: Tool[];
  editorRef: RefObject<ActiveEditor | null>;
  patch: (id: string, p: Partial<Element>) => void;
  patchConnection: Patch;
  patchLine: Patch;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  removeConnection: (id: string) => void;
  removeLine: (id: string) => void;
  setEditingConnLabel: (id: string) => void;
  setEditingLineLabel: (id: string) => void;
  setSelectedConn: (id: string | null) => void;
  setSelectedLine: (id: string | null) => void;
  setEditingId: (id: string | null) => void;
  setCaptionEditing: (v: boolean) => void;
  exec: (command: string, value?: string) => void;
  setStyleKey: (key: "fill" | "strip", hex: string | null) => void;
  setStyleAll: (key: "fill" | "strip", hex: string | null) => void;
  toggleCaptionAll: () => void;
  togglePreviewAll: () => void;
  deselect: () => void;
  onOpenBoard: (boardId: string) => void;
};

// Edge (connection/line) rail: both rails are identical bar their patch/remove fns and the
// arrow-end default (connections point by default, lines don't).
type Edge = { id: string; color?: string; arrowStart?: boolean; arrowEnd?: boolean; dashed?: boolean; weight?: number; label?: string };
function edgeRail(edge: Edge, patchFn: Patch, removeFn: (id: string) => void, editLabel: (id: string) => void, onDone: () => void, endDefault: boolean) {
  return {
    conn: edge,
    onDone,
    onColor: (hex: string) => patchFn(edge.id, { color: hex }),
    onToggleStart: () => patchFn(edge.id, { arrowStart: !(edge.arrowStart ?? false) }),
    onToggleEnd: () => patchFn(edge.id, { arrowEnd: !(edge.arrowEnd ?? endDefault) }),
    onLabel: () => editLabel(edge.id),
    onToggleDashed: () => patchFn(edge.id, { dashed: !edge.dashed }),
    onCycleWeight: () => { const w = edge.weight ?? 2; patchFn(edge.id, { weight: w === 2 ? 4 : w === 4 ? 6 : 2 }); },
    onDelete: () => removeFn(edge.id),
  };
}

export function SelectionRail(p: SelectionRailProps) {
  const { selected, deleteRef, overDelete, selectedId, deselect } = p;
  const common = { deleteRef, deleteActive: overDelete, onDone: deselect };
  const onStrip = (hex: string | null) => p.setStyleKey("strip", hex);
  const onFill = (hex: string | null) => p.setStyleKey("fill", hex);
  const onDelete = () => selectedId && p.remove(selectedId);

  if (p.readOnly)
    return (
      <nav className="flex w-20 shrink-0 flex-col items-center gap-2 border-r-2 border-slate-100 bg-white py-3 text-center">
        <Icon.EyeIcon className="text-xl text-slate-400" />
        <span className="px-1 text-[10px] font-bold leading-tight text-slate-400">View only</span>
      </nav>
    );

  const conn = p.selectedConn ? p.connections.find((c) => c.id === p.selectedConn) : null;
  if (conn) return <ConnectionSubRail {...edgeRail(conn, p.patchConnection, p.removeConnection, p.setEditingConnLabel, () => p.setSelectedConn(null), true)} />;

  const line = p.selectedLine ? p.lines.find((l) => l.id === p.selectedLine) : null;
  if (line) return <ConnectionSubRail {...edgeRail(line, p.patchLine, p.removeLine, p.setEditingLineLabel, () => p.setSelectedLine(null), false)} />;

  if (p.selectedIds.length > 1)
    return (
      <CommonSubRail
        els={p.selectedEls}
        deleteRef={deleteRef}
        deleteActive={overDelete}
        onDone={deselect}
        onFillAll={(hex) => p.setStyleAll("fill", hex)}
        onStripAll={(hex) => p.setStyleAll("strip", hex)}
        onToggleCaption={p.toggleCaptionAll}
        onTogglePreview={p.togglePreviewAll}
        onDelete={() => p.removeMany(p.selectedIds)}
      />
    );

  if (selected && (selected.type === "note" || selected.type === "text"))
    return <NoteSubRail el={selected} editing={p.editingId === selected.id} {...common} onBack={() => p.setEditingId(null)} onExec={p.exec} onFill={onFill} onStrip={onStrip} onDelete={onDelete} />;

  if (selected && selected.type === "link")
    return <LinkSubRail el={selected} {...common} onPatch={(patch) => p.patch(selected.id, patch as Partial<Element>)} onStrip={onStrip} onDelete={onDelete} />;

  if (selected && selected.type === "image" && p.captionEditing)
    // Caption focused → note-style text-formatting rail acting on the caption editor.
    return (
      <NoteSubRail
        el={selected}
        editing
        {...common}
        onBack={() => { p.setCaptionEditing(false); p.editorRef.current?.el.blur(); }}
        onExec={p.exec}
        onFill={() => {}}
        onStrip={onStrip}
        onDelete={onDelete}
      />
    );

  if (selected && selected.type === "image")
    return <ImageSubRail el={selected} {...common} onPatch={(patch) => p.patch(selected.id, patch as Partial<Element>)} onStrip={onStrip} onDelete={onDelete} />;

  if (selected && selected.type === "todo")
    return <TodoSubRail el={selected} {...common} onFill={onFill} onStrip={onStrip} onDelete={onDelete} />;

  if (selected && selected.type === "board")
    return <BoardSubRail el={selected} {...common} onOpen={() => p.onOpenBoard(selected.boardId)} onFill={onFill} onStrip={onStrip} onDelete={onDelete} />;

  if (selected && selected.type === "embed")
    return <EmbedSubRail el={selected} {...common} onStrip={onStrip} onDelete={onDelete} />;

  if (selected && selected.type === "column")
    return <ColumnSubRail el={selected} {...common} onToggleCollapse={() => p.patch(selected.id, { collapsed: !selected.collapsed } as Partial<Element>)} onFill={onFill} onStrip={onStrip} onDelete={onDelete} />;

  return <ToolRail tools={p.createTools} deleteRef={deleteRef} deleteActive={overDelete} onDelete={p.selectedIds.length ? () => p.removeMany(p.selectedIds) : undefined} />;
}
