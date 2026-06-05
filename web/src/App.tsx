import { useEffect, useState } from "react";
import { logout, refresh } from "./lib/auth.ts";
import { Login } from "./ui/Login.tsx";
import { Boards } from "./ui/Boards.tsx";
import { Canvas } from "./ui/Canvas.tsx";

type View =
  | { name: "loading" }
  | { name: "login" }
  | { name: "boards" }
  | { name: "canvas"; boardId: string; title: string };

export function App() {
  const [view, setView] = useState<View>({ name: "loading" });

  // Silent refresh on load: if the HttpOnly cookie is still valid we land authenticated.
  useEffect(() => {
    refresh().then((ok) =>
      setView(ok ? { name: "boards" } : { name: "login" }),
    );
  }, []);

  if (view.name === "loading")
    return (
      <div className="grid h-screen place-items-center text-slate-400">
        Loading…
      </div>
    );

  if (view.name === "login")
    return <Login onAuthed={() => setView({ name: "boards" })} />;

  const onLogout = async () => {
    await logout();
    setView({ name: "login" });
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-3 border-b-2 border-slate-100 bg-white px-5 py-3">
        <button
          className="heading text-base text-primary"
          onClick={() => setView({ name: "boards" })}
        >
          meko.
        </button>
        {view.name === "canvas" && (
          <span className="text-slate-400">/ {view.title}</span>
        )}
        <span className="flex-1" />
        <button className="btn-ghost" onClick={onLogout}>
          Log out
        </button>
      </header>
      {view.name === "boards" ? (
        <Boards
          onOpen={(b) =>
            setView({ name: "canvas", boardId: b.id, title: b.title })
          }
        />
      ) : (
        <Canvas boardId={view.boardId} />
      )}
    </div>
  );
}
