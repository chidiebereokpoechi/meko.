import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { Board, Workspace } from "../types.ts";

type WorkspaceWithRole = Workspace & { role: string };

export function Boards({ onOpen }: { onOpen: (b: Board) => void }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [activeWs, setActiveWs] = useState<string | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWorkspaces = async () => {
    const ws = await api<WorkspaceWithRole[]>("/api/workspaces");
    setWorkspaces(ws);
    if (ws.length && !activeWs) setActiveWs(ws[0]!.id);
    setLoading(false);
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (!activeWs) return;
    api<{ data: Board[] }>(`/api/workspaces/${activeWs}/boards`).then((r) => setBoards(r.data));
  }, [activeWs]);

  const createWorkspace = async () => {
    const name = prompt("Workspace name")?.trim();
    if (!name) return;
    const ws = await api<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
    await loadWorkspaces();
    setActiveWs(ws.id);
  };

  const createBoard = async () => {
    if (!activeWs) return;
    const title = prompt("Board title")?.trim() || "Untitled";
    const b = await api<Board>(`/api/workspaces/${activeWs}/boards`, { method: "POST", body: JSON.stringify({ title }) });
    onOpen(b);
  };

  if (loading) return <div className="grid flex-1 place-items-center text-slate-400">Loading…</div>;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Workspace rail */}
      <aside className="flex w-56 flex-col gap-1 border-r-2 border-slate-100 bg-white p-3">
        <div className="px-2 pb-2 font-bold uppercase tracking-wide text-slate-400">Workspaces</div>
        {workspaces.map((w) => (
          <button
            key={w.id}
            onClick={() => setActiveWs(w.id)}
            className={`rounded-lg px-3 py-2 text-left font-bold ${
              w.id === activeWs ? "bg-primary/10 text-primary-dark" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {w.name}
          </button>
        ))}
        <button className="link mt-1 px-3 text-left" onClick={createWorkspace}>
          + New workspace
        </button>
      </aside>

      {/* Boards grid */}
      <main className="flex-1 overflow-auto p-6">
        {!activeWs ? (
          <div className="text-slate-400">Create a workspace to get started.</div>
        ) : (
          <>
            <div className="mb-4 flex items-center">
              <h2 className="heading text-base">Boards</h2>
              <span className="flex-1" />
              <button className="btn" onClick={createBoard}>
                + New board
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {boards.map((b) => (
                <button key={b.id} className="card flex h-32 flex-col justify-end p-4 text-left hover:shadow-xl" onClick={() => onOpen(b)}>
                  <div className="heading text-sm">{b.title}</div>
                  <div className="text-slate-400">{new Date(b.updatedAt).toLocaleDateString()}</div>
                </button>
              ))}
              {!boards.length && <div className="text-slate-400">No boards yet.</div>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
