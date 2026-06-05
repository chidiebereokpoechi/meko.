import { and, eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boardPermissions, boards, members } from "@/db/schema.ts";
import { securityEvent } from "@/lib/logger.ts";

export type Access = "edit" | "view" | null;

const EDIT_ROLES = new Set(["owner", "admin", "editor"]);

// Workspace membership role, or null if not a member.
export async function workspaceRole(userId: string, workspaceId: string): Promise<string | null> {
  const [m] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

// Effective access to a board: the stronger of workspace-role-derived access and any explicit
// per-board grant (§9). Returns null when the user can't see the board at all.
export async function boardAccess(userId: string, boardId: string): Promise<Access> {
  const [board] = await db.select({ workspaceId: boards.workspaceId }).from(boards).where(eq(boards.id, boardId)).limit(1);
  if (!board) return null;

  let access: Access = null;
  const role = await workspaceRole(userId, board.workspaceId);
  if (role) access = EDIT_ROLES.has(role) ? "edit" : "view";

  if (access !== "edit") {
    const [bp] = await db
      .select({ level: boardPermissions.level })
      .from(boardPermissions)
      .where(and(eq(boardPermissions.boardId, boardId), eq(boardPermissions.userId, userId)))
      .limit(1);
    if (bp?.level === "edit") access = "edit";
    else if (bp?.level === "view" && access === null) access = "view";
  }
  return access;
}

// Guard helpers: throw a tagged error the route layer maps to 403. Logs the denial (§3g).
export class ForbiddenError extends Error {}

// Require the user to hold one of `roles` in the workspace (e.g. owner/admin to invite).
export async function requireWorkspaceRole(userId: string, workspaceId: string, roles: string[]): Promise<string> {
  const role = await workspaceRole(userId, workspaceId);
  if (!role || !roles.includes(role)) {
    securityEvent("perm.denied", { userId, workspaceId, need: roles, have: role });
    throw new ForbiddenError("FORBIDDEN");
  }
  return role;
}

export async function requireBoardAccess(userId: string, boardId: string, need: "view" | "edit"): Promise<Access> {
  const access = await boardAccess(userId, boardId);
  const ok = need === "view" ? access === "view" || access === "edit" : access === "edit";
  if (!ok) {
    securityEvent("perm.denied", { userId, boardId, need, have: access });
    throw new ForbiddenError("FORBIDDEN");
  }
  return access;
}
