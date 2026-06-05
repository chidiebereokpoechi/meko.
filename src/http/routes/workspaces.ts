import { Elysia, t } from "elysia";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boards, members, workspaces } from "@/db/schema.ts";
import { requireAuth } from "@/auth/middleware.ts";
import { workspaceRole } from "@/lib/permissions.ts";
import { decodeCursor, page, PAGE_SIZE } from "@/lib/pagination.ts";

const EDIT_ROLES = new Set(["owner", "admin", "editor"]);

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
  );
