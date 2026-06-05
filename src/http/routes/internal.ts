import { Elysia } from "elysia";
import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { jobs } from "@/db/schema.ts";
import { config } from "@/config.ts";

// Internal-only ops surface (§12n). Gated by a shared secret; when unset, every route 404s so the
// endpoint is invisible. In production this is additionally reachable only from inside the
// network (not proxied by nginx).
function authorized(request: Request): boolean {
  const token = config.MEKO_INTERNAL_TOKEN;
  if (!token) return false;
  const given = request.headers.get("x-internal-token") ?? "";
  return given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

export const internalRoutes = new Elysia({ prefix: "/api/internal" })
  .onBeforeHandle(({ request, set }) => {
    if (!authorized(request)) {
      set.status = 404;
      return { error: "NOT_FOUND" };
    }
  })
  // Dead-lettered jobs awaiting operator attention (§12n).
  .get("/jobs/dead", async () => {
    const rows = await db
      .select({ id: jobs.id, type: jobs.type, error: jobs.error, attempts: jobs.attempts, updatedAt: jobs.updatedAt })
      .from(jobs)
      .where(eq(jobs.status, "dead"))
      .orderBy(desc(jobs.updatedAt))
      .limit(200);
    return { count: rows.length, jobs: rows };
  });
