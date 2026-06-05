import { api } from "./api.ts";

export interface Unfurl {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

// SSRF-safe unfurl via the API (Phase 5). Returns the cached preview for the link.
export function unfurlLink(boardId: string, url: string): Promise<Unfurl> {
  return api<Unfurl>(`/api/boards/${boardId}/unfurl`, { method: "POST", body: JSON.stringify({ url }) });
}
