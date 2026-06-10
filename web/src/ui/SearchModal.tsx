import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import type { Board, Workspace } from "../types.ts";
import { Icon, Modal } from "./kit/index.ts";

// ⌘K board search across every workspace the user can see. Boards are fetched fresh on open
// (parallel per workspace — fine at personal scale), filtered client-side by title.
export function SearchModal({
  open,
  onClose,
  workspaces,
  onOpenBoard,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: (Workspace & { role: string })[];
  onOpenBoard: (b: Board) => void;
}) {
  const [query, setQuery] = useState("");
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wsName = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setLoading(true);
    let alive = true;
    Promise.all(
      workspaces.map((w) =>
        api<{ data: Board[] }>(`/api/workspaces/${w.id}/boards`)
          .then((r) => r.data)
          .catch(() => [] as Board[]),
      ),
    )
      .then((lists) => alive && setBoards(lists.flat()))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = query.trim().toLowerCase();
  const hits = (q ? boards.filter((b) => b.title.toLowerCase().includes(q)) : boards).slice(0, 8);
  const sel = Math.min(cursor, Math.max(0, hits.length - 1));

  const pick = (b: Board) => {
    onOpenBoard(b);
    onClose();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[sel]) pick(hits[sel]);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Search boards">
      <div className="flex items-center gap-2 rounded-lg border-2 border-line bg-slate-50 px-3 py-2 focus-within:border-primary">
        <Icon.SearchIcon className="text-base text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Board title…"
          className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400"
        />
      </div>
      <div className="flex flex-col">
        {loading && <p className="px-1 py-2 text-xs text-slate-400">Loading…</p>}
        {!loading && !hits.length && <p className="px-1 py-2 text-xs text-slate-400">No boards match.</p>}
        {!loading &&
          hits.map((b, i) => (
            <button
              key={b.id}
              onClick={() => pick(b)}
              onMouseEnter={() => setCursor(i)}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left ${i === sel ? "bg-primary/10 text-primary-dark" : "text-slate-600"}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon.BoardIcon className="shrink-0 text-base" />
                <span className="truncate text-xs font-bold">{b.title}</span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-400">{wsName.get(b.workspaceId) ?? ""}</span>
            </button>
          ))}
      </div>
    </Modal>
  );
}
