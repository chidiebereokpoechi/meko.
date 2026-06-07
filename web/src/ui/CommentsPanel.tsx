import { useEffect, useState } from "react";
import { type Comment, listComments, postComment } from "../lib/comments.ts";
import { Icon, toast } from "./kit/index.ts";

// Board-level discussion panel (slide-over on the right of the canvas). Newest-first, cursor
// "Load more". Composer sends on Enter (Shift+Enter for a newline). The POST response omits the
// author name, so after posting we refetch the first page to render it consistently.
export function CommentsPanel({ boardId, open, signal, onClose }: { boardId: string; open: boolean; signal: number; onClose: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const loadFirst = () => {
    setLoading(true);
    listComments(boardId)
      .then((p) => {
        setComments(p.data);
        setCursor(p.nextCursor);
      })
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  };

  // Reload on open, board change, or a realtime comment signal (a peer posted).
  useEffect(() => {
    if (open) loadFirst();
  }, [open, boardId, signal]);

  const loadMore = () => {
    if (!cursor) return;
    setLoading(true);
    listComments(boardId, cursor)
      .then((p) => {
        setComments((c) => [...c, ...p.data]);
        setCursor(p.nextCursor);
      })
      .finally(() => setLoading(false));
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await postComment(boardId, body);
      setDraft("");
      loadFirst(); // refetch so the new comment shows with its author name
    } catch {
      toast("Couldn't post comment", "error");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l-2 border-line-subtle bg-white">
      <header className="flex items-center justify-between border-b-2 border-line-subtle px-4 py-3">
        <span className="heading text-sm text-slate-700">Comments</span>
        <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Icon.CloseIcon className="text-base" />
        </button>
      </header>

      <div className="flex-1 overflow-auto px-4 py-3">
        {comments.length === 0 && !loading && <p className="mt-6 text-center text-xs text-slate-400">No comments yet.</p>}
        <div className="grid gap-3">
          {comments.map((c) => (
            <div key={c.id} className="grid gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">{c.authorName}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{relativeTime(c.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-xs text-slate-600">{c.body}</p>
            </div>
          ))}
        </div>
        {cursor && (
          <button onClick={loadMore} disabled={loading} className="mt-3 w-full rounded-md py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      <div className="border-t-2 border-line-subtle p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Write a comment…"
            className="max-h-32 min-h-[2.25rem] flex-1 resize-none rounded-lg border-2 border-line bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 placeholder:font-normal placeholder:text-slate-400"
          />
          <button
            onClick={send}
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-white hover:bg-primary-dark disabled:bg-slate-200"
          >
            <Icon.SendIcon className="text-base" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}
