import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { boardExports } from "@/db/schema.ts";
import { requireAuth } from "@/auth/middleware.ts";
import { requireBoardAccess } from "@/lib/permissions.ts";
import { enforceRateLimit } from "@/lib/rate-limit.ts";
import { presignGet } from "@/lib/storage.ts";
import { enqueue } from "@/worker/queue.ts";

export const exportRoutes = new Elysia({ prefix: "/api" })
  .use(requireAuth)
  // Request a board export. View access + 5/hour/user (§12m). The Chromium sidecar renders it.
  .post(
    "/boards/:id/exports",
    async ({ userId, params, body }) => {
      await requireBoardAccess(userId!, params.id, "view");
      await enforceRateLimit(`rl:user:${userId}:exports`, 5, 3600);
      const [row] = await db
        .insert(boardExports)
        .values({ boardId: params.id, requestedBy: userId!, format: body.format })
        .returning({ id: boardExports.id, status: boardExports.status });
      await enqueue("export", { exportId: row!.id }, 1);
      return row;
    },
    { body: t.Object({ format: t.Union([t.Literal("png"), t.Literal("pdf")]) }) },
  )
  // Poll export status; presign the result once ready.
  .get("/exports/:id", async ({ userId, params, set }) => {
    const row = await db.query.boardExports.findFirst({ where: eq(boardExports.id, params.id) });
    if (!row) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
    await requireBoardAccess(userId!, row.boardId, "view");
    return {
      status: row.status,
      format: row.format,
      url: row.status === "ready" && row.resultKey ? presignGet(row.resultKey) : null,
    };
  });
