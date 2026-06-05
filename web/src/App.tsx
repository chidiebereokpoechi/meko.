import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { logout, refresh } from "./lib/auth.ts";
import { api } from "./lib/api.ts";
import type { Board, Workspace } from "./types.ts";
import { Login } from "./ui/Login.tsx";
import { Boards } from "./ui/Boards.tsx";
import { Canvas, type BoardControls } from "./ui/Canvas.tsx";
import { TopBar } from "./ui/layout/TopBar.tsx";
import { NameModal } from "./ui/NameModal.tsx";
import { Toaster, toast } from "./ui/kit/index.ts";

type WorkspaceWithRole = Workspace & { role: string };
type Phase = "loading" | "login" | "ready";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [controls, setControls] = useState<BoardControls | null>(null);
  const [crumb, setCrumb] = useState<string | undefined>();
  const [newWs, setNewWs] = useState(false);
  const navigate = useNavigate();

  const loadWorkspaces = () => api<WorkspaceWithRole[]>("/api/workspaces").then(setWorkspaces);

  useEffect(() => {
    refresh().then(async (ok) => {
      if (!ok) return setPhase("login");
      await loadWorkspaces().catch(() => {});
      setPhase("ready");
    });
  }, []);

  if (phase === "loading") return <div className="grid h-screen place-items-center text-slate-400">Loading…</div>;
  if (phase === "login") return <Login onAuthed={async () => { await loadWorkspaces().catch(() => {}); setPhase("ready"); }} />;

  const onLogout = async () => {
    await logout();
    setWorkspaces([]);
    setPhase("login");
    navigate("/");
  };

  return (
    <>
      <Routes>
        <Route
          element={
            <Shell
              workspaces={workspaces}
              controls={controls}
              crumb={crumb}
              onLogout={onLogout}
              onNewWorkspace={() => setNewWs(true)}
            />
          }
        >
          <Route index element={<Home workspaces={workspaces} />} />
          <Route path="w/:workspaceId" element={<BoardsRoute workspaces={workspaces} />} />
          <Route path="w/:workspaceId/b/:boardId" element={<BoardRoute setCrumb={setCrumb} setControls={setControls} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      <NameModal
        open={newWs}
        title="New workspace"
        label="Workspace name"
        onClose={() => setNewWs(false)}
        onSubmit={async (name) => {
          const ws = await api<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
          await loadWorkspaces();
          toast("Workspace created", "success");
          navigate(`/w/${ws.id}`);
        }}
      />
      <Toaster />
    </>
  );
}

// Layout route: persistent top bar + the routed page.
function Shell({
  workspaces,
  controls,
  crumb,
  onLogout,
  onNewWorkspace,
}: {
  workspaces: WorkspaceWithRole[];
  controls: BoardControls | null;
  crumb?: string;
  onLogout: () => void;
  onNewWorkspace: () => void;
}) {
  const { workspaceId, boardId } = useParams();
  const navigate = useNavigate();
  return (
    <div className="flex h-screen flex-col bg-white">
      <TopBar
        workspaces={workspaces}
        activeWs={workspaceId ?? null}
        onPickWorkspace={(id) => navigate(`/w/${id}`)}
        onNewWorkspace={onNewWorkspace}
        crumb={boardId ? crumb : undefined}
        onHome={() => navigate("/")}
        onLogout={onLogout}
        undo={controls?.undo}
        redo={controls?.redo}
        canUndo={!!controls?.canUndo}
        canRedo={!!controls?.canRedo}
        onExport={controls?.exportPng}
      />
      <Outlet />
    </div>
  );
}

// "/" → first workspace, or an empty prompt if there are none.
function Home({ workspaces }: { workspaces: WorkspaceWithRole[] }) {
  if (workspaces[0]) return <Navigate to={`/w/${workspaces[0].id}`} replace />;
  return <div className="grid flex-1 place-items-center text-slate-400">Create a workspace to get started.</div>;
}

function BoardsRoute({ workspaces }: { workspaces: WorkspaceWithRole[] }) {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const role = workspaces.find((w) => w.id === workspaceId)?.role ?? null;
  return <Boards activeWs={workspaceId ?? null} role={role} onOpen={(b) => navigate(`/w/${b.workspaceId}/b/${b.id}`)} />;
}

// Board canvas — fetches the board's title for the breadcrumb, then mounts the live canvas.
function BoardRoute({ setCrumb, setControls }: { setCrumb: (t?: string) => void; setControls: (c: BoardControls | null) => void }) {
  const { workspaceId, boardId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    api<Board>(`/api/boards/${boardId}`)
      .then((b) => alive && setCrumb(b.title))
      .catch(() => {
        toast("Board not found", "error");
        navigate(`/w/${workspaceId}`, { replace: true });
      });
    return () => {
      alive = false;
      setCrumb(undefined);
    };
  }, [boardId]);

  return <Canvas boardId={boardId!} onControls={setControls} />;
}
