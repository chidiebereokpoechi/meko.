import { api } from "./api.ts";

// Board comments (board-level discussion, not per-element). Matches src/http/routes/boards.ts —
// view access to read and post; newest-first, cursor-paginated.

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
}

export function listComments(boardId: string, cursor?: string | null): Promise<{ data: Comment[]; nextCursor: string | null }> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return api(`/api/boards/${boardId}/comments${q}`);
}

export function postComment(boardId: string, body: string): Promise<Comment> {
  return api(`/api/boards/${boardId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
}
