import { useEffect, useState } from "react";
import { logout, refresh } from "./lib/auth.ts";
import { api } from "./lib/api.ts";
import type { Board, Workspace } from "./types.ts";
import { Login } from "./ui/Login.tsx";
import { Boards } from "./ui/Boards.tsx";
import { Canvas } from "./ui/Canvas.tsx";
import { TopBar } from "./ui/layout/TopBar.tsx";
import { NameModal } from "./ui/NameModal.tsx";
import { Toaster, toast } from "./ui/kit/index.ts";

type WorkspaceWithRole = Workspace & { role: string };
type Phase = "loading" | "login" | "ready";
type Sub = { name: "boards" } | { name: "canvas"; board: Board };

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [activeWs, setActiveWs] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>({ name: "boards" });
  const [newWs, setNewWs] = useState(false);

  const loadWorkspaces = async () => {
    const ws = await api<WorkspaceWithRole[]>("/api/workspaces");
    setWorkspaces(ws);
    setActiveWs((cur) => cur ?? ws[0]?.id ?? null);
  };

  useEffect(() => {
    refresh().then(async (ok) => {
      if (!ok) return setPhase("login");
      await loadWorkspaces().catch(() => {});
      setPhase("ready");
    });
  }, []);

  const onAuthed = async () => {
    await loadWorkspaces().catch(() => {});
    setPhase("ready");
  };

  const onLogout = async () => {
    await logout();
    setWorkspaces([]);
    setActiveWs(null);
    setSub({ name: "boards" });
    setPhase("login");
  };

  if (phase === "loading")
    return (
      <div className="grid h-screen place-items-center text-slate-400">
        Loading…
      </div>
    );
  if (phase === "login") return <Login onAuthed={onAuthed} />;

  return (
    <div className="flex h-screen flex-col bg-white">
      <TopBar
        workspaces={workspaces}
        activeWs={activeWs}
        onPickWorkspace={(id) => {
          setActiveWs(id);
          setSub({ name: "boards" });
        }}
        onNewWorkspace={() => setNewWs(true)}
        crumb={sub.name === "canvas" ? sub.board.title : undefined}
        onHome={() => setSub({ name: "boards" })}
        onLogout={onLogout}
      />

      {sub.name === "boards" ? (
        <Boards
          activeWs={activeWs}
          role={workspaces.find((w) => w.id === activeWs)?.role ?? null}
          onOpen={(board) => setSub({ name: "canvas", board })}
        />
      ) : (
        <Canvas boardId={sub.board.id} />
      )}

      <NameModal
        open={newWs}
        title="New workspace"
        label="Workspace name"
        onClose={() => setNewWs(false)}
        onSubmit={async (name) => {
          const ws = await api<Workspace>("/api/workspaces", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          await loadWorkspaces();
          setActiveWs(ws.id);
          toast("Workspace created", "success");
        }}
      />
      <Toaster />
    </div>
  );
}
