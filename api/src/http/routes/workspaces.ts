import { Elysia, t } from "elysia";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boards, invites, members, users, workspaces } from "@/db/schema.ts";
import { requireAuth } from "@/auth/middleware.ts";
import { requireWorkspaceRole, workspaceRole } from "@/lib/permissions.ts";
import { decodeCursor, page, PAGE_SIZE } from "@/lib/pagination.ts";
import { audit } from "@/lib/audit.ts";

const EDIT_ROLES = new Set(["owner", "admin", "editor"]);
const ADMIN_ROLES = ["owner", "admin"];
// Roles an admin/owner may assign — ownership transfer is intentionally out of scope here.
const ASSIGNABLE = t.Union([t.Literal("admin"), t.Literal("editor"), t.Literal("viewer")]);

export const workspaceRoutes = new Elysia({ prefix: "/api" })
  .use(requireAuth)
  // Workspaces the user belongs to, with their role.
  .get("/workspaces", async ({ userId }) => {
    return db
      .select({ id: workspaces.id, name: workspaces.name, role: members.role })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(eq(members.userId, userId!))
      .orderBy(desc(workspaces.createdAt));
  })
  // Create a workspace; the creator becomes its owner member.
  .post(
    "/workspaces",
    async ({ userId, body }) => {
      const [ws] = await db.insert(workspaces).values({ name: body.name, ownerId: userId! }).returning();
      await db.insert(members).values({ workspaceId: ws!.id, userId: userId!, role: "owner" });
      return ws;
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 200 }) }) },
  )
  // Boards in a workspace, newest first, cursor-paginated (§13c). Requires membership.
  .get("/workspaces/:id/boards", async ({ userId, params, query, set }) => {
    if (!(await workspaceRole(userId!, params.id))) {
      set.status = 403;
      return { error: "FORBIDDEN" };
    }
    const cursor = decodeCursor(query.cursor);
    const rows = await db
      .select()
      .from(boards)
      .where(and(eq(boards.workspaceId, params.id), cursor ? lt(boards.updatedAt, cursor) : undefined))
      .orderBy(desc(boards.updatedAt))
      .limit(PAGE_SIZE);
    return page(rows, (b) => b.updatedAt);
  })
  // Create a board in a workspace. Requires editor+ role.
  .post(
    "/workspaces/:id/boards",
    async ({ userId, params, body, set }) => {
      const role = await workspaceRole(userId!, params.id);
      if (!role || !EDIT_ROLES.has(role)) {
        set.status = 403;
        return { error: "FORBIDDEN" };
      }
      const [board] = await db.insert(boards).values({ workspaceId: params.id, title: body.title ?? "Untitled" }).returning();
      return board;
    },
    { body: t.Object({ title: t.Optional(t.String({ maxLength: 300 })) }) },
  )
  // --- Member management ---
  // Members of a workspace (any member may view). Owner first, then by join order.
  .get("/workspaces/:id/members", async ({ userId, params, set }) => {
    if (!(await workspaceRole(userId!, params.id))) {
      set.status = 403;
      return { error: "FORBIDDEN" };
    }
    return db
      .select({ userId: members.userId, role: members.role, displayName: users.displayName, email: users.email, joinedAt: members.createdAt })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.workspaceId, params.id))
      .orderBy(members.createdAt);
  })
  // Change a member's role. Owner/admin only; the owner's role is immutable here (no self-demotion
  // or ownership change through this path).
  .patch(
    "/workspaces/:id/members/:userId",
    async ({ userId, params, body, set }) => {
      await requireWorkspaceRole(userId!, params.id, ADMIN_ROLES);
      const [target] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, params.id), eq(members.userId, params.userId))).limit(1);
      if (!target) {
        set.status = 404;
        return { error: "NOT_FOUND" };
      }
      if (target.role === "owner") {
        set.status = 403;
        return { error: "CANNOT_MODIFY_OWNER" };
      }
      await db.update(members).set({ role: body.role }).where(and(eq(members.workspaceId, params.id), eq(members.userId, params.userId)));
      await audit("member.role_changed", { workspaceId: params.id, userId, detail: { target: params.userId, role: body.role } });
      return { ok: true };
    },
    { body: t.Object({ role: ASSIGNABLE }) },
  )
  // Remove a member. Owner/admin only; the owner cannot be removed.
  .delete("/workspaces/:id/members/:userId", async ({ userId, params, set }) => {
    await requireWorkspaceRole(userId!, params.id, ADMIN_ROLES);
    const [target] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, params.id), eq(members.userId, params.userId))).limit(1);
    if (!target) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    if (target.role === "owner") {
      set.status = 403;
      return { error: "CANNOT_REMOVE_OWNER" };
    }
    await db.delete(members).where(and(eq(members.workspaceId, params.id), eq(members.userId, params.userId)));
    await audit("member.removed", { workspaceId: params.id, userId, detail: { target: params.userId } });
    return { ok: true };
  })
  // Pending (unaccepted, unexpired) invites for a workspace. Owner/admin only.
  .get("/workspaces/:id/invites", async ({ userId, params }) => {
    await requireWorkspaceRole(userId!, params.id, ADMIN_ROLES);
    return db
      .select({ id: invites.id, email: invites.email, role: invites.role, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
      .from(invites)
      .where(and(eq(invites.workspaceId, params.id), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt));
  })
  // Revoke a pending invite. Owner/admin only.
  .delete("/workspaces/:id/invites/:inviteId", async ({ userId, params, set }) => {
    await requireWorkspaceRole(userId!, params.id, ADMIN_ROLES);
    const [row] = await db.delete(invites).where(and(eq(invites.id, params.inviteId), eq(invites.workspaceId, params.id))).returning({ id: invites.id });
    if (!row) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    await audit("invite.revoked", { workspaceId: params.id, userId, detail: { inviteId: params.inviteId } });
    return { ok: true };
  });
