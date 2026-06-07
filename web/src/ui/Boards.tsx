import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { Board } from "../types.ts";
import { Icon, toast } from "./kit/index.ts";
import { NameModal } from "./NameModal.tsx";
import { MembersModal } from "./MembersModal.tsx";

// Palette for board tiles, picked deterministically from the board id (Milanote-style).
const PALETTE = ["#d9c27e", "#d97e9b", "#7e9bd9", "#86c08a", "#c0867e", "#9b86c0", "#7ec0b8"];
const tileColor = (id: string) => PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]!;

export function Boards({ activeWs, role, onOpen }: { activeWs: string | null; role: string | null; onOpen: (b: Board) => void }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const canManage = role === "owner" || role === "admin";

  useEffect(() => {
    if (!activeWs) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<{ data: Board[] }>(`/api/workspaces/${activeWs}/boards`)
      .then((r) => setBoards(r.data))
      .finally(() => setLoading(false));
  }, [activeWs]);

  if (!activeWs) return <Empty>Create a workspace to get started.</Empty>;
  if (loading) return <Empty>Loading…</Empty>;

  return (
    <main className="flex-1 overflow-auto p-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="heading text-lg text-slate-700">Boards</h1>
        <button
          onClick={() => setShowMembers(true)}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100"
        >
          <Icon.UsersIcon className="text-base" /> Members
        </button>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-8">
        {boards.map((b) => (
          <Tile key={b.id} board={b} viewOnly={!canEdit} onOpen={() => onOpen(b)} />
        ))}
        {canEdit && (
          <button onClick={() => setCreating(true)} className="flex w-28 flex-col items-center gap-2 text-slate-400 hover:text-primary">
            <span className="grid h-24 w-24 place-items-center rounded-3xl border-2 border-dashed border-line-strong text-2xl">
              <Icon.PlusIcon />
            </span>
            <span className="text-xs font-bold">New board</span>
          </button>
        )}
        {!boards.length && !canEdit && <Empty>No boards here yet.</Empty>}
      </div>

      <NameModal
        open={creating}
        title="New board"
        label="Board title"
        onClose={() => setCreating(false)}
        onSubmit={async (title) => {
          const b = await api<Board>(`/api/workspaces/${activeWs}/boards`, { method: "POST", body: JSON.stringify({ title }) });
          toast("Board created", "success");
          onOpen(b);
        }}
      />

      <MembersModal open={showMembers} onClose={() => setShowMembers(false)} workspaceId={activeWs} canManage={canManage} />
    </main>
  );
}

function Tile({ board, viewOnly, onOpen }: { board: Board; viewOnly: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-28 flex-col items-center gap-2 text-center">
      <span className="relative grid h-24 w-24 place-items-center rounded-3xl shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md" style={{ background: tileColor(board.id) }}>
        <span className="text-3xl font-bold text-black/30">{board.title.slice(0, 1).toUpperCase()}</span>
        {viewOnly && (
          <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-white text-slate-500 shadow">
            <Icon.EyeIcon className="text-sm" />
          </span>
        )}
      </span>
      <span className="font-bold text-slate-700">{board.title}</span>
      <span className="text-xs text-slate-400">{new Date(board.updatedAt).toLocaleDateString()}</span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid flex-1 place-items-center text-slate-400">{children}</div>;
}
