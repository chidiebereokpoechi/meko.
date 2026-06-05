import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Icon } from "../kit/index.ts";
import type { Workspace } from "../../types.ts";

export interface ViewControls {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  zoomToFit: () => void;
  toggleGrid: () => void;
  gridOn: boolean;
  zoomPct: number;
}

// Milanote-style full-width bar: logo + breadcrumb (workspace switcher) on the left, action icons
// on the right.
export function TopBar({
  workspaces,
  activeWs,
  onPickWorkspace,
  onNewWorkspace,
  crumb = [],
  onCrumb,
  onHome,
  onLogout,
  undo,
  redo,
  canUndo,
  canRedo,
  onExport,
  onShare,
  view,
}: {
  workspaces: (Workspace & { role: string })[];
  activeWs: string | null;
  onPickWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  crumb?: { id: string; title: string }[];
  onCrumb?: (id: string) => void;
  onHome: () => void;
  onLogout: () => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onExport?: () => void;
  onShare?: () => void;
  view?: ViewControls;
}) {
  const active = workspaces.find((w) => w.id === activeWs);
  return (
    <div>
    <header className="flex h-14 items-center gap-3 border-b-2 border-slate-100 bg-slate-100 px-4">
      <button onClick={onHome} className="grid h-7 w-7 place-items-center rounded-lg bg-primary font-bold text-white">
        m
      </button>

      <Menu as="div" className="relative">
        <MenuButton className="flex items-center gap-1 font-bold text-slate-600 hover:text-primary-dark">
          {active?.name ?? "meko."}
          <Icon.ChevronDown className="text-base" />
        </MenuButton>
        <MenuItems className="absolute left-0 z-[90] mt-1 w-52 rounded-lg border-2 border-slate-100 bg-white p-1 shadow-lg focus:outline-none">
          {workspaces.map((w) => (
            <MenuItem key={w.id}>
              <button onClick={() => onPickWorkspace(w.id)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left font-bold text-slate-600 data-[focus]:bg-primary/10 data-[focus]:text-primary-dark">
                {w.name}
                <span className="text-xs font-normal text-slate-400">{w.role}</span>
              </button>
            </MenuItem>
          ))}
          <div className="my-1 border-t-2 border-slate-100" />
          <MenuItem>
            <button onClick={onNewWorkspace} className="flex w-full items-center gap-1 rounded-md px-3 py-2 text-left font-bold text-primary data-[focus]:bg-primary/10">
              <Icon.PlusIcon className="text-base" /> New workspace
            </button>
          </MenuItem>
        </MenuItems>
      </Menu>

      {crumb.map((c, i) => {
        const last = i === crumb.length - 1;
        return (
          <span key={c.id} className="flex items-center gap-3">
            <span className="text-slate-300">/</span>
            {last ? (
              <span className="font-bold text-slate-500">{c.title}</span>
            ) : (
              <button onClick={() => onCrumb?.(c.id)} className="font-bold text-slate-400 hover:text-primary-dark">
                {c.title}
              </button>
            )}
          </span>
        );
      })}

      <span className="flex-1" />

      {undo && (
        <div className="mr-1 flex items-center gap-1 text-slate-400">
          <IconBtn label="Undo" onClick={undo} disabled={!canUndo}>
            <Icon.UndoIcon className="text-lg" />
          </IconBtn>
          <IconBtn label="Redo" onClick={redo} disabled={!canRedo}>
            <Icon.RedoIcon className="text-lg" />
          </IconBtn>
        </div>
      )}

      <div className="flex items-center gap-1 text-slate-400">
        <IconBtn label="Search">
          <Icon.SearchIcon className="text-lg" />
        </IconBtn>
        <IconBtn label="Help">
          <Icon.HelpIcon className="text-lg" />
        </IconBtn>
        <IconBtn label="Notifications">
          <Icon.BellIcon className="text-lg" />
        </IconBtn>
        <IconBtn label="Settings">
          <Icon.SettingsIcon className="text-lg" />
        </IconBtn>
      </div>
      <button onClick={onLogout} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-primary-dark">
        Log out
      </button>
    </header>

      {/* Board actions row (canvas view). */}
      {onExport && (
        <div className="flex items-center justify-end gap-2 border-b-2 border-slate-100 bg-white px-4 py-2">
          <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100" onClick={onShare}>
            <Icon.ShareIcon className="text-base" /> Share
          </button>
          <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100" onClick={onExport}>
            <Icon.ExportIcon className="text-base" /> Export
          </button>
          {view && (
            <Menu as="div" className="relative">
              <MenuButton className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100">
                View <Icon.ChevronDown className="text-base" />
              </MenuButton>
              <MenuItems className="absolute right-0 z-[90] mt-1 w-48 rounded-lg border-2 border-slate-100 bg-white p-1 shadow-lg focus:outline-none">
                <ViewItem onClick={view.zoomIn}>Zoom in</ViewItem>
                <ViewItem onClick={view.zoomOut}>Zoom out</ViewItem>
                <ViewItem onClick={view.resetView}>
                  Reset zoom <span className="text-xs font-normal text-slate-400">{view.zoomPct}%</span>
                </ViewItem>
                <ViewItem onClick={view.zoomToFit}>Zoom to fit</ViewItem>
                <div className="my-1 border-t-2 border-slate-100" />
                <ViewItem onClick={view.toggleGrid}>
                  Dot grid {view.gridOn && <Icon.CheckIcon className="text-sm text-primary" />}
                </ViewItem>
              </MenuItems>
            </Menu>
          )}
        </div>
      )}
    </div>
  );
}

function ViewItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <MenuItem>
      <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs font-bold text-slate-600 data-[focus]:bg-primary/10 data-[focus]:text-primary-dark">
        {children}
      </button>
    </MenuItem>
  );
}

function IconBtn({ label, children, onClick, disabled }: { label: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-200 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}
