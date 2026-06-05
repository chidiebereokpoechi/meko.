import { api } from "./api.ts";

// Board share links + workspace invites. Matches src/http/routes/sharing.ts. Raw tokens come back
// from the server exactly once (on create) — we turn them into links on the web origin so a
// recipient lands in the app, signs in if needed, and the token is redeemed by the accept routes.

export type ShareLevel = "view" | "edit";
export type InviteRole = "admin" | "editor" | "viewer";

export interface ShareLink {
  id: string;
  level: ShareLevel;
  expiresAt: string | null;
  revokedAt?: string | null;
  createdAt?: string;
}

export const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;
export const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

export function listShareLinks(boardId: string): Promise<ShareLink[]> {
  return api<ShareLink[]>(`/api/boards/${boardId}/share`);
}

export function createShareLink(boardId: string, level: ShareLevel, expiresInHours?: number): Promise<ShareLink & { token: string }> {
  return api<ShareLink & { token: string }>(`/api/boards/${boardId}/share`, {
    method: "POST",
    body: JSON.stringify({ level, ...(expiresInHours ? { expiresInHours } : {}) }),
  });
}

export function revokeShareLink(boardId: string, linkId: string): Promise<{ ok: true }> {
  return api(`/api/boards/${boardId}/share/${linkId}/revoke`, { method: "POST" });
}

export function acceptShare(token: string): Promise<{ boardId: string; level: ShareLevel }> {
  return api(`/api/share/accept`, { method: "POST", body: JSON.stringify({ token }) });
}

export function createInvite(workspaceId: string, email: string, role: InviteRole): Promise<{ id: string; email: string; role: InviteRole; token: string }> {
  return api(`/api/workspaces/${workspaceId}/invites`, { method: "POST", body: JSON.stringify({ email, role }) });
}

export function acceptInvite(token: string): Promise<{ workspaceId: string; role: InviteRole }> {
  return api(`/api/invites/accept`, { method: "POST", body: JSON.stringify({ token }) });
}
