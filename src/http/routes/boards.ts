import { Elysia, t } from "elysia";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boards, comments, users } from "@/db/schema.ts";
import { requireAuth } from "@/auth/middleware.ts";
import { requireBoardAccess } from "@/lib/permissions.ts";
import { decodeCursor, page, PAGE_SIZE } from "@/lib/pagination.ts";
import { audit } from "@/lib/audit.ts";

export const boardRoutes = new Elysia({ prefix: "/api/boards" })
  .use(requireAuth)
  // Board metadata. Realtime element state flows over the WS, not here.
  .get("/:id", async ({ userId, params }) => {
    await requireBoardAccess(userId!, params.id, "view");
    const [board] = await db.select().from(boards).where(eq(boards.id, params.id)).limit(1);
    return board;
  })
  .patch(
    "/:id",
    async ({ userId, params, body }) => {
      await requireBoardAccess(userId!, params.id, "edit");
      const [board] = await db
        .update(boards)
        .set({ title: body.title, updatedAt: new Date() })
        .where(eq(boards.id, params.id))
        .returning();
      return board;
    },
    { body: t.Object({ title: t.String({ minLength: 1, maxLength: 300 }) }) },
  )
  .delete("/:id", async ({ userId, params }) => {
    await requireBoardAccess(userId!, params.id, "edit");
    await db.delete(boards).where(eq(boards.id, params.id));
    await audit("board.deleted", { userId, resource: `board:${params.id}` });
    return { ok: true };
  })
  // Comments, newest first, cursor-paginated (§13c).
  .get("/:id/comments", async ({ userId, params, query }) => {
    await requireBoardAccess(userId!, params.id, "view");
    const cursor = decodeCursor(query.cursor);
    const rows = await db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        authorId: comments.authorId,
        authorName: users.displayName,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(eq(comments.boardId, params.id), cursor ? lt(comments.createdAt, cursor) : undefined))
      .orderBy(desc(comments.createdAt))
      .limit(PAGE_SIZE);
    return page(rows, (r) => r.createdAt);
  })
  .post(
    "/:id/comments",
    async ({ userId, params, body }) => {
      await requireBoardAccess(userId!, params.id, "view");
      const [comment] = await db.insert(comments).values({ boardId: params.id, authorId: userId!, body: body.body }).returning();
      return comment;
    },
    { body: t.Object({ body: t.String({ minLength: 1, maxLength: 10_000 }) }) },
  );
