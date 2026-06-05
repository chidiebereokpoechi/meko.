import { api } from "./api.ts";
import type { InviteRole } from "./sharing.ts";

// Workspace member + pending-invite management. Matches src/http/routes/workspaces.ts.

export type MemberRole = "owner" | InviteRole;

export interface Member {
  userId: string;
  role: MemberRole;
  displayName: string;
  email: string;
  joinedAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: InviteRole;
  createdAt: string;
  expiresAt: string;
}

export const listMembers = (workspaceId: string) => api<Member[]>(`/api/workspaces/${workspaceId}/members`);

export const setMemberRole = (workspaceId: string, userId: string, role: InviteRole) =>
  api(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });

export const removeMember = (workspaceId: string, userId: string) =>
  api(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });

export const listInvites = (workspaceId: string) => api<PendingInvite[]>(`/api/workspaces/${workspaceId}/invites`);

export const revokeInvite = (workspaceId: string, inviteId: string) =>
  api(`/api/workspaces/${workspaceId}/invites/${inviteId}`, { method: "DELETE" });
